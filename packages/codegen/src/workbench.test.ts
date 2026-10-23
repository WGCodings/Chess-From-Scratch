import { describe, expect, it } from "vitest";
import { starterWorkspace } from "./workspace";
import {
  branchChanges,
  branchList,
  cloneBranch,
  deleteBranch,
  describeChanges,
  diffWorkspaces,
  keepBranch,
  mainChangedSince,
  newWorkbench,
  parseWorkbench,
  renameBranch,
  summarizeChanges,
  updateCurrent,
} from "./workbench";
import { MY_LMR, layeredEngine } from "./layerexample";

const T = "2026-10-23T10:00:00.000Z";

describe("diffWorkspaces", () => {
  it("lists blocks added and removed, parameters and settings", () => {
    const a = starterWorkspace();
    const b = starterWorkspace();
    b.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
    b.search.slots.reductions = [{ type: "late_move_reductions", params: { base: 0.8 } }];
    b.search.params = { ...b.search.params, depth: 5 };
    b.engine.name = "Pea Junior";
    const lines = describeChanges(diffWorkspaces(a, b));
    expect(lines).toContain("+ Alpha-beta pruning");
    expect(lines).toContain("+ Late move reductions");
    expect(lines).toContain(`Engine name: ${a.engine.name} → Pea Junior`);
    expect(lines.some((l) => l.startsWith("Negamax search:") && l.endsWith("→ 5"))).toBe(true);
    expect(describeChanges(diffWorkspaces(b, a))).toContain("− Alpha-beta pruning");
    expect(diffWorkspaces(a, starterWorkspace())).toEqual([]);
  });

  it("sees parameter changes and code changes in your own blocks", () => {
    const a = layeredEngine(["my_lmr", MY_LMR]);
    const b = layeredEngine(["my_lmr", MY_LMR.replace("i >= 3", "i >= 4")]);
    b.search.slots.move_loop.find((x) => x.type === "my_lmr")!.params = { MY_LMR_DEPTH: 4 };
    expect(describeChanges(diffWorkspaces(a, b))).toEqual(["My LMR: MY_LMR_DEPTH 3 → 4", "My LMR: code changed"]);
  });
});

describe("workbench", () => {
  it("clone, change, keep: main gets the branch and the history says what changed", () => {
    const wb = newWorkbench(starterWorkspace(), T);
    const id = cloneBranch(wb, "main", "+ alpha-beta", T);
    expect(id).toBe("alpha-beta");
    wb.current = id;
    const ws = starterWorkspace();
    ws.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
    updateCurrent(wb, ws, T);
    expect(describeChanges(branchChanges(wb, id))).toEqual(["+ Alpha-beta pruning"]);
    expect(summarizeChanges(branchChanges(wb, id))).toBe("+ Alpha-beta pruning");
    expect(mainChangedSince(wb, id)).toEqual([]);
    keepBranch(wb, id, T);
    expect(Object.keys(wb.branches)).toEqual(["main"]);
    expect(wb.current).toBe("main");
    expect(wb.branches.main!.workspace.search.slots.move_loop).toHaveLength(1);
    expect(wb.history.map((h) => h.kind)).toEqual(["created", "cloned", "kept"]);
    expect(wb.history[2]!.changes).toEqual(["+ Alpha-beta pruning"]);
  });

  it("warns when main changed after the clone, deletes, renames and refuses duplicates", () => {
    const wb = newWorkbench(starterWorkspace(), T);
    const a = cloneBranch(wb, "main", "try", T);
    expect(() => cloneBranch(wb, "main", "try", T)).toThrow(/already/);
    const ws = starterWorkspace();
    ws.engine.benchDepth = 7;
    updateCurrent(wb, ws, T); // main is open
    expect(describeChanges(mainChangedSince(wb, a))).toEqual([`Bench depth: ${starterWorkspace().engine.benchDepth} → 7`]);
    const b = cloneBranch(wb, a, "try 2", "2026-10-23T11:00:00.000Z");
    renameBranch(wb, a, "first try", T);
    expect(branchList(wb).map((x) => x.name)).toEqual(["main", "first try", "try 2"]);
    wb.current = a;
    deleteBranch(wb, a, T);
    expect(wb.current).toBe("main");
    expect(wb.branches[b]!.parent).toBe("main");
    expect(() => deleteBranch(wb, "main", T)).toThrow();
    expect(wb.history.map((h) => h.kind)).toEqual(["created", "cloned", "cloned", "renamed", "deleted"]);
  });

  it("reads a saved workbench and turns a plain workspace into one", () => {
    const wb = newWorkbench(starterWorkspace(), T);
    cloneBranch(wb, "main", "x", T);
    const back = parseWorkbench(JSON.parse(JSON.stringify(wb)));
    expect(back).toEqual(wb);
    const single = parseWorkbench(starterWorkspace());
    expect(Object.keys(single.branches)).toEqual(["main"]);
    expect(single.branches.main!.workspace).toEqual(starterWorkspace());
  });
});
