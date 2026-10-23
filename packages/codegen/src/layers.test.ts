import { describe, expect, it } from "vitest";
import { codeToBlocks, generateProject, parseBlockFile, validate, viewOf, type Workspace } from "./index";

import { MY_LMR, MY_PVS, layeredEngine as engine } from "./layerexample";

const search = (ws: Workspace) => generateProject(ws).find((f) => f.path === "src/search.rs")!.contents;
const errors = (ws: Workspace) => validate(ws).filter((i) => i.level === "error").map((i) => i.message);

describe("blocks that build on each other", () => {
  it("a block replaces a line of the block it requires", () => {
    const code = search(engine(["my_pvs", MY_PVS]));
    expect(code).toContain("// @block my_pvs");
    expect(code).toContain("score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);");
    expect(code).not.toContain("let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);");
  });

  it("a block on top of that one changes its code in turn", () => {
    const code = search(engine(["my_pvs", MY_PVS], ["my_lmr", MY_LMR]));
    expect(code).toContain("let r = if depth >= MY_LMR_DEPTH && i >= 3 && quiet {");
    expect(code).toContain("score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);");
    // The insert goes right before the line the replacement takes the place of.
    const lines = code.split("\n").map((l) => l.trim());
    expect(lines.indexOf("let r = if depth >= MY_LMR_DEPTH && i >= 3 && quiet {")).toBeLessThan(
      lines.indexOf("score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);"),
    );
  });

  it("works whatever order the blocks are placed in", () => {
    const a = search(engine(["my_pvs", MY_PVS], ["my_lmr", MY_LMR]));
    const b = search(engine(["my_lmr", MY_LMR], ["my_pvs", MY_PVS]));
    expect(b).toEqual(a);
  });

  it("removing the top block brings back the code below it", () => {
    const without = engine(["my_pvs", MY_PVS], ["my_lmr", MY_LMR]);
    without.search.slots.move_loop = without.search.slots.move_loop.filter((b) => b.type !== "my_lmr");
    expect(search(without)).toEqual(search(engine(["my_pvs", MY_PVS])));
  });

  it("a block whose requirement is missing is an error, not silently dropped", () => {
    const ws = engine(["my_lmr", MY_LMR]);
    ws.customBlocks!.my_pvs = MY_PVS;
    expect(errors(ws).join("\n")).toMatch(/My LMR needs My PVS/);
  });

  it("a line that is not there is reported with the block's name", () => {
    const broken = MY_LMR.replace('"score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);"\nscore', '"score = nothing();"\nscore');
    expect(errors(engine(["my_pvs", MY_PVS], ["my_lmr", broken])).join("\n")).toMatch(/My LMR: the line "score = nothing\(\);" is not in search\.rs/);
  });
});

describe("Edit code: save as a new block on top", () => {
  const view = (ws: Workspace) => {
    const files = generateProject(ws);
    return { files, text: viewOf(files.find((f) => f.path === "src/search.rs")!).lines.join("\n") };
  };
  const place = (ws: Workspace, r: ReturnType<typeof codeToBlocks>) => {
    const out = structuredClone(ws);
    for (const [id, src] of Object.entries(r.sources)) out.customBlocks![id] = src;
    for (const c of r.created) out.search.slots[c.slot as "move_loop"].push({ type: c.id, params: {} });
    return out;
  };

  it("changing a line of your alpha-beta makes PVS on top of it, and LMR on top of that", () => {
    const ws = engine();
    const v = view(ws);
    const pvsCode = [
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
    const edited = v.text.replace("let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);", pvsCode);
    const r = codeToBlocks(ws, v.files, [{ path: "src/search.rs", text: edited }], [], { onTop: { id: "my_pvs", label: "My PVS" } });
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual([{ id: "my_pvs", slot: "move_loop" }]);
    expect(Object.keys(r.sources)).toEqual(["my_pvs"]);
    const pvs = parseBlockFile(r.sources.my_pvs!).block!;
    expect(pvs.requires).toEqual(["my_alpha_beta"]);
    expect(pvs.sections).toEqual([expect.objectContaining({ kind: "replace", anchor: "let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);" })]);
    const withPvs = place(ws, r);
    expect(view(withPvs).text).toContain("score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);");
    // What you typed is what you get.
    expect(view(withPvs).text.replace(/^\s*\/\/ @(block|end) my_pvs\n/gm, "").replace(/\s+/g, " ")).toEqual(edited.replace(/\s+/g, " "));

    // LMR on top of PVS: a new line and a changed line inside PVS's code.
    const v2 = view(withPvs);
    const edited2 = v2.text.replace(
      "                score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);",
      "                let r = if depth >= 3 && i >= 3 { 1 } else { 0 };\n                score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);",
    );
    const r2 = codeToBlocks(withPvs, v2.files, [{ path: "src/search.rs", text: edited2 }], [], { onTop: { id: "my_lmr", label: "My LMR" } });
    expect(r2.errors).toEqual([]);
    const lmr = parseBlockFile(r2.sources.my_lmr!).block!;
    expect(lmr.requires).toEqual(["my_pvs"]);
    const withLmr = place(withPvs, r2);
    expect(validate(withLmr).filter((i) => i.level === "error")).toEqual([]);
    expect(view(withLmr).text).toContain("score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);");
    // My PVS itself did not change.
    expect(r2.sources.my_pvs).toBeUndefined();
  });

  it("without the option the same edit changes the block itself", () => {
    const ws = engine(["my_pvs", MY_PVS]);
    const v = view(ws);
    const edited = v.text.replace("if score > alpha && score < beta {", "if score > alpha && score < beta && depth > 0 {");
    const r = codeToBlocks(ws, v.files, [{ path: "src/search.rs", text: edited }]);
    expect(r.errors).toEqual([]);
    expect(r.created).toEqual([]);
    expect(r.sources.my_pvs).toContain("depth > 0");
  });

  it("a new block typed inside your block's code builds on that block", () => {
    const ws = engine(["my_pvs", MY_PVS]);
    const v = view(ws);
    const edited = v.text.replace(
      "    if score > alpha && score < beta {",
      "    // @block pvs_count\n    self.nodes += 0;\n    // @end pvs_count\n    if score > alpha && score < beta {",
    );
    const r = codeToBlocks(ws, v.files, [{ path: "src/search.rs", text: edited }]);
    expect(r.errors).toEqual([]);
    expect(parseBlockFile(r.sources.pvs_count!).block!.requires).toContain("my_pvs");
  });
});
