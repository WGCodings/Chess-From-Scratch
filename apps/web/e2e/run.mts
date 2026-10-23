// Browser tests of the editor, run as a user would work:
//
//   npm run e2e -w @cfs/web
//
// Starts the Vite dev server and drives Chrome with playwright-core. Uses the
// Chrome installed on your computer (channel "chrome"), or the browser at
// $CHROMIUM_PATH. Prints one line per check and exits non-zero on failures.

import { createServer } from "vite";
import { chromium, type Page } from "playwright-core";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root, logLevel: "error", server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls!.local[0]!;

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" },
);
const only = process.argv[2];
let failed = 0;
let passed = 0;
const pageErrors: string[] = [];

async function newPage(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 2000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(String(e)));
  p.on("dialog", (d) => void d.accept());
  await p.goto(url);
  await p.waitForSelector(".blocklyToolboxCategory");
  await p.waitForTimeout(500);
  return p;
}

async function test(name: string, fn: (p: Page) => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return;
  const p = await newPage();
  try {
    await fn(p);
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n     ${(err as Error).message.split("\n").slice(0, 6).join("\n     ")}`);
    await p.screenshot({ path: join(tmpdir(), `cfs-e2e-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
  } finally {
    await p.context().close();
  }
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

// Helpers -------------------------------------------------------------------------------------

const template = async (p: Page, name: "starter" | "reference" | "empty") => {
  await p.selectOption("#template", name);
  await p.waitForTimeout(700);
};
const openFile = async (p: Page, path: string) => {
  await p.locator(`.tree-file[data-path="${path}"]`).click();
  await p.waitForTimeout(150);
  return p.locator("#code").innerText();
};
const blockOnCanvas = (p: Page, label: string) => p.locator("svg.blocklySvg .blocklyBlockCanvas text", { hasText: label });
const rightClick = async (p: Page, label: string, item: string) => {
  const box = await blockOnCanvas(p, label).first().boundingBox();
  check(box, `block ${label} not on the canvas`);
  await p.mouse.click(box.x + 5, box.y + 5, { button: "right" });
  await p.waitForTimeout(250);
  await p.locator(".blocklyContextMenu .blocklyMenuItem", { hasText: item }).first().click();
  await p.waitForTimeout(400);
};
/** The text of the editor inside `sel` (code pane: ".code-editor", block editor: ".be-code"). */
const editorText = (p: Page, sel: string) =>
  p.evaluate((s) => (document.querySelector(s) as unknown as { editorView: { state: { doc: { toString(): string } } } }).editorView.state.doc.toString(), sel);
const setEditorText = (p: Page, sel: string, text: string) =>
  p.evaluate(
    ([s, t]) => {
      const v = (document.querySelector(s!) as unknown as { editorView: { state: { doc: { length: number } }; dispatch(x: unknown): void } }).editorView;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
    },
    [sel, text],
  );
/** Puts the cursor at the end of line `n` (1-based) of the editor. */
const cursorToLineEnd = (p: Page, sel: string, n: number) =>
  p.evaluate(
    ([s, line]) => {
      const v = (document.querySelector(s as string) as unknown as {
        editorView: { state: { doc: { line(n: number): { to: number } } }; dispatch(x: unknown): void; focus(): void };
      }).editorView;
      v.dispatch({ selection: { anchor: v.state.doc.line(line as number).to } });
      v.focus();
    },
    [sel, n],
  );
const toast = (p: Page) => p.locator("#toast").innerText();
/** Answers the "Save your changes" dialog: change the block, or a new block on top with this name. */
const answerSave = async (p: Page, onTop?: string) => {
  await p.waitForSelector(".save-choice", { timeout: 4000 });
  if (onTop !== undefined) {
    await p.locator('.save-choice input[value="top"]').check();
    await p.locator(".save-choice .be-field input").fill(onTop);
  }
  await p.locator(".save-choice .btn.primary").click();
  await p.waitForTimeout(900);
};

// Tests ---------------------------------------------------------------------------------------

await test("toolbox search finds blocks by name and description", async (p) => {
  await p.fill(".tb-search input", "null move");
  await p.waitForTimeout(300);
  const labels = await p.locator(".blocklyFlyout .blocklyText").allTextContents();
  check(labels.some((l) => l.includes("Null") && l.includes("move")), `flyout: ${labels.join(" | ")}`);
  await p.fill(".tb-search input", "captures");
  await p.waitForTimeout(300);
  const l2 = (await p.locator(".blocklyFlyout .blocklyText").allTextContents()).join(" | ");
  check(l2.includes("MVV") && l2.includes("Quiescence"), `flyout: ${l2}`);
});

await test("hooks show in the code view, one per slot", async (p) => {
  await template(p, "reference");
  await openFile(p, "src/search.rs");
  const hooks = (await p.locator("#code .ln.hook").allInnerTexts()).map((t) => t.trim().replace("// @hook ", ""));
  for (const h of ["root", "pruning", "ordering", "extensions", "reductions", "move_loop", "leaf"]) check(hooks.includes(h), `missing hook ${h}: ${hooks.join(",")}`);
  await openFile(p, "src/eval.rs");
  check((await p.locator("#code .ln.hook").allInnerTexts()).some((t) => t.includes("@hook eval")), "no eval hook");
});

await test("typing a block under a hook in Edit code makes a block", async (p) => {
  await template(p, "starter");
  await openFile(p, "src/search.rs");
  await p.locator("#code .ln.hook", { hasText: "@hook pruning" }).dblclick();
  await p.waitForTimeout(400);
  check(await p.locator("#code-editor").isVisible(), "edit mode did not open");
  // Type it like a user: Enter keeps the indentation, Tab indents.
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("// @block never_prune");
  await p.keyboard.press("Enter");
  await p.keyboard.type("if depth > 1000 {");
  await p.keyboard.press("Enter");
  await p.keyboard.type("return 0;");
  // The closing brace was added when "{" was typed: step past it.
  await p.keyboard.press("ArrowDown");
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await p.keyboard.type("// @end never_prune");
  const text = await editorText(p, ".code-editor");
  check(/\n {12}return 0;\n {8}\}/.test(text), `auto-indent: ${text.slice(text.indexOf("never_prune") - 20, text.indexOf("never_prune") + 160)}`);
  await p.click("#save-code");
  await p.waitForTimeout(900);
  check(await p.locator("#code-editor").isHidden(), `still editing: ${await p.locator("#code-errors").innerText()}`);
  check((await blockOnCanvas(p, "Never prune").count()) === 1, "block not on canvas");
  const code = await openFile(p, "src/search.rs");
  check(code.includes("// @block never_prune") && code.includes("if depth > 1000 {"), "code not generated");
});

await test("Tab indents by four spaces and Format re-indents", async (p) => {
  await template(p, "starter");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const first = (await editorText(p, ".code-editor")).split("\n")[0]!;
  await cursorToLineEnd(p, ".code-editor", 1);
  await p.keyboard.press("Home");
  await p.keyboard.press("Tab");
  check((await editorText(p, ".code-editor")).startsWith(`    ${first}`), "Tab did not indent");
  // Mess up some indentation, then Format.
  const t = await editorText(p, ".code-editor");
  await setEditorText(p, ".code-editor", t.replace("        self.pv.clear(ply);", "self.pv.clear(ply);").replace(/^ {4}/, ""));
  await p.click("#format-code");
  await p.waitForTimeout(200);
  check((await editorText(p, ".code-editor")).includes("\n        self.pv.clear(ply);"), "Format did not fix the indentation");
});

await test("autocompletion knows cozy-chess and the skeleton", async (p) => {
  await template(p, "starter");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const t = await editorText(p, ".code-editor");
  const n = t.split("\n").findIndex((l) => l.trim() === "// @hook pruning") + 1;
  await cursorToLineEnd(p, ".code-editor", n);
  await p.keyboard.press("Enter");
  await p.keyboard.type("board.");
  await p.waitForTimeout(400);
  const items = await p.locator(".cm-tooltip-autocomplete li").allInnerTexts();
  check(items.some((i) => i.startsWith("checkers")), `completions: ${items.slice(0, 8).join(", ")}`);
  await p.keyboard.type("che");
  await p.keyboard.press("Enter");
  await p.keyboard.type(".");
  await p.waitForTimeout(400);
  const bb = await p.locator(".cm-tooltip-autocomplete li").allInnerTexts();
  check(bb.some((i) => i.startsWith("is_empty")), `BitBoard completions: ${bb.slice(0, 8).join(", ")}`);
  await p.keyboard.type("x\n// ");
  await p.keyboard.press("Escape");
});

await test("Ctrl+Space opens suggestions, Tab takes one, and calls show their parameters", async (p) => {
  await template(p, "starter");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const t = await editorText(p, ".code-editor");
  const n = t.split("\n").findIndex((l) => l.trim() === "// @hook leaf") + 1;
  await cursorToLineEnd(p, ".code-editor", n);
  await p.keyboard.press("Enter");
  await p.keyboard.press("Control+Space");
  await p.waitForTimeout(400);
  const all = await p.locator(".cm-tooltip-autocomplete li").allInnerTexts();
  check(all.some((i) => i.startsWith("pos")), `Ctrl+Space: ${all.slice(0, 6).join(", ")}`);
  await p.keyboard.press("Escape");
  await p.keyboard.type("pos.boa");
  await p.waitForTimeout(400);
  await p.keyboard.press("Tab");
  await p.keyboard.type(".piece_on");
  await p.waitForTimeout(400);
  await p.keyboard.press("Tab");
  await p.waitForTimeout(300);
  const line = await p.evaluate(() => {
    const v = (document.querySelector(".code-editor") as unknown as { editorView: { state: { doc: { lineAt(n: number): { text: string } } ; selection: { main: { head: number } } } } }).editorView;
    return v.state.doc.lineAt(v.state.selection.main.head).text.trim();
  });
  check(line === "pos.board().piece_on()", `Tab did not complete: ${line}`);
  const sig = await p.locator(".cm-sig").allInnerTexts();
  check(sig.some((s) => s.includes("square: Square")), `signature: ${sig.join(" | ")}`);
  await p.keyboard.press("Escape");
});

await test("the error list explains a broken edit and can be closed", async (p) => {
  await template(p, "starter");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const t = await editorText(p, ".code-editor");
  await setEditorText(p, ".code-editor", t.replace("// @block negamax\n", ""));
  await p.click("#save-code");
  await p.waitForTimeout(500);
  const errs = await p.locator("#code-errors li").allInnerTexts();
  check(errs.some((e) => e.includes("Keep the")), `errors: ${errs.join(" | ")}`);
  await p.click(".code-errors-x");
  check(await p.locator("#code-errors").isHidden(), "error list did not close");
  await p.click("#cancel-code");
});

await test("editing skeleton code makes your own Negamax, with only the code in your engine", async (p) => {
  await template(p, "starter");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const t = await editorText(p, ".code-editor");
  await setEditorText(p, ".code-editor", t.replace("self.pv.clear(ply);", "self.pv.clear(ply); // mine"));
  await p.click("#save-code");
  await answerSave(p);
  check(await p.locator("#code-editor").isHidden(), `still editing: ${await p.locator("#code-errors").innerText()}`);
  check((await blockOnCanvas(p, "My negamax search").count()) === 1, "your Negamax is not on the canvas");
  check((await openFile(p, "src/search.rs")).includes("self.pv.clear(ply); // mine"), "edit not in the code");
  const block = await openFile(p, "blocks/my_negamax.block.rs");
  check(block.includes("// @builtin") && !block.includes("killers.push"), "your Negamax holds code of blocks not in the engine");
});

/** Puts a built-in search block into the Negamax block's slot input. */
const placeSearchBlock = (p: Page, type: string, input: string) =>
  p.evaluate(
    ([t, name]) => {
      const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
      const negamax = bw.getBlocksByType("cfs_negamax", false)[0]!;
      const b = bw.newBlock(t!);
      b.initSvg();
      b.render();
      let conn = negamax.getInput(name!)!.connection!;
      while (conn.targetBlock()) conn = conn.targetBlock()!.nextConnection!;
      conn.connect(b.previousConnection!);
    },
    [type, input],
  );

await test("Edit this block on Alpha-beta shows only the code of blocks in the engine", async (p) => {
  await template(p, "starter");
  await placeSearchBlock(p, "cfs_search_alpha_beta", "MOVE_LOOP");
  await p.waitForTimeout(600);
  await rightClick(p, "Alpha-beta pruning", "Edit this block");
  const src = await editorText(p, ".be-code");
  check(src.includes("// @builtin killers"), "no @builtin line for Killers");
  for (const word of ["killers.push", "history.update", "LMR_MIN", "zero-window"]) check(!src.includes(word), `shows ${word}`);
  await p.locator(".be-foot .btn.primary").click();
  await p.waitForTimeout(800);
  // Adding a block it contains later still works with your version.
  await placeSearchBlock(p, "cfs_search_killers", "ORDERING");
  await p.waitForTimeout(600);
  check((await openFile(p, "src/search.rs")).includes("self.killers.push(ply, mv);"), "Killers code missing in your alpha-beta");
});

await test("the drawer greys out blocks that need another block, and PVS only goes under Alpha-beta", async (p) => {
  await template(p, "starter");
  const enabledInDrawer = async (category: string, label: string) => {
    await p.locator(".blocklyToolboxCategory", { hasText: category }).first().click();
    await p.waitForTimeout(300);
    return p.evaluate((l) => {
      const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
      const fly = bw.getFlyout()?.getWorkspace() ?? (bw.getToolbox() as import("blockly").Toolbox).getFlyout()!.getWorkspace();
      const b = fly.getTopBlocks(false).find((x) => x.toString().includes(l));
      return b ? b.isEnabled() : null;
    }, label);
  };
  check((await enabledInDrawer("Move loop", "Principal variation")) === false, "PVS is not greyed out without Alpha-beta");
  check((await enabledInDrawer("Move loop", "Alpha-beta")) === true, "Alpha-beta is greyed out");
  await placeSearchBlock(p, "cfs_search_alpha_beta", "MOVE_LOOP");
  await p.waitForTimeout(600);
  check((await enabledInDrawer("Move loop", "Principal variation")) === true, "PVS still greyed out with Alpha-beta");
  // PVS snaps below Alpha-beta, not above it.
  const result = await p.evaluate(() => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    const negamax = bw.getBlocksByType("cfs_negamax", false)[0]!;
    const ab = bw.getBlocksByType("cfs_search_alpha_beta", false)[0]!;
    const pvs = bw.newBlock("cfs_search_principal_variation_search");
    pvs.initSvg();
    pvs.render();
    const checker = bw.connectionChecker;
    const top = negamax.getInput("MOVE_LOOP")!.connection!;
    const r = 1000;
    return {
      above: checker.canConnect(pvs.previousConnection as never, top as never, true, r),
      below: checker.canConnect(pvs.previousConnection as never, ab.nextConnection as never, true, r),
    };
  });
  check(!result.above && result.below, `above ${result.above}, below ${result.below}`);
});

await test("editing a built-in block in the code makes your own version", async (p) => {
  await template(p, "reference");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const t = await editorText(p, ".code-editor");
  await setEditorText(p, ".code-editor", t.replace("let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;", "let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + depth / 8;"));
  await p.click("#save-code");
  await answerSave(p);
  check((await blockOnCanvas(p, "My null move pruning").count()) === 1, `no fork: ${await toast(p)}`);
  check((await openFile(p, "src/search.rs")).includes("+ depth / 8;"), "edit not in code");
});

await test("a change inside a built-in block can be saved as a new block on top of it", async (p) => {
  await template(p, "reference");
  await openFile(p, "src/search.rs");
  await p.click("#edit-code");
  await p.waitForTimeout(300);
  const t = await editorText(p, ".code-editor");
  await setEditorText(p, ".code-editor", t.replace("let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;", "let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + depth / 8;"));
  await p.click("#save-code");
  await answerSave(p, "Deeper NMP");
  check((await blockOnCanvas(p, "Deeper NMP").count()) === 1, `no new block: ${await toast(p)}`);
  check((await blockOnCanvas(p, "Null move pruning").count()) >= 1, "Null move pruning was replaced");
  check((await openFile(p, "src/search.rs")).includes("+ depth / 8;"), "edit not in code");
  const block = await openFile(p, "blocks/deeper_nmp.block.rs");
  check(block.includes("requires: null_move_pruning") && block.includes("// @replace search.rs"), `block file: ${block.slice(0, 400)}`);
});

await test("New block on top of this one: your block's lines changed in a block that builds on it", async (p) => {
  await template(p, "starter");
  await placeSearchBlock(p, "cfs_search_alpha_beta", "MOVE_LOOP");
  await p.waitForTimeout(600);
  // Your own alpha-beta first, then PVS on top of it.
  await rightClick(p, "Alpha-beta pruning", "Edit this block");
  await p.locator(".be-foot .btn.primary").click();
  await p.waitForTimeout(800);
  await rightClick(p, "My alpha-beta pruning", "New block on top of this one");
  await p.locator(".save-choice .be-field input").fill("My PVS");
  await p.locator(".save-choice .btn.primary").click();
  await p.waitForTimeout(500);
  check(!(await p.locator("#code-editor").isHidden()), "not editing");
  const t = await editorText(p, ".code-editor");
  const pvs = [
    "let mut score;",
    "            if i == 0 {",
    "                score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);",
    "            } else {",
    "                score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);",
    "                if score > alpha && score < beta {",
    "                    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);",
    "                }",
    "            }",
  ].join("\n");
  await setEditorText(p, ".code-editor", t.replace("let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);", pvs));
  await p.click("#save-code");
  await p.waitForTimeout(900);
  check((await blockOnCanvas(p, "My PVS").count()) === 1, `no PVS block: ${await p.locator("#code-errors").innerText()} ${await toast(p)}`);
  const block = await openFile(p, "blocks/my_pvs.block.rs");
  check(block.includes("requires: my_alpha_beta") && block.includes("// @replace search.rs"), `block file: ${block.slice(0, 500)}`);
  check(!(await openFile(p, "blocks/my_alpha_beta.block.rs")).includes("let mut score;"), "your alpha-beta changed");
  check((await p.locator("#issues").innerText()).includes("Ready"), `not ready: ${await p.locator("#issues").innerText()}`);
});

await test("Edit this block forks a built-in block in the block editor", async (p) => {
  await template(p, "reference");
  await rightClick(p, "Null move pruning", "Edit this block");
  check(await p.locator(".be").isVisible(), "block editor did not open");
  const src = await editorText(p, ".be-code");
  await setEditorText(p, ".be-code", src.replace("let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;", "let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + 1;"));
  await p.waitForTimeout(400);
  await p.locator(".be-foot .btn.primary").click();
  await p.waitForTimeout(800);
  check((await p.locator(".be").count()) === 0, "editor still open");
  check((await openFile(p, "src/search.rs")).includes("NMP_DEPTH_DIVISOR + 1;"), "edit not in code");
});

await test("New block from My blocks is placed and generated", async (p) => {
  await template(p, "reference");
  await p.locator(".blocklyToolboxCategory", { hasText: "My blocks" }).click();
  await p.waitForTimeout(300);
  await p.locator(".blocklyFlyoutButton", { hasText: "New block" }).click();
  await p.fill(".be-small input", "Late reduction test");
  await p.selectOption(".be-small select", "reductions");
  await p.locator(".be-small .btn.primary").click();
  await p.waitForTimeout(500);
  const checks = await p.locator(".be-checks li").allInnerTexts();
  check(checks.some((c) => c.startsWith("No problems")), `checks: ${checks.join(" | ")}`);
  await p.locator(".be-foot .btn.primary").click();
  await p.waitForTimeout(800);
  check((await openFile(p, "src/search.rs")).includes("// @block late_reduction_test"), "not generated");
});

await test("block editor: Tab, Format and completion work", async (p) => {
  await template(p, "reference");
  await rightClick(p, "Null move pruning", "Edit this block");
  const src = await editorText(p, ".be-code");
  await setEditorText(p, ".be-code", src.replace("    let r = NMP_BASE_REDUCTION", "let r = NMP_BASE_REDUCTION"));
  await p.locator(".be-foot .btn", { hasText: "Format" }).click();
  await p.waitForTimeout(200);
  check((await editorText(p, ".be-code")).includes("\n    let r = NMP_BASE_REDUCTION"), "Format did not re-indent");
  const lines = (await editorText(p, ".be-code")).split("\n");
  await cursorToLineEnd(p, ".be-code", lines.findIndex((l) => l.includes("pos.make_null();")) + 1);
  await p.keyboard.press("Enter");
  await p.keyboard.type("NMP_");
  await p.waitForTimeout(400);
  const items = await p.locator(".cm-tooltip-autocomplete li").allInnerTexts();
  check(items.some((i) => i.startsWith("NMP_MIN_DEPTH")), `completions: ${items.slice(0, 6).join(", ")}`);
  await p.keyboard.press("Escape");
});

await test("linked folder: files written, edits come back as blocks", async (p) => {
  await template(p, "starter");
  // The origin private file system stands in for a folder on disk.
  await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(`proj${Date.now()}`, { create: true });
    (window as unknown as { __dir: FileSystemDirectoryHandle }).__dir = dir;
    await (window as unknown as { __cfsLinkFolder(h: FileSystemDirectoryHandle): Promise<void> }).__cfsLinkFolder(dir);
  });
  const read = (path: string) =>
    p.evaluate(async (path) => {
      let d = (window as unknown as { __dir: FileSystemDirectoryHandle }).__dir;
      const parts = path.split("/");
      for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x);
      return (await (await d.getFileHandle(parts.at(-1)!)).getFile()).text();
    }, path);
  const write = (path: string, text: string) =>
    p.evaluate(
      async ([path, text]) => {
        let d = (window as unknown as { __dir: FileSystemDirectoryHandle }).__dir;
        const parts = path!.split("/");
        for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x, { create: true });
        const w = await (await d.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
        await w.write(text!);
        await w.close();
      },
      [path, text],
    );
  const search = await read("src/search.rs");
  check(search.includes("// @hook pruning"), "hooks not written");
  check((await read("Cargo.toml")).includes("cozy-chess"), "Cargo.toml missing");
  check((await p.locator("#folder-status").innerText()).includes("Linked"), "no status");

  // An edit "in VS Code": a new block under the extensions hook.
  const lines = search.split("\n");
  const k = lines.findIndex((l) => l.trim() === "// @hook extensions");
  lines.splice(k + 1, 0, "            // @block from_vscode", "            if !pos.board().checkers().is_empty() {", "                extension += 1;", "            }", "            // @end from_vscode");
  await write("src/search.rs", lines.join("\n"));
  await p.waitForTimeout(2500);
  check((await blockOnCanvas(p, "From vscode").count()) === 1, `block not created: ${await p.locator("#folder-status").innerText()} ${await p.locator("#code-errors").innerText()}`);
  check((await read("blocks/from_vscode.block.rs")).includes("@hook extensions"), "block file not written back");

  // A broken edit is explained, not applied; fixing it applies.
  const now = await read("src/search.rs");
  await write("src/search.rs", now.replace("// @block negamax\n", ""));
  await p.waitForTimeout(2500);
  check((await p.locator("#code-errors").innerText()).includes("Keep the"), "error not shown");
  await write("src/search.rs", now.replace("extension += 1;", "extension += 1; // one ply"));
  // A change inside one of your blocks: the app asks whether to change it or build on it.
  await answerSave(p);
  await p.waitForTimeout(1500);
  check((await read("blocks/from_vscode.block.rs")).includes("// one ply"), "fix not applied");

  // Editing the block file itself updates the block.
  const blk = await read("blocks/from_vscode.block.rs");
  await write("blocks/from_vscode.block.rs", blk.replace("//! label: From vscode", "//! label: Check ext from VS Code"));
  await p.waitForTimeout(2500);
  check((await blockOnCanvas(p, "Check ext from VS Code").count()) === 1, "block file edit not applied");

  // Changes in the app are written to the folder.
  await template(p, "reference");
  await p.waitForTimeout(800);
  check((await read("src/search.rs")).includes("// @block null_move_pruning"), "app change not written");
});

await test("save and open a .cfs project with its blocks", async (p) => {
  await template(p, "reference");
  await rightClick(p, "Null move pruning", "Edit this block");
  await p.locator(".be-foot .btn.primary").click();
  await p.waitForTimeout(700);
  const dl = p.waitForEvent("download");
  await p.click("#save");
  const d = await dl;
  const path = join(mkdtempSync(join(tmpdir(), "cfs-")), "p.cfs");
  await d.saveAs(path);
  check(readFileSync(path).length > 100, "empty bundle");
  await template(p, "starter");
  await p.setInputFiles("#file", path);
  await p.waitForTimeout(900);
  check((await openFile(p, "src/search.rs")).includes("// @block my_null_move_pruning"), "blocks not restored");
});

console.log(`\n${passed} passed, ${failed} failed${pageErrors.length ? `; page errors: ${pageErrors.join(" | ")}` : ""}`);
await browser.close();
await server.close();
process.exit(failed || pageErrors.length ? 1 : 0);
