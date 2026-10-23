import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkTestOptions,
  defaultTestOptions,
  emptyProgress,
  eloTimeline,
  fastchessArgs,
  formatElo,
  readFastchessLine,
  sprtLimits,
  statusOf,
  type TestRecord,
} from "./sprt";
import { cloneBranch, deleteBranch, keepBranch, lastTestOf, newWorkbench, parseWorkbench, saveTest } from "./workbench";
import { starterWorkspace } from "./workspace";

const OUTPUT = readFileSync(join(__dirname, "fixtures", "fastchess-output.txt"), "utf8");

describe("fastchess", () => {
  it("builds the command line", () => {
    const o = { ...defaultTestOptions(6), tc: "10+0.1", hash: 32 };
    const args = fastchessArgs(o, { name: "new", program: "/e/new", hash: true }, { name: "base", program: "/e/base", hash: false }, { path: "/b/UHO.epd", format: "epd" });
    const s = args.join(" ");
    expect(s).toContain("-engine cmd=/e/new name=new option.Hash=32 option.Threads=1 -engine cmd=/e/base name=base option.Threads=1");
    expect(s).toContain("-each tc=10+0.1");
    expect(s).toContain("-concurrency 3");
    expect(s).toContain("-sprt elo0=0 elo1=10 alpha=0.05 beta=0.05");
    expect(s).toContain("-openings file=/b/UHO.epd format=epd order=random");
    expect(s).toContain("-rounds 10000 -repeat");
    expect(args).toContain("cmd=/e/new"); // one argument each: paths with spaces stay whole
  });

  it("reads results, the LLR and finished games from its output", () => {
    const p = emptyProgress(defaultTestOptions().sprt);
    for (const line of OUTPUT.split("\n")) readFastchessLine(p, line, "new");
    expect(p).toMatchObject({ games: 24, wins: 5, losses: 9, draws: 10, elo: -58.45, eloError: 124.68, nElo: -69.49, llr: -0.08, lower: -2.94, upper: 2.94, verdict: null });
    expect(p.penta).toEqual([3, 2, 3, 4, 0]);
    expect(p.recent).toHaveLength(8);
    expect(p.recent.at(-1)).toContain("draw");
    expect(statusOf(p)).toBe("stopped");
    readFastchessLine(p, "Elo: -0.00 +/- 0.00, nElo: -nan +/- -nan", "new");
    expect([p.elo, p.eloError, p.nElo, p.nEloError]).toEqual([-0, 0, null, null]);
    readFastchessLine(p, "SPRT ([0.00, 5.00]) completed - H1 was accepted", "new");
    expect(statusOf(p)).toBe("passed");
  });

  it("checks options and knows the SPRT limits", () => {
    expect(checkTestOptions(defaultTestOptions())).toBeNull();
    expect(checkTestOptions({ ...defaultTestOptions(), tc: "ten" })).toMatch(/time control/);
    expect(checkTestOptions({ ...defaultTestOptions(), sprt: { elo0: 5, elo1: 0, alpha: 0.05, beta: 0.05 } })).toMatch(/elo1/);
    const { lower, upper } = sprtLimits({ alpha: 0.05, beta: 0.05 });
    expect(lower).toBeCloseTo(-2.944, 3);
    expect(upper).toBeCloseTo(2.944, 3);
    expect(formatElo(12.345, 8.01)).toBe("+12.3 ± 8.0");
    expect(formatElo(-3, null)).toBe("−3.0");
  });
});

function record(id: string, branch: { id: string; name: string }, elo: number, status: TestRecord["status"], at: string): TestRecord {
  const result = { ...emptyProgress(defaultTestOptions().sprt), games: 100, elo, eloError: 10 };
  return { id, started: at, finished: at, status, newBranch: branch, baseBranch: { id: "main", name: "main" }, changes: ["+ Killer moves"], options: defaultTestOptions(), result };
}

describe("tests in the workbench", () => {
  it("records tests, the decision taken, and the main version's Elo over time", () => {
    const wb = newWorkbench(starterWorkspace(), "2026-10-23T10:00:00.000Z");
    const a = cloneBranch(wb, "main", "+ killers");
    const b = cloneBranch(wb, "main", "+ history");
    saveTest(wb, { ...record("t1", { id: a, name: "+ killers" }, 0, "running", "2026-10-23T11:00:00.000Z") });
    saveTest(wb, record("t1", { id: a, name: "+ killers" }, 25, "passed", "2026-10-23T11:00:00.000Z"));
    saveTest(wb, record("t2", { id: b, name: "+ history" }, -4, "failed", "2026-10-23T12:00:00.000Z"));
    expect(wb.tests).toHaveLength(2);
    expect(lastTestOf(wb, a)?.status).toBe("passed");
    expect(wb.history.filter((h) => h.kind === "test").map((h) => h.branch)).toEqual(["+ killers", "+ history"]);
    keepBranch(wb, a);
    deleteBranch(wb, b);
    expect(wb.tests!.map((t) => t.decision)).toEqual(["kept", "deleted"]);
    expect(eloTimeline(wb.tests!).map((p) => [p.label, p.elo])).toEqual([["start", 0], ["+ killers", 25]]);
  });

  it("a test still running when the app closed reads back as stopped", () => {
    const wb = newWorkbench(starterWorkspace());
    saveTest(wb, record("t1", { id: "main", name: "main" }, 0, "running", "2026-10-23T11:00:00.000Z"));
    expect(parseWorkbench(JSON.parse(JSON.stringify(wb))).tests![0]!.status).toBe("stopped");
  });
});
