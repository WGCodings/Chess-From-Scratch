import { describe, expect, it } from "vitest";
import {
  EXAMPLE_BLOCKS,
  HOOKS,
  TEMPLATES,
  findRegions,
  forkBlock,
  freeId,
  generateProject,
  newBlockSource,
  parseBlockFile,
  referenceWorkspace,
  serializeBlock,
  starterWorkspace,
  validate,
  type Workspace,
} from "./index";

const errors = (src: string) => parseBlockFile(src).diagnostics.filter((d) => d.level === "error");

function place(ws: Workspace, id: string, src: string, slot: string): Workspace {
  ws.customBlocks = { ...ws.customBlocks, [id]: src };
  if (slot === "eval") ws.eval.terms.push({ type: id, params: {} });
  else ws.search.slots[slot as keyof Workspace["search"]["slots"]].push({ type: id, params: {} });
  return ws;
}

describe("parseBlockFile", () => {
  it("reads header, parameters and sections", () => {
    const { block, diagnostics } = parseBlockFile(EXAMPLE_BLOCKS.cutoff_table!);
    expect(diagnostics).toEqual([]);
    expect(block!.id).toBe("cutoff_table");
    expect(block!.slot).toBe("ordering");
    expect(block!.requires).toEqual(["alpha_beta"]);
    expect(block!.params).toEqual([
      { key: "CUTOFF_TABLE_MAX", rust: "CUTOFF_TABLE_MAX", label: "Highest order score", type: "i32", default: 70000, min: 1, max: 79999 },
    ]);
    expect(block!.sections.map((s) => (s.kind === "hook" ? s.hook : s.kind))).toEqual([
      "searcher_fields",
      "searcher_init",
      "new_game",
      "ordering",
      "on_cutoff",
    ]);
  });

  it("parses score and array parameters", () => {
    const src = [
      "//! ---",
      "//! id: t",
      "//! slot: eval",
      "//! params:",
      '//!   A: S = S(10, -5) "A bonus"',
      "//!   B: [S; 4] = [S(1, 2), S(3, 4), S(5, 6), S(7, 8)]",
      "//!   C: f64 = 0.5 (0..1)",
      "//! ---",
      "// @hook eval_terms",
      "score += A;",
    ].join("\n");
    const { block, diagnostics } = parseBlockFile(src);
    expect(diagnostics).toEqual([]);
    expect(block!.params.map((p) => p.default)).toEqual([[10, -5], [[1, 2], [3, 4], [5, 6], [7, 8]], 0.5]);
    expect(block!.params[1]!.label).toBe("B");
  });

  it("reports problems with line numbers", () => {
    const src = [
      "//! ---",
      "//! id: Bad-Id",
      "//! slot: nowhere",
      "//! params:",
      "//!   lower: i32 = 4",
      "//!   X: i32 = 99 (1..10)",
      "//! ---",
      "// @hook no_such_hook",
      "x();",
      "// @region search.rs 1",
    ].join("\n");
    const lines = errors(src).map((d) => d.line);
    expect(lines).toEqual(expect.arrayContaining([2, 3, 5, 6, 8, 10]));
  });

  it("warns about brackets that do not close within a section", () => {
    const src = EXAMPLE_BLOCKS.check_extension!.replace("extension += CHECK_EXTENSION;\n}", "extension += CHECK_EXTENSION;");
    const d = parseBlockFile(src).diagnostics;
    expect(d).toEqual([expect.objectContaining({ level: "warning", line: 12, message: expect.stringMatching(/unclosed/) })]);
    for (const base of ["alpha_beta", "aspiration_windows", "null_move_pruning"]) {
      expect(parseBlockFile(forkBlock(base, "my_x")).diagnostics).toEqual([]);
    }
  });

  it("needs a header", () => {
    expect(parseBlockFile("fn x() {}").block).toBeNull();
  });

  it("rejects ids of built-in blocks and warns about anchors that are not unique", () => {
    const src = ['//! ---', "//! id: killers", "//! slot: ordering", "//! ---", '// @insert search.rs after "}"', "x();"].join("\n");
    const msgs = errors(src).map((d) => d.message).join("\n");
    expect(msgs).toMatch(/already used by a built-in/);
    const warnings = parseBlockFile(src).diagnostics.filter((d) => d.level === "warning").map((d) => d.message).join("\n");
    expect(warnings).toMatch(/appears \d+ times/);
  });

  it("reads @replace and @insert before sections and writes them back", () => {
    const src = [
      "//! ---",
      "//! id: my_pvs",
      "//! slot: move_loop",
      "//! requires: my_alpha_beta",
      "//! ---",
      "",
      '// @replace search.rs "let a = 1;" to "let c = 3;" #2',
      "let b = 2;",
      "",
      '// @insert search.rs before "x();"',
      "y();",
      "",
      '// @replace search.rs "gone();"',
    ].join("\n");
    const { block, diagnostics } = parseBlockFile(src);
    expect(diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(block!.sections).toEqual([
      expect.objectContaining({ kind: "replace", file: "search.rs", anchor: "let a = 1;", to: "let c = 3;", nth: 2, body: "let b = 2;" }),
      expect.objectContaining({ kind: "insert", file: "search.rs", anchor: "x();", before: true, body: "y();" }),
      expect.objectContaining({ kind: "replace", file: "search.rs", anchor: "gone();", body: "" }),
    ]);
    expect(parseBlockFile(serializeBlock(block!)).block!.sections).toEqual(
      block!.sections.map((s) => expect.objectContaining({ ...s, line: expect.any(Number) })),
    );
  });

  it("round-trips through serializeBlock", () => {
    const { block } = parseBlockFile(EXAMPLE_BLOCKS.tempo!);
    const again = parseBlockFile(serializeBlock(block!)).block!;
    expect({ ...again, sections: again.sections.map((s) => ({ ...s, line: 0 })) }).toEqual({
      ...block,
      sections: block!.sections.map((s) => ({ ...s, line: 0 })),
    });
  });
});

describe("forkBlock", () => {
  it("copies every region of the base, main code first", () => {
    const src = forkBlock("null_move_pruning", "my_nmp");
    const { block, diagnostics } = parseBlockFile(src);
    expect(diagnostics).toEqual([]);
    expect(block!.base).toBe("null_move_pruning");
    expect(block!.sections[0]).toMatchObject({ kind: "region", file: "search.rs", index: 1 });
    const regions = findRegions(TEMPLATES.search, "null_move_pruning").length + findRegions(TEMPLATES.position, "null_move_pruning").length;
    expect(block!.sections).toHaveLength(regions);
    expect(block!.params.map((p) => p.rust)).toEqual(["NMP_MIN_DEPTH", "NMP_BASE_REDUCTION", "NMP_DEPTH_DIVISOR"]);
  });

  it("generates the same code as the base, credited to the fork", () => {
    const ws = referenceWorkspace();
    ws.customBlocks = { my_nmp: forkBlock("null_move_pruning", "my_nmp") };
    ws.search.slots.pruning = ws.search.slots.pruning.map((b) =>
      b.type === "null_move_pruning" ? { type: "my_nmp", params: b.params } : b,
    );
    const strip = (s: string) => s.replace(/\/\/ @(block|end) \w+/g, "");
    const before = generateProject(referenceWorkspace()).find((f) => f.path === "src/search.rs")!;
    const after = generateProject(ws).find((f) => f.path === "src/search.rs")!;
    expect(strip(after.contents)).toBe(strip(before.contents));
    expect(after.contents).toContain("// @block my_nmp");
    expect(after.contents).not.toContain("// @block null_move_pruning");
  });

  it("keeps hooks inside forked regions as code", () => {
    const { block } = parseBlockFile(forkBlock("alpha_beta", "my_ab"));
    expect(block!.sections.every((s) => s.kind === "region")).toBe(true);
    expect(block!.sections.some((s) => s.body.includes("// @hook on_cutoff"))).toBe(true);
  });
});

describe("custom blocks in a workspace", () => {
  it("rejects a fork next to its base", () => {
    const ws = place(referenceWorkspace(), "my_nmp", forkBlock("null_move_pruning", "my_nmp"), "pruning");
    expect(validate(ws).map((i) => i.message).join("\n")).toMatch(/replaces Null move pruning/);
  });

  it("rejects clashing parameter names", () => {
    const src = newBlockSource("clash", "Clash", "pruning").replace("MY_MAX_DEPTH", "NMP_MIN_DEPTH").replace(
      "depth <= MY_MAX_DEPTH",
      "depth <= NMP_MIN_DEPTH",
    );
    const ws = place(referenceWorkspace(), "clash", src, "pruning");
    expect(validate(ws).map((i) => i.message).join("\n")).toMatch(/NMP_MIN_DEPTH is used by both/);
  });

  it("checks requirements of new blocks", () => {
    const ws = place(starterWorkspace(), "my_pruning", newBlockSource("my_pruning", "My pruning", "pruning"), "pruning");
    expect(validate(ws).map((i) => i.message)).toContain("My pruning needs Alpha-beta pruning.");
  });

  it("puts hook code, inserts and new files into the project", () => {
    let ws = starterWorkspace();
    ws = place(ws, "tempo", EXAMPLE_BLOCKS.tempo!, "eval");
    const files = generateProject(ws);
    const eval_ = files.find((f) => f.path === "src/eval.rs")!.contents;
    expect(eval_).toMatch(/pub fn evaluate\(board: &Board\) -> i32 \{\n {4}\/\/ @block tempo\n/);
    expect(eval_).toContain("    score += tempo;");
    expect(files.find((f) => f.path === "src/tempo.rs")).toBeDefined();
    expect(files.find((f) => f.path === "src/main.rs")!.contents).toContain("mod tempo;");
    expect(files.find((f) => f.path === "src/params.rs")!.contents).toContain("pub const TEMPO: S = S(15, 5);");
    expect(files.find((f) => f.path === "blocks/eval/tempo.block.rs")!.contents).toBe(EXAMPLE_BLOCKS.tempo);
  });

  it("generates skeleton values a block mentions", () => {
    const ws = starterWorkspace();
    ws.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
    const plain = generateProject(ws).find((f) => f.path === "src/search.rs")!.contents;
    expect(plain).not.toContain("let static_eval");
    place(ws, "my_pruning", newBlockSource("my_pruning", "My pruning", "pruning"), "pruning");
    const search = generateProject(ws).find((f) => f.path === "src/search.rs")!.contents;
    expect(search).toContain("let static_eval");
    expect(search).toContain("let pv_node");
  });

  it("uses parameter values from the workspace", () => {
    const ws = place(starterWorkspace(), "check_extension", EXAMPLE_BLOCKS.check_extension!, "extensions");
    ws.search.slots.extensions[0]!.params = { CHECK_EXTENSION: 2 };
    const params = generateProject(ws).find((f) => f.path === "src/params.rs")!.contents;
    expect(params).toContain("pub const CHECK_EXTENSION: i32 = 2;");
  });

  it("every hook exists in its template", () => {
    for (const [name, h] of Object.entries(HOOKS)) {
      expect(TEMPLATES[h.file.replace(".rs", "") as keyof typeof TEMPLATES]).toContain(`// @hook ${name}\n`);
    }
  });

  it("starter blocks for every slot parse cleanly", () => {
    for (const slot of ["root", "pruning", "ordering", "extensions", "move_loop", "reductions", "leaf", "eval"] as const) {
      expect(errors(newBlockSource("x_block", "X", slot))).toEqual([]);
    }
  });

  it("names one hook after each slot and accepts old hook names", () => {
    for (const slot of ["root", "pruning", "ordering", "extensions", "move_loop", "reductions", "leaf", "eval"]) {
      expect(HOOKS[slot]?.slot).toBe(slot);
    }
    const old = ["//! ---", "//! id: old_names", "//! slot: ordering", "//! ---", "// @hook move_order", "order += 0;"].join("\n");
    const { block, diagnostics } = parseBlockFile(old);
    expect(diagnostics).toEqual([]);
    expect(block!.sections[0]).toMatchObject({ kind: "hook", hook: "ordering" });
  });

  it("finds free ids", () => {
    expect(freeId("Null move pruning", [])).toBe("null_move_pruning_2");
    expect(freeId("my nmp", ["my_nmp"])).toBe("my_nmp_2");
  });
});
