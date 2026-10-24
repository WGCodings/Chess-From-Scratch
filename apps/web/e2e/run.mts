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
import { starterWorkspace } from "@cfs/codegen";

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

async function newPage(init?: () => void): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: process.env.CFS_SHOTS ? 1000 : 2000 }, acceptDownloads: true });
  // tsx wraps named functions in __name(): define it so a function can be sent to the page.
  if (init) await ctx.addInitScript(`var __name = (f) => f; (${init.toString()})();`);
  // The tutorial offer would cover part of the canvas; its own test clears this.
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("cfs.e2e.offer")) localStorage.setItem("cfs.tutorial.seen", "1");
  });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(String(e)));
  p.on("dialog", (d) => void d.accept());
  await p.goto(url);
  await p.waitForSelector(".blocklyToolboxCategory");
  await p.waitForTimeout(500);
  return p;
}

async function test(name: string, fn: (p: Page) => Promise<void>, init?: () => void): Promise<void> {
  if (only && !name.includes(only)) return;
  const p = await newPage(init);
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

/** Clicks an item of the ☰ menu. */
const menu = async (p: Page, item: string) => {
  await p.click("#menu-btn");
  await p.click(`#menu ${item}`);
};
const template = async (p: Page, name: "starter" | "reference" | "empty") => {
  await p.click("#menu-btn");
  await p.click("#template-toggle");
  await p.click(`#menu [data-template="${name}"]`);
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
  const block = await openFile(p, "blocks/skeleton/my_negamax.block.rs");
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
  const block = await openFile(p, "blocks/pruning/deeper_nmp.block.rs");
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
  const block = await openFile(p, "blocks/move_loop/my_pvs.block.rs");
  check(block.includes("requires: my_alpha_beta") && block.includes("// @replace search.rs"), `block file: ${block.slice(0, 500)}`);
  check(!(await openFile(p, "blocks/move_loop/my_alpha_beta.block.rs")).includes("let mut score;"), "your alpha-beta changed");
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
  await p.locator(".blocklyToolboxCategory", { hasText: "New or import" }).click();
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
  check((await read("blocks/extensions/from_vscode.block.rs")).includes("@hook extensions"), "block file not written back");

  // A broken edit is explained, not applied; fixing it applies.
  const now = await read("src/search.rs");
  await write("src/search.rs", now.replace("// @block negamax\n", ""));
  await p.waitForTimeout(2500);
  check((await p.locator("#code-errors").innerText()).includes("Keep the"), "error not shown");
  await write("src/search.rs", now.replace("extension += 1;", "extension += 1; // one ply"));
  // A change inside one of your blocks: the app asks whether to change it or build on it.
  await answerSave(p);
  await p.waitForTimeout(1500);
  check((await read("blocks/extensions/from_vscode.block.rs")).includes("// one ply"), "fix not applied");

  // Editing the block file itself updates the block.
  const blk = await read("blocks/extensions/from_vscode.block.rs");
  await write("blocks/extensions/from_vscode.block.rs", blk.replace("//! label: From vscode", "//! label: Check ext from VS Code"));
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
  await menu(p, "#save");
  const d = await dl;
  const path = join(mkdtempSync(join(tmpdir(), "cfs-")), "p.cfs");
  await d.saveAs(path);
  check(readFileSync(path).length > 100, "empty bundle");
  await template(p, "starter");
  await p.setInputFiles("#file", path);
  await p.waitForTimeout(900);
  check((await openFile(p, "src/search.rs")).includes("// @block my_null_move_pruning"), "blocks not restored");
});

await test("the drawer stays open after dragging a block out, and My blocks has a folder per slot", async (p) => {
  await template(p, "starter");
  await p.locator(".blocklyToolboxCategory", { hasText: "Move loop" }).first().click();
  await p.waitForTimeout(300);
  const visible = () =>
    p.evaluate(() => (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace.getFlyout()?.isVisible() ??
      ((window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace.getToolbox() as import("blockly").Toolbox).getFlyout()!.isVisible());
  check(await visible(), "drawer did not open");
  // Drag Alpha-beta out of the drawer onto the canvas with the mouse.
  const src = await p.locator(".blocklyFlyout .blocklyDraggable text", { hasText: "Alpha-beta pruning" }).first().boundingBox();
  check(src, "Alpha-beta not in the drawer");
  await p.mouse.move(src.x + 5, src.y + 5);
  await p.mouse.down();
  await p.mouse.move(src.x + 400, src.y + 200, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(500);
  check((await blockOnCanvas(p, "Alpha-beta pruning").count()) >= 1, "block not dragged out");
  check(await visible(), "the drawer closed after dragging a block out");
  // My blocks: the examples sit in their slot folders.
  await p.locator(".blocklyToolboxCategory", { hasText: "My blocks" }).first().click();
  await p.waitForTimeout(300);
  const names = await p.locator(".blocklyToolboxCategory").allInnerTexts();
  for (const folder of ["Extensions", "Move ordering", "Evaluation"]) {
    check(names.some((n) => n.startsWith(folder) && /\(\d+\)/.test(n)), `no ${folder} folder: ${names.join(" | ")}`);
  }
});

await test("a first visit is empty, stays empty after a reload, and shows no old code", async (p) => {
  const blocks = () => p.evaluate(() => (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace.getAllBlocks(false).length);
  check((await blocks()) === 0, `blocks on a first visit: ${await blocks()}`);
  check(await p.locator(".canvas-empty").isVisible(), "no empty-canvas card");
  check((await p.locator("#code").innerText()).includes("No code yet"), "code pane not empty");
  await p.reload();
  await p.waitForTimeout(800);
  check((await blocks()) === 0, "blocks came back after a reload");
  // Remove the search from a complete engine: the old code goes away.
  await template(p, "starter");
  check((await p.locator("#code").innerText()).includes("fn negamax"), "starter code missing");
  await p.evaluate(() => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    bw.getBlocksByType("cfs_negamax", false)[0]!.dispose(true);
  });
  await p.waitForTimeout(600);
  const code = await p.locator("#code").innerText();
  check(code.includes("No code yet") && code.includes("Plug a search") && !code.includes("fn negamax"), `code pane: ${code.slice(0, 200)}`);
});

const engineName = (p: Page) =>
  p.evaluate(() => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    return String(bw.getAllBlocks(false).find((b) => b.getField("NAME") && b.type.includes("engine"))?.getFieldValue("NAME"));
  });
const setEngineName = (p: Page, name: string) =>
  p.evaluate((n) => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    bw.getAllBlocks(false).find((b) => b.getField("NAME") && b.type.includes("engine"))!.setFieldValue(n, "NAME");
  }, name);

await test("branches: clone, change, switch, keep, and they survive a reload and a saved file", async (p) => {
  await template(p, "starter");
  const original = await engineName(p);
  await p.click("#branch-btn");
  await p.fill(".br-new input", "+ new name");
  await p.locator(".br-new button").click();
  await p.waitForTimeout(400);
  check((await p.innerText("#branch-btn")).includes("+ new name"), `button: ${await p.innerText("#branch-btn")}`);
  await p.keyboard.press("Escape");
  await setEngineName(p, "Branchy");
  await p.waitForTimeout(400);
  await p.click("#branch-btn");
  const changes = await p.locator('.br-item[data-branch="new-name"] .br-changes').innerText();
  check(changes.includes(`Engine name: ${original} → Branchy`), `changes: ${changes}`);
  if (process.env.CFS_SHOTS) await p.locator(".br").screenshot({ path: join(process.env.CFS_SHOTS, "branches.png") });
  // Back to main: the canvas shows main's engine.
  await p.locator('.br-item[data-branch="main"] button', { hasText: "Open" }).click();
  await p.waitForTimeout(500);
  check((await engineName(p)) === original, `main shows ${await engineName(p)}`);
  // A reload keeps both branches.
  await p.reload();
  await p.waitForSelector(".blocklyToolboxCategory");
  await p.waitForTimeout(500);
  await p.click("#branch-btn");
  check((await p.locator(".br-item").count()) === 2, "branches lost after reload");
  // Save the file with both branches.
  await p.keyboard.press("Escape");
  const dl = p.waitForEvent("download");
  await menu(p, "#save");
  const path = join(mkdtempSync(join(tmpdir(), "cfs-")), "b.cfs");
  await (await dl).saveAs(path);
  // Keep the branch: main gets its engine.
  await p.click("#branch-btn");
  await p.locator('.br-item[data-branch="new-name"] .keep').click();
  await p.waitForSelector(".br-review .cd-file");
  const diff = await p.locator(".br-review .cd").innerText();
  check(diff.includes("Cargo.toml") && diff.includes("Branchy"), `diff: ${diff.slice(0, 300)}`);
  check((await p.locator(".br-review .cd-a").count()) > 0 && (await p.locator(".br-review .cd-d").count()) > 0, "no + and − lines");
  if (process.env.CFS_SHOTS) await p.locator(".br").screenshot({ path: join(process.env.CFS_SHOTS, "keep.png") });
  await p.locator(".br .keep-confirm").click();
  await p.waitForTimeout(600);
  check((await p.locator(".br-item").count()) === 1, "branch not closed");
  check((await engineName(p)) === "Branchy", `main after keep: ${await engineName(p)}`);
  check((await p.locator(".br-history").innerText()).includes('Kept "+ new name"'), "no history line");
  await p.keyboard.press("Escape");
  // Opening the saved file brings both branches back.
  await template(p, "empty");
  await p.setInputFiles("#file", path);
  await p.waitForTimeout(900);
  check((await toast(p)).includes("2 branches"), `toast: ${await toast(p)}`);
  await p.click("#branch-btn");
  check((await p.locator(".br-item").count()) === 2, "saved branches not opened");
});

await test("importing a block file only accepts .block.rs files", async (p) => {
  await p.setInputFiles("#block-file", { name: "search.rs", mimeType: "text/plain", buffer: Buffer.from("fn main() {}") });
  await p.waitForTimeout(200);
  check((await toast(p)).includes("is not a block file"), `toast: ${await toast(p)}`);
  check((await p.locator("#block-file").getAttribute("accept")) === ".rs", "file picker filter");
});

await test("on the website, Run and Terminal explain the desktop app", async (p) => {
  await template(p, "starter");
  await p.click("#run-btn");
  await p.waitForTimeout(200);
  check(await p.locator("#dock").isVisible(), "dock not open");
  check((await p.locator("#dock .dock-notice").first().innerText()).includes("desktop app"), "no desktop notice");
  await p.click("#terminal-btn");
  check((await p.locator("#dock .terminal-pane .dock-notice").innerText()).includes("terminal"), "no terminal notice");
  await p.click("#terminal-btn");
  check(!(await p.locator("#dock").isVisible()), "Terminal again closes the dock");
});

/** A fake desktop app: a pretend cargo and a pretend engine that answers UCI. */
function desktopMock(): void {
  const calls: unknown[][] = [];
  type OnEvent = ((e: { kind: string; text: string }) => void) | null;
  const onEvent: OnEvent = null;
  let onTerm: ((d: string) => void) | null = null;
  const disk: Record<string, Uint8Array> = {};
  const engines: Record<string, { cb: (e: { kind: string; text: string }) => void; moves: number }> = {};
  let watchCb: ((lines: string[]) => void) | null = null;
  (window as unknown as { __calls: unknown[][] }).__calls = calls;
  (window as unknown as { __cfsDesktopMock: unknown }).__cfsDesktopMock = {
    defaultProjectDir: async (name: string) => `/data/engines/${name}`,
    writeProject: async (dir: string, files: { path: string }[]) => void calls.push(["write", dir, files.map((f) => f.path)]),
    rustVersion: async () => "cargo 1.90.0",
    buildEngine: async (dir: string, onLine: (l: string) => void) => {
      calls.push(["build", dir]);
      onLine("   Compiling cozy-chess v0.3.4");
      onLine("    Finished `release` profile [optimized] target(s)");
      return `${dir}/target/release/engine`;
    },
    startEngine: async (id: string, program: string, _dir: string, cb: typeof onEvent) => {
      calls.push(["start", program, id]);
      engines[id] = { cb: cb!, moves: 0 };
    },
    sendEngine: async (id: string, line: string) => {
      calls.push(["send", line, id]);
      const e = engines[id];
      if (!e) throw new Error("The engine is not running.");
      const say = (t: string) => setTimeout(() => e.cb({ kind: "line", text: t }), 5);
      if (line === "uci") (say("id name Mock"), say("uciok"));
      else if (line === "isready") say("readyok");
      else if (line.startsWith("position")) e.moves = (line.split(" moves ")[1] ?? "").split(" ").filter(Boolean).length;
      else if (line.startsWith("go")) {
        // A scripted game: Scholar's mate.
        const script = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
        const move = script[e.moves] ?? "e2e4";
        say(`info depth 5 seldepth 7 score cp ${e.moves % 2 ? -20 : 25} nodes 12345 nps 500000 pv ${move}`);
        setTimeout(() => e.cb({ kind: "line", text: `bestmove ${move}` }), 40);
      }
    },
    stopEngine: async (id: string) => {
      calls.push(["stop", id]);
      delete engines[id];
    },
    openTerminal: async (dir: string, _c: number, _r: number, cb: (d: string) => void) => {
      calls.push(["term", dir]);
      onTerm = cb;
      cb(`${dir}$ `);
      return 1;
    },
    writeTerminal: async (_id: number, data: string) => onTerm?.(data === "\r" ? "\r\n" : data),
    resizeTerminal: async () => {},
    closeTerminal: async () => {},
    revealFolder: async (dir: string) => void calls.push(["reveal", dir]),
    openUrl: async (url: string) => void calls.push(["url", url]),
    pickFolder: async () => null,
    pickSaveFile: async (name: string) => `/home/me/${name}`,
    pickOpenFile: async () => "/home/me/my-engine.cfs",
    writeFile: async (path: string, data: Uint8Array) => {
      calls.push(["writeFile", path, data.length]);
      disk[path] = data;
    },
    findFastchess: async () => (disk["fastchess"] ? "/tools/fastchess" : null),
    installFastchess: async (onLine: (l: string) => void) => {
      onLine("Downloading fastchess");
      disk["fastchess"] = new Uint8Array(1);
      calls.push(["installFastchess"]);
      return "/tools/fastchess";
    },
    getBook: async (file: string) => {
      calls.push(["getBook", file]);
      return `/tools/books/${file}`;
    },
    runBench: async (program: string) => {
      calls.push(["bench", program]);
      return program.includes("renamed") ? "40000 nodes 800000 nps" : "35000 nodes 700000 nps";
    },
    startTest: async (program: string, args: string[], _dir: string, cb: (e: { kind: string; text: string }) => void) => {
      calls.push(["startTest", program, args]);
      const lines = [
        "Started game 1 of 200 (a vs b)",
        "Results of a vs b (5+0.05, 1t, 16MB, UHO_4060_v2.epd):",
        "Elo: 30.10 +/- 12.40, nElo: 40.00 +/- 15.00",
        "Games: 120, Wins: 50, Losses: 40, Draws: 30, Points: 65.0 (54.17 %)",
        "Ptnml(0-2): [5, 10, 20, 15, 10], WL/DD Ratio: 0.50",
        "LLR: 1.20 (40.8%) (-2.94, 2.94) [0.00, 10.00]",
        "Elo: 28.00 +/- 10.00, nElo: 38.00 +/- 13.00",
        "Games: 200, Wins: 80, Losses: 64, Draws: 56, Points: 108.0 (54.00 %)",
        "Ptnml(0-2): [8, 16, 34, 26, 16], WL/DD Ratio: 0.50",
        "LLR: 2.95 (100.2%) (-2.94, 2.94) [0.00, 10.00]",
        "SPRT ([0.00, 10.00]) completed - H1 was accepted",
      ];
      lines.forEach((text, i) => setTimeout(() => cb({ kind: "line", text }), 250 * (i + 1)));
      // With watching on, the engine log shows two games being played.
      if (args.some((a) => a === "-log")) {
        const log = (t: string, n: string, msg: string) => `[Engine] [t] <     ${t}>  ${n} <--- ${msg}`;
        const steps = [
          [log("1", "a", "position startpos moves e2e4 e7e5"), log("2", "b", "position startpos moves d2d4")],
          [log("1", "a", "go wtime 9000 btime 9000 winc 100 binc 100"), log("1", "b", "position startpos moves e2e4 e7e5 g1f3")],
        ];
        steps.forEach((lines, i) => setTimeout(() => watchCb?.(lines), 100 + 150 * i));
      }
      setTimeout(() => cb({ kind: "exit", text: "fastchess finished." }), 250 * (lines.length + 2));
    },
    stopTest: async () => void calls.push(["stopTest"]),
    watchGames: async (path: string, cb: (lines: string[]) => void) => {
      calls.push(["watch", path]);
      watchCb = cb;
    },
    stopWatching: async () => {
      calls.push(["stopWatching"]);
      watchCb = null;
    },
    readFile: async (path: string) => {
      if (!disk[path]) throw new Error(`no file ${path}`);
      return disk[path];
    },
  };
}
const calls = (p: Page) => p.evaluate(() => (window as unknown as { __calls: unknown[][] }).__calls);

await test("desktop: Run builds the engine, starts it and you can talk UCI", async (p) => {
  await template(p, "starter");
  await p.click("#run-btn");
  await p.waitForSelector("#dock .out-engine:has-text('uciok')");
  const c = await calls(p);
  const write = c.find((x) => x[0] === "write")!;
  check(write[1] === "/data/engines/my_engine" || String(write[1]).startsWith("/data/engines/"), `dir ${write[1]}`);
  check((write[2] as string[]).includes("src/search.rs"), "project not written");
  check(c.some((x) => x[0] === "build") && c.some((x) => x[0] === "start"), JSON.stringify(c));
  check((await p.locator("#dock .out-build").allInnerTexts()).some((l) => l.includes("Compiling")), "build output not shown");
  check((await p.locator("#dock").getAttribute("data-state")) === "running", "not running");
  check((await p.locator("#run-btn").isVisible()) && (await p.locator("#dock .dock-btn.run").innerText()).includes("Rebuild"), "no Rebuild");
  // Quick buttons and the command line with history.
  await p.locator("#dock .dock-chip", { hasText: "isready" }).click();
  await p.waitForSelector("#dock .out-engine:has-text('readyok')");
  await p.locator("#dock .dock-chip", { hasText: "go depth" }).click();
  await p.waitForSelector("#dock .out-engine:has-text('bestmove')");
  check((await calls(p)).some((x) => x[0] === "send" && x[1] === "go depth 6"), "go depth 6 not sent");
  await p.fill("#dock .dock-fen", "8/8/8/8/8/8/8/K6k w - - 0 1");
  await p.locator("#dock .dock-chip", { hasText: "Set position" }).click();
  await p.fill("#dock .dock-input", "go movetime 50");
  await p.press("#dock .dock-input", "Enter");
  await p.press("#dock .dock-input", "ArrowUp");
  check((await p.inputValue("#dock .dock-input")) === "go movetime 50", "history");
  const sent = (await calls(p)).filter((x) => x[0] === "send").map((x) => x[1]);
  check(sent.includes("position fen 8/8/8/8/8/8/8/K6k w - - 0 1") && sent.includes("go movetime 50"), JSON.stringify(sent));
  if (process.env.CFS_SHOTS) await p.screenshot({ path: join(process.env.CFS_SHOTS, "dock.png"), clip: { x: 0, y: 1300, width: 1600, height: 700 } });
  await p.locator("#dock .dock-btn", { hasText: "Stop" }).click();
  await p.waitForTimeout(100);
  check((await p.locator("#dock").getAttribute("data-state")) === "stopped", "not stopped");
}, desktopMock);

await test("desktop: Run says what is missing, and the terminal opens in the engine folder", async (p) => {
  await p.click("#run-btn");
  await p.waitForTimeout(200);
  check((await p.locator("#dock .out-error").innerText()).includes("Engine block"), "no reason shown");
  await template(p, "starter");
  await p.click("#terminal-btn");
  await p.waitForSelector("#dock .xterm");
  await p.waitForTimeout(300);
  const term = (await calls(p)).find((x) => x[0] === "term");
  check(term && String(term[1]).startsWith("/data/engines/"), JSON.stringify(term));
  check((await p.locator("#dock .xterm-rows").innerText()).includes("/data/engines/"), "terminal shows no prompt");
  // Web links open in the browser.
  await menu(p, "#feedback-btn");
  check((await calls(p)).some((x) => x[0] === "url" && String(x[1]).includes("github.com")), "feedback link not opened in the browser");
}, desktopMock);

await test("desktop: Save writes the file, changes are saved to it, Open reads it back", async (p) => {
  await template(p, "starter");
  await menu(p, "#save");
  await p.waitForTimeout(300);
  check((await toast(p)).includes("/home/me/my-engine.cfs"), `toast: ${await toast(p)}`);
  await setEngineName(p, "Autosaved");
  await p.waitForTimeout(2200);
  const writes = (await calls(p)).filter((x) => x[0] === "writeFile");
  check(writes.length >= 2, `autosave: ${JSON.stringify(writes)}`);
  await template(p, "empty");
  await menu(p, "#open");
  await p.waitForTimeout(800);
  check((await engineName(p)) === "Autosaved", `opened: ${await engineName(p)}`);
  // Each branch runs in its own folder.
  await p.click("#branch-btn");
  await p.fill(".br-new input", "try");
  await p.locator(".br-new button").click();
  await p.keyboard.press("Escape");
  await p.click("#run-btn");
  await p.waitForSelector("#dock .out-engine:has-text('uciok')");
  const write = (await calls(p)).find((x) => x[0] === "write")!;
  check(String(write[1]).endsWith("-try"), `branch folder: ${write[1]}`);
}, desktopMock);

await test("tests on the website: the timeline is there, running needs the desktop app", async (p) => {
  await p.click("#tests-btn");
  await p.waitForSelector(".tests-view .ts-page");
  check((await p.locator(".ts-new").innerText()).includes("desktop app"), "no desktop notice");
  check((await p.locator(".ts-timeline").innerText()).includes("No tests yet"), "timeline");
  if (process.env.CFS_SHOTS) {
    await p.click("#menu-btn");
    await p.screenshot({ path: join(process.env.CFS_SHOTS, "menu.png"), clip: { x: 0, y: 0, width: 1600, height: 460 } });
  }
});

await test("desktop: a test builds both branches, plays, passes, and Keep merges the branch", async (p) => {
  await template(p, "starter");
  await p.click("#branch-btn");
  await p.fill(".br-new input", "+ renamed");
  await p.locator(".br-new button").click();
  await p.keyboard.press("Escape");
  await setEngineName(p, "Renamed");
  await p.waitForTimeout(300);
  await p.click("#tests-btn");
  await p.waitForSelector(".ts-start");
  check((await p.locator(".ts-what").innerText()).includes("Engine name"), `what: ${await p.locator(".ts-what").innerText()}`);
  check((await p.locator(".ts-preset").allInnerTexts()).join(",") === "VSTC,STC,LTC,STC Regression", "preset names");
  await p.locator('.ts-preset[data-preset="standard"]').click();
  await p.click(".ts-start");
  // The output stays open while results come in (redraws keep it open).
  await p.waitForSelector(".ts-run .ts-log summary");
  await p.locator(".ts-run .ts-log summary").click();
  await p.waitForSelector(".ts-run .ts-badge.ts-passed", { timeout: 15000 });
  check(await p.locator(".ts-run .ts-log").evaluate((d) => (d as HTMLDetailsElement).open), "the output closed during the test");
  const run = await p.locator(".ts-run").innerText();
  check(run.includes("+28.0 ± 10.0") && run.includes("200"), `run: ${run.slice(0, 300)}`);
  check(run.includes("40000 / 35000"), "bench numbers");
  check((await p.locator(".ts-run .chart svg").count()) === 3, "Elo, LLR and pentanomial graphs");
  check((await p.locator(".ts-run .chart-bar").count()) === 5, "five pentanomial bars");
  const c = await calls(p);
  check(c.some((x) => x[0] === "installFastchess") && c.some((x) => x[0] === "getBook" && x[1] === "UHO_4060_v2.epd"), "setup steps");
  const args = (c.find((x) => x[0] === "startTest")![2] as string[]).join(" ");
  check(args.includes("tc=10+0.1") && args.includes("elo1=5") && args.includes("file=/tools/books/UHO_4060_v2.epd"), args);
  check((c.filter((x) => x[0] === "build") as unknown[][]).length === 2, "both engines built");
  if (process.env.CFS_SHOTS) await p.screenshot({ path: join(process.env.CFS_SHOTS, "tests.png") });
  // Keep it: the review opens, then main gets the branch.
  await p.click(".ts-keep");
  await p.waitForSelector(".br-review");
  await p.locator(".br .keep-confirm").click();
  await p.waitForTimeout(500);
  check((await engineName(p)) === "Renamed", "not kept");
  await p.keyboard.press("Escape");
  await p.click("#tests-btn");
  const timeline = await p.locator(".ts-timeline").innerText();
  check(timeline.includes("passed") && timeline.includes("kept") && timeline.includes("+28.0"), `timeline: ${timeline}`);
  check((await p.locator(".ts-elochart .chart-whisker").count()) > 0, "no Elo chart with error bars");
  // The chart folds away, and stays folded.
  await p.locator(".ts-elochart summary").click();
  check(!(await p.locator(".ts-elochart").evaluate((d) => (d as HTMLDetailsElement).open)), "chart did not fold");
  // A past test opens on its own page: settings, graphs, and the code diff of that time.
  await p.locator(".ts-item").first().click();
  await p.waitForSelector(".ts-back");
  const detail = await p.locator(".ts-run").innerText();
  check(detail.includes("10+0.1") && detail.includes("UHO_4060_v2.epd") && detail.includes("[0, 5]"), `detail: ${detail.slice(0, 400)}`);
  await p.locator(".ts-whatwas .br-code summary").click();
  await p.waitForSelector(".ts-whatwas .cd-file");
  check((await p.locator(".ts-whatwas .cd").innerText()).includes("Renamed"), "no diff of the tested code");
  if (process.env.CFS_SHOTS) await p.screenshot({ path: join(process.env.CFS_SHOTS, "testdetail.png"), fullPage: true });
  await p.click(".ts-back");
  check(await p.locator("main.layout").isHidden(), "the editor shows behind the tests view");
  await p.click("#engine-btn");
  check(await p.locator("main.layout").isVisible(), "the editor did not come back");
  await p.click("#branch-btn");
  check((await p.locator(".br-history").innerText()).includes("Tested"), "no history line for the test");
}, desktopMock);

await test("desktop: the branches tutorial goes from the random mover to a tested, kept Negamax", async (p) => {
  const next = async () => {
    await p.waitForSelector(".tut-state.ok", { timeout: 15000 });
    await p.locator('.tut [data-act="next"]').click();
    await p.waitForTimeout(200);
  };
  const title = () => p.locator(".tut-title").innerText();
  await menu(p, "#tutorial2-btn");
  check((await title()).includes("Branches and tests"), await title());
  await p.locator('.tut [data-act="action"]').click();
  await next();
  await p.click("#branch-btn");
  await next();
  await p.fill(".br-new input", "+ negamax");
  await p.locator(".br-new button").click();
  await next();
  await p.keyboard.press("Escape");
  // Steps 3 to 5: Negamax, an evaluation with Material, Iterative deepening.
  const ws = starterWorkspace();
  ws.eval.terms = [{ type: "material", params: {} }];
  ws.search.slots.root = [{ type: "iterative_deepening", params: {} }];
  await p.evaluate((w) => (window as unknown as { __cfsLoad(x: unknown): void }).__cfsLoad(w), ws);
  for (let k = 0; k < 3; k++) await next();
  check((await title()).includes("What changed"), await title());
  await p.click("#branch-btn");
  check((await p.locator(".br-item.current .br-changes").innerText()).includes("Negamax search"), "change list");
  await next();
  await p.keyboard.press("Escape");
  await p.click("#tests-btn");
  await next();
  await p.locator('.ts-preset[data-preset="quick"]').click();
  await p.click(".ts-start");
  await next();
  await next(); // passes
  await p.click(".ts-keep");
  await p.locator(".br .keep-confirm").click();
  await next();
  check((await title()).startsWith("Done"), await title());
  await p.locator('.tut [data-act="next"]').click();
  check((await p.locator(".tut").count()) === 0, "tutorial still open");
}, desktopMock);

/** Clicks a square of the Play board (White at the bottom unless flipped). */
const clickSquare = async (p: Page, sq: string, flipped = false) => {
  const box = (await p.locator(".pl-board cg-board").boundingBox())!;
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  const size = box.width / 8;
  const x = flipped ? 7 - file : file;
  const y = flipped ? rank : 7 - rank;
  await p.mouse.click(box.x + (x + 0.5) * size, box.y + (y + 0.5) * size);
  await p.waitForTimeout(120);
};

await test("play on the website explains the desktop app", async (p) => {
  await p.click("#play-btn");
  check((await p.locator(".pl-setup").innerText()).includes("desktop app"), "no desktop notice");
  check((await p.locator(".pl-board cg-board").count()) === 1, "no board");
  check(await p.locator("main.layout").isHidden(), "editor still visible");
  await p.click("#engine-btn");
  check(await p.locator("main.layout").isVisible(), "editor did not come back");
});

await test("desktop: play against your engine, take back, and finish with mate", async (p) => {
  await template(p, "starter");
  await p.click("#play-btn");
  await p.locator('.pl-color [data-value="w"]').click();
  await p.locator('.pl-timekind [data-value="depth"]').click();
  await p.click(".pl-start");
  await p.waitForSelector(".pl-game");
  await p.waitForFunction(() => document.querySelector(".pl-status")?.textContent === "Your move");
  await clickSquare(p, "e2");
  await clickSquare(p, "e4");
  await p.waitForFunction(() => document.querySelectorAll(".pl-san").length >= 2);
  check((await p.locator(".pl-moves").innerText()).includes("e5"), `moves: ${await p.locator(".pl-moves").innerText()}`);
  check((await p.locator(".pl-info").innerText()).includes("depth 5"), "no engine info");
  // Take back: the engine's reply and your move are undone.
  await p.click(".pl-takeback");
  await p.waitForTimeout(300);
  check((await p.locator(".pl-san").count()) === 0, `after take back: ${await p.locator(".pl-moves").innerText()}`);
  for (const [a, b] of [["e2", "e4"], ["f1", "c4"], ["d1", "h5"], ["h5", "f7"]]) {
    await p.waitForFunction(() => document.querySelector(".pl-status")?.textContent === "Your move", undefined, { timeout: 5000 }).catch(() => undefined);
    await clickSquare(p, a!);
    await clickSquare(p, b!);
    await p.waitForTimeout(250);
  }
  await p.waitForSelector(".pl-status.pl-over");
  check((await p.locator(".pl-status").innerText()).includes("White wins: checkmate"), await p.locator(".pl-status").innerText());
  check((await p.locator(".pl-moves").innerText()).includes("Qxf7#"), "mate not in the moves");
  check((await calls(p)).filter((x) => x[0] === "start" && x[2] === "black").length >= 1, "engine ran as black");
  if (process.env.CFS_SHOTS) await p.screenshot({ path: join(process.env.CFS_SHOTS, "play.png") });
}, desktopMock);

await test("desktop: two branches play each other, with clocks", async (p) => {
  await template(p, "starter");
  await p.click("#branch-btn");
  await p.fill(".br-new input", "other");
  await p.locator(".br-new button").click();
  await p.keyboard.press("Escape");
  await p.click("#play-btn");
  await p.locator('.pl-mode [data-value="engines"]').click();
  await p.locator('.pl-timekind [data-value="clock"]').click();
  await p.selectOption(".pl-white", "main");
  await p.selectOption(".pl-black", "other");
  await p.click(".pl-start");
  await p.waitForSelector(".pl-status.pl-over", { timeout: 10000 });
  check((await p.locator(".pl-status").innerText()).includes("checkmate"), await p.locator(".pl-status").innerText());
  check(/\d:\d\d/.test(await p.locator(".pl-top .pl-clock").innerText()), "no clock");
  const c = await calls(p);
  check(c.some((x) => x[0] === "send" && String(x[1]).startsWith("go wtime")), "no clock times sent");
  check(c.filter((x) => x[0] === "build").length === 2, "both branches built");
}, desktopMock);

await test("desktop: watching a test shows its games on boards", async (p) => {
  await template(p, "starter");
  await p.click("#branch-btn");
  await p.fill(".br-new input", "watched");
  await p.locator(".br-new button").click();
  await p.keyboard.press("Escape");
  await p.click("#tests-btn");
  await p.locator(".ts-watch input").check();
  check((await p.locator(".ts-watchwarn").innerText()).includes("costs speed"), "no warning");
  await p.click(".ts-start");
  await p.waitForSelector(".lg-card", { timeout: 10000 });
  await p.waitForFunction(() => document.querySelectorAll(".lg-card").length === 2);
  await p.waitForTimeout(400);
  check((await p.locator(".lg-card").first().innerText()).includes("move 2"), await p.locator(".lg-card").first().innerText());
  check((await p.locator(".lg-card piece").count()) > 50, "no pieces on the boards");
  const args = ((await calls(p)).find((x) => x[0] === "startTest")![2] as string[]).join(" ");
  check(args.includes("-log file=") && args.includes("engine=true"), args);
  await p.waitForSelector(".ts-run .ts-badge.ts-passed", { timeout: 15000 });
  check((await calls(p)).some((x) => x[0] === "stopWatching"), "watching not stopped");
  if (process.env.CFS_SHOTS) await p.screenshot({ path: join(process.env.CFS_SHOTS, "live.png") });
}, desktopMock);

await test("the guide shows its pages and links between them", async (p) => {
  await p.goto(url.replace(/\/?$/, "/") + "guide.html");
  await p.waitForSelector(".guide-main h1");
  check((await p.locator(".guide-main h1").innerText()) === "Chess From Scratch", await p.locator(".guide-main h1").innerText());
  await p.locator(".guide-main a", { hasText: "Your first engine" }).first().click();
  await p.waitForTimeout(200);
  check((await p.locator(".guide-main h1").innerText()) === "Your first engine", "wiki link did not open the page");
  check((await p.locator(".guide-nav a.current").innerText()) === "Your first engine", "sidebar does not show the page");
});

await test("the tutorial builds a random mover from an empty canvas", async (p) => {
  // A first visit gets the offer.
  await p.evaluate(() => {
    localStorage.removeItem("cfs.tutorial.seen");
    sessionStorage.setItem("cfs.e2e.offer", "1");
  });
  await p.reload();
  await p.waitForSelector(".tut-offer", { timeout: 4000 });
  await p.locator('.tut [data-act="start"]').click();
  // The canvas is already empty on a first visit, so there is nothing to clear.
  if (await p.locator('.tut [data-act="action"]').count()) await p.locator('.tut [data-act="action"]').click();
  await p.waitForTimeout(500);
  check((await p.locator(".tut-state.ok").count()) === 1, "empty canvas not detected");
  await p.locator('.tut [data-act="next"]').click();
  check((await p.locator("#cat_engine.tut-target, .tut-target").count()) >= 1, "nothing points at the Engine category");
  // Step 1: the Engine block.
  await p.evaluate(() => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    const b = bw.newBlock("cfs_engine");
    b.initSvg();
    b.render();
    b.moveBy(80, 60);
  });
  await p.waitForTimeout(600);
  check((await p.locator(".tut-state.ok").count()) === 1, "engine block not detected");
  await p.locator('.tut [data-act="next"]').click();
  // Step 2: a name.
  await p.evaluate(() => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    bw.getBlocksByType("cfs_engine", false)[0]!.setFieldValue("Rando", "NAME");
  });
  await p.waitForTimeout(600);
  check((await p.locator(".tut-body").innerText()).includes("rando"), "crate name not shown");
  await p.locator('.tut [data-act="next"]').click();
  // Step 3: Random mover in the search slot.
  await p.evaluate(() => {
    const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
    const engine = bw.getBlocksByType("cfs_engine", false)[0]!;
    const r = bw.newBlock("cfs_random_mover");
    r.initSvg();
    r.render();
    engine.getInput("SEARCH")!.connection!.connect(r.previousConnection!);
  });
  await p.waitForTimeout(800);
  check((await p.locator(".tut-state.ok").count()) === 1, "random mover not detected");
  check((await p.locator(".tour:not([hidden])").count()) === 0 || !(await p.locator(".tour").first().isVisible()), "a change tour opened during the tutorial");
  await p.locator('.tut [data-act="next"]').click();
  // Step 4: open src/search.rs.
  await p.locator('.tree-file[data-path="src/search.rs"]').click();
  await p.waitForTimeout(300);
  check((await p.locator(".tut-state.ok").count()) === 1, "opening search.rs not detected");
  await p.locator('.tut [data-act="next"]').click();
  // Step 5: the code is highlighted.
  await p.waitForTimeout(300);
  const marked = await p.locator(".code .ln.tut-line").allInnerTexts();
  check(marked.some((l) => l.includes("fn search(")), `highlighted: ${marked.slice(0, 2).join(" | ")}`);
  for (let k = 0; k < 3; k++) await p.locator('.tut [data-act="next"]').click();
  // Step 8: export.
  check((await p.locator(".tut-title").innerText()).startsWith("8."), await p.locator(".tut-title").innerText());
  const download = p.waitForEvent("download");
  await p.click("#export");
  await download;
  await p.waitForTimeout(300);
  check((await p.locator(".tut-state.ok").count()) === 1, "export not detected");
  for (let k = 0; k < 5; k++) await p.locator('.tut [data-act="next"]').click();
  check((await p.locator(".tut-title").innerText()).startsWith("Done"), await p.locator(".tut-title").innerText());
  await p.locator('.tut [data-act="next"]').click();
  check((await p.locator(".tut").count()) === 0, "tutorial still open");
});

console.log(`\n${passed} passed, ${failed} failed${pageErrors.length ? `; page errors: ${pageErrors.join(" | ")}` : ""}`);
await browser.close();
await server.close();
process.exit(failed || pageErrors.length ? 1 : 0);
