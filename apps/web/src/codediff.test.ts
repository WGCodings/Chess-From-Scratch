import { describe, expect, it } from "vitest";
import { starterWorkspace } from "@cfs/codegen";
import { diffText, fileDiff, projectDiff, workspaceDiff } from "./codediff";

const L = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

describe("code diff", () => {
  it("numbers lines and keeps three lines of context, like git", () => {
    const before = L(20);
    const after = [...before];
    after.splice(9, 1, "changed 10", "new 10b");
    const d = fileDiff("a.rs", before, after)!;
    expect(d.added).toBe(2);
    expect(d.removed).toBe(1);
    expect(d.lines.map((l) => (l.kind === "@" ? l.text : `${l.kind}${l.text}`))).toEqual([
      "@@ -7,7 +7,8 @@",
      " line 7",
      " line 8",
      " line 9",
      "-line 10",
      "+changed 10",
      "+new 10b",
      " line 11",
      " line 12",
      " line 13",
    ]);
    expect(d.lines.find((l) => l.text === "line 11")).toMatchObject({ old: 11, new: 12 });
  });

  it("joins close changes into one hunk and splits far ones", () => {
    const before = L(40);
    const after = [...before];
    after[4] = "x5";
    after[8] = "x9";
    after[34] = "x35";
    const d = fileDiff("a.rs", before, after)!;
    expect(d.lines.filter((l) => l.kind === "@").map((l) => l.text)).toEqual(["@@ -2,11 +2,11 @@", "@@ -32,7 +32,7 @@"]);
  });

  it("shows new and removed files whole", () => {
    const files = projectDiff([{ path: "src/a.rs", contents: "a\n" }], [{ path: "src/b.rs", contents: "b\nc\n" }]);
    expect(diffText(files)).toBe("--- a/src/a.rs\n+++ b//dev/null\n@@ -1,1 +0,0 @@\n-a\n--- a//dev/null\n+++ b/src/b.rs\n@@ -0,0 +1,2 @@\n+b\n+c");
  });

  it("diffs two engines' generated code", () => {
    const a = starterWorkspace();
    const b = starterWorkspace();
    b.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
    const d = workspaceDiff(a, b);
    if ("problem" in d) throw new Error(d.problem);
    const search = d.find((f) => f.path === "src/search.rs")!;
    expect(search.added).toBeGreaterThan(0);
    expect(search.lines.some((l) => l.kind === "+" && l.text.includes("@block alpha_beta"))).toBe(true);
    expect(d.some((f) => f.path.startsWith("blocks/"))).toBe(false);
  });
});
