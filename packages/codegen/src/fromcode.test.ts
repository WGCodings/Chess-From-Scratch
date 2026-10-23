import { describe, expect, it } from "vitest";
import {
  EXAMPLE_BLOCKS,
  codeToBlocks,
  generateProject,
  parseBlockFile,
  referenceWorkspace,
  starterWorkspace,
  validate,
  viewOf,
  type CustomSlot,
  type Workspace,
} from "./index";

function bare(): Workspace {
  const ws = starterWorkspace();
  ws.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
  ws.search.slots.leaf.push({ type: "quiescence", params: {} });
  return ws;
}

function place(ws: Workspace, id: string, src: string, slot: CustomSlot): Workspace {
  ws.customBlocks = { ...ws.customBlocks, [id]: src };
  if (slot === "eval") ws.eval.terms.push({ type: id, params: {} });
  else ws.search.slots[slot].push({ type: id, params: {} });
  return ws;
}

/** The view of a file and a helper to edit it. */
function view(ws: Workspace, path = "src/search.rs") {
  const files = generateProject(ws);
  const lines = viewOf(files.find((f) => f.path === path)!).lines;
  return { files, lines };
}

const at = (lines: string[], text: string, nth = 1) => {
  let seen = 0;
  const i = lines.findIndex((l) => l.trim() === text && ++seen === nth);
  if (i < 0) throw new Error(`no line ${text}`);
  return i;
};

const CHECK = [
  "            // @block checkextension",
  "            // Check extension: a move that gives check is searched one ply deeper.",
  "            if !pos.board().checkers().is_empty() {",
  "                extension += MY_EXTENSION;",
  "            }",
  "            // @end checkextension",
];

describe("viewOf", () => {
  it("shows hooks, also those a slot switches on", () => {
    const { lines } = view(bare());
    expect(lines.some((l) => l.trim() === "// @hook pruning")).toBe(true);
    expect(lines.some((l) => l.trim() === "// @hook extensions")).toBe(true);
    expect(lines.some((l) => l.trim() === "// @hook ordering")).toBe(true);
  });

  it("changes nothing when nothing was edited", () => {
    const ws = bare();
    const { files, lines } = view(ws);
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r).toEqual({ sources: {}, created: [], forks: [], changed: [], errors: [] });
  });
});

describe("codeToBlocks", () => {
  it("turns code under a hook into a new block with its parameters", () => {
    const ws = bare();
    const { files, lines } = view(ws);
    lines.splice(at(lines, "// @hook extensions") + 1, 0, ...CHECK);
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual([{ id: "checkextension", slot: "extensions" }]);
    const src = r.sources.checkextension!;
    const block = parseBlockFile(src).block!;
    expect(block.params.map((p) => p.rust)).toEqual(["MY_EXTENSION"]);
    expect(block.sections).toEqual([
      expect.objectContaining({ kind: "hook", hook: "extensions", body: expect.stringContaining("extension += MY_EXTENSION;") }),
    ]);
    place(ws, "checkextension", src, "extensions");
    expect(validate(ws).filter((i) => i.level === "error")).toEqual([]);
    const search = generateProject(ws).find((f) => f.path === "src/search.rs")!.contents;
    expect(search).toContain("            // @block checkextension\n            // Check extension");
    expect(search).toContain("let new_depth = depth - 1 + extension;");
  });

  it("attaches code elsewhere to the line above it, by occurrence", () => {
    const ws = bare();
    const { files, lines } = view(ws);
    const k = at(lines, "self.seldepth = self.seldepth.max(ply);", 2);
    lines.splice(k + 1, 0, "        // @block deep_count", "        self.nodes += 0;", "        // @end deep_count");
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors).toEqual([]);
    const block = parseBlockFile(r.sources.deep_count!).block!;
    expect(block.sections[0]).toMatchObject({ kind: "insert", file: "search.rs", anchor: "self.seldepth = self.seldepth.max(ply);" });
    place(ws, "deep_count", r.sources.deep_count!, block.slot as CustomSlot);
    const out = generateProject(ws).find((f) => f.path === "src/search.rs")!.contents.split("\n");
    const placedAt = out.findIndex((l) => l.includes("self.nodes += 0;"));
    expect(out[placedAt - 2]!.trim()).toBe("self.seldepth = self.seldepth.max(ply);");
    // The same occurrence the user picked: the second one, in qsearch.
    expect(out.filter((l) => l.trim() === "self.seldepth = self.seldepth.max(ply);").length).toBe(2);
    const second = out.map((l, i) => (l.trim() === "self.seldepth = self.seldepth.max(ply);" ? i : -1)).filter((i) => i >= 0)[1];
    expect(placedAt - 2).toBe(second);
  });

  it("saves edits inside a custom block to its file, keeping the rest of the file", () => {
    const ws = place(bare(), "check_extension", EXAMPLE_BLOCKS.check_extension!, "extensions");
    const { files, lines } = view(ws);
    const k = at(lines, "extension += CHECK_EXTENSION;");
    lines[k] = lines[k]!.replace("extension += CHECK_EXTENSION;", "extension += CHECK_EXTENSION * CHECK_SCALE;");
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors).toEqual([]);
    const src = r.sources.check_extension!;
    expect(src).toContain("extension += CHECK_EXTENSION * CHECK_SCALE;");
    expect(src).toContain("//! info: A move that gives check");
    expect(src).toContain("//!   CHECK_SCALE: i32 = 1");
    expect(parseBlockFile(src).diagnostics).toEqual([]);
  });

  it("removes a block's code when its markers and code are deleted", () => {
    const ws = place(bare(), "cutoff_table", EXAMPLE_BLOCKS.cutoff_table!, "ordering");
    const { files, lines } = view(ws);
    const s = at(lines, "// @block cutoff_table", 4);
    const e = at(lines, "// @end cutoff_table", 4);
    lines.splice(s, e - s + 1);
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors).toEqual([]);
    const block = parseBlockFile(r.sources.cutoff_table!).block!;
    expect(block.sections.map((x) => (x.kind === "hook" ? x.hook : x.kind))).toHaveLength(4);
  });

  it("makes your own version of a built-in block you edited", () => {
    const ws = referenceWorkspace();
    const { files, lines } = view(ws);
    const k = at(lines, "let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;");
    lines[k] = "            let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + depth / NMP_SCALED_REDUCTION;";
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors).toEqual([]);
    expect(r.forks).toEqual([{ base: "null_move_pruning", id: "my_null_move_pruning" }]);
    const src = r.sources.my_null_move_pruning!;
    expect(src).toContain("depth / NMP_SCALED_REDUCTION;");
    expect(src).toContain("//!   NMP_SCALED_REDUCTION: i32 = 1");
    // Swap it in: the generated code is what was typed.
    ws.customBlocks = { my_null_move_pruning: src };
    ws.search.slots.pruning = ws.search.slots.pruning.map((b) => (b.type === "null_move_pruning" ? { type: "my_null_move_pruning", params: b.params } : b));
    const out = generateProject(ws).find((f) => f.path === "src/search.rs")!.contents;
    expect(out).toContain(lines[k]);
  });

  it("makes your own version of the skeleton you change", () => {
    const ws = bare();
    const { files, lines } = view(ws);
    const k = at(lines, "self.seldepth = self.seldepth.max(ply);", 1);
    lines[k] = "        self.seldepth = ply;";
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors).toEqual([]);
    expect(r.forks).toEqual([{ base: "negamax", id: "my_negamax" }]);
  });

  it("refuses loose code and reused names", () => {
    const ws = bare();
    const { files, lines } = view(ws);
    lines.splice(at(lines, "// @hook pruning") + 1, 0, "        let x = 1;");
    expect(codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]).errors[0]!.message).toMatch(/Wrap new code/);
    const { lines: l2 } = view(ws);
    l2.splice(at(l2, "// @hook pruning") + 1, 0, "        // @block tempo", "        // @end tempo");
    expect(codeToBlocks(ws, files, [{ path: "src/search.rs", text: l2.join("\n") }], ["tempo"]).errors[0]!.message).toMatch(/already a block/);
  });

  it("refuses new hook lines: hooks are fixed", () => {
    const ws = bare();
    const { files, lines } = view(ws);
    const k = at(lines, "self.seldepth = self.seldepth.max(ply);", 1);
    lines.splice(k + 1, 0, "        // @hook after_seldepth");
    const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
    expect(r.errors[0]!.message).toMatch(/Hooks are fixed/);
  });

  it("puts code from two files into one block", () => {
    const ws = bare();
    const files = generateProject(ws);
    const s = viewOf(files.find((f) => f.path === "src/search.rs")!).lines;
    s.splice(at(s, "// @hook pruning") + 1, 0, "        // @block both", "        let _ = both_bonus();", "        // @end both");
    const e = viewOf(files.find((f) => f.path === "src/eval.rs")!).lines;
    e.splice(at(e, "// @hook eval_helpers") + 1, 0, "// @block both", "pub fn both_bonus() -> i32 {", "    0", "}", "// @end both");
    const r = codeToBlocks(ws, files, [
      { path: "src/search.rs", text: s.join("\n") },
      { path: "src/eval.rs", text: e.join("\n") },
    ]);
    expect(r.errors).toEqual([]);
    expect(parseBlockFile(r.sources.both!).block!.sections.map((x) => (x.kind === "hook" ? x.hook : x.kind))).toEqual([
      "pruning",
      "eval_helpers",
    ]);
  });
});
