import { describe, expect, it } from "vitest";
import { generateProject, starterWorkspace, timeBlock } from "@cfs/codegen";
import { diffLines, explain, lineRegions } from "./diff";

describe("diffLines", () => {
  it("finds inserted and replaced lines", () => {
    const before = ["a", "b", "c", "d"];
    const after = ["a", "x", "b", "c2", "d"];
    expect(diffLines("f", before, after)).toEqual([
      { file: "f", start: 1, end: 2, removed: 0 },
      { file: "f", start: 3, end: 4, removed: 1 },
    ]);
  });

  it("reports pure removals at their position", () => {
    expect(diffLines("f", ["a", "b", "c"], ["a", "c"])).toEqual([{ file: "f", start: 1, end: 1, removed: 1 }]);
  });

  it("finds the changes a block makes in generated code", () => {
    const before = starterWorkspace();
    const after = starterWorkspace();
    after.search.slots.pruning.push({ type: "null_move_pruning", params: { minDepth: 3, baseReduction: 3, depthDivisor: 4 } });
    const a = new Map(generateProject(before).map((f) => [f.path, f.contents.split("\n")]));
    const hunks = generateProject(after).flatMap((f) => diffLines(f.path, a.get(f.path) ?? [], f.contents.split("\n")));
    const files = new Set(hunks.map((h) => h.file));
    expect(files).toContain("src/search.rs");
    expect(files).toContain("src/params.rs");
    expect(files).toContain("src/position.rs");
    expect(files).not.toContain("src/eval.rs");
  });
});

describe("explain", () => {
  it("returns the first comment, skipping markers", () => {
    const lines = ["// @block x", "// Why this is here,", "// continued.", "code();", "// @end x"];
    expect(explain(lines, 0, lines.length)).toBe("Why this is here, continued.");
  });
  it("returns null without comments", () => {
    expect(explain(["a();", "b();"], 0, 2)).toBeNull();
  });
});

describe("lineRegions", () => {
  it("tags lines inside markers", () => {
    expect(lineRegions(["a", "// @block t", "b", "// @end t", "c"])).toEqual([null, "t", "t", "t", null]);
  });
  it("is used by the time blocks", () => {
    const ws = starterWorkspace();
    ws.engine.timeManagement = timeBlock("time_management");
    const time = generateProject(ws).find((f) => f.path === "src/time.rs")!.contents.split("\n");
    expect(lineRegions(time)).toContain("time_management");
  });
});
