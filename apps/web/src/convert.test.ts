import * as Blockly from "blockly";
import { beforeAll, describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  forkBlock,
  generateProject,
  referenceWorkspace,
  starterWorkspace,
  type Workspace,
} from "@cfs/codegen";
import { defineBlocks } from "./blocks";
import { loadWorkspace, parseWorkspaceFile, readWorkspace } from "./convert";

beforeAll(() => defineBlocks());

function roundTrip(ws: Workspace): Workspace | null {
  const bw = new Blockly.Workspace();
  loadWorkspace(bw, ws);
  const result = readWorkspace(bw).workspace;
  bw.dispose();
  return result;
}

describe("blocks <-> workspace", () => {
  it.each([
    ["reference", referenceWorkspace()],
    ["starter", starterWorkspace()],
    ["empty", emptyWorkspace()],
  ])("round-trips the %s workspace", (_, ws) => {
    expect(roundTrip(ws)).toEqual(ws);
  });

  it("generates the reference engine from blocks", () => {
    const ws = roundTrip(referenceWorkspace())!;
    const fromBlocks = generateProject(ws);
    const direct = generateProject(referenceWorkspace());
    expect(fromBlocks).toEqual(direct);
  });

  it("keeps edited parameters", () => {
    const ws = referenceWorkspace();
    ws.search.slots.pruning.find((b) => b.type === "reverse_futility_pruning")!.params.margin = 123;
    ws.eval.terms[1]!.params.weights = [[1, 2], [3, 4], [5, 6], [7, 8]];
    expect(roundTrip(ws)).toEqual(ws);
  });

  it("ignores disabled blocks and reports a missing engine", () => {
    const bw = new Blockly.Workspace();
    expect(readWorkspace(bw).workspace).toBeNull();
    loadWorkspace(bw, referenceWorkspace());
    const nmp = bw.getBlocksByType("cfs_search_null_move_pruning", false)[0]!;
    nmp.setDisabledReason(true, "test");
    const ws = readWorkspace(bw).workspace!;
    expect(ws.search.slots.pruning.map((b) => b.type)).not.toContain("null_move_pruning");
    bw.dispose();
  });

  it("reads both time blocks and rejects two at once", () => {
    const ws = starterWorkspace();
    ws.engine.timeManagement = { type: "basic_time", params: { movesToGo: 30, overheadMs: 20 } };
    expect(roundTrip(ws)!.engine.timeManagement?.type).toBe("basic_time");
    const bw = new Blockly.Workspace();
    loadWorkspace(bw, referenceWorkspace());
    const engine = bw.getBlocksByType("cfs_engine", false)[0]!;
    const basic = bw.newBlock("cfs_basic_time");
    engine.getInput("SETTINGS")!.connection!.connect(basic.previousConnection!);
    expect(readWorkspace(bw).problems).toContain("Use only one time management block.");
    bw.dispose();
  });

  it("migrates files saved before time blocks existed", () => {
    const old = JSON.parse(JSON.stringify(referenceWorkspace()));
    old.engine.timeManagement = { movesToGo: 30, incPercent: 75, hardMultiplier: 3, overheadMs: 25 };
    const ws = parseWorkspaceFile(JSON.stringify(old));
    expect(ws.engine.timeManagement).toEqual({
      type: "time_management",
      params: { movesToGo: 30, incPercent: 75, hardMultiplier: 3, overheadMs: 25 },
    });
  });

  it("parses exported workspace files", () => {
    const json = generateProject(starterWorkspace()).find((f) => f.path === "workspace.json")!.contents;
    expect(parseWorkspaceFile(json)).toEqual(starterWorkspace());
    expect(() => parseWorkspaceFile('{"hello": 1}')).toThrow();
  });

  it("round-trips the random mover, an untapered evaluation and the negamax depth", () => {
    const random = starterWorkspace();
    random.search = { ...random.search, kind: "random_mover", params: {} };
    random.eval.kind = "none";
    expect(roundTrip(random)!.search.kind).toBe("random_mover");
    expect(roundTrip(random)!.eval.kind).toBe("none");

    const ws = starterWorkspace();
    ws.search.params = { depth: 6 };
    ws.eval.taper = false;
    expect(roundTrip(ws)).toEqual(ws);
    ws.eval.taper = true;
    expect(roundTrip(ws)).toEqual(ws);
  });

  it("reads your own versions of skeleton blocks", () => {
    const ws = starterWorkspace();
    const negamax = forkBlock("negamax", "my_negamax");
    const engine = forkBlock("engine", "my_engine");
    ws.customBlocks = { my_negamax: negamax, my_engine: engine };
    ws.versions = { negamax: "my_negamax", engine: "my_engine" };
    ws.search.params = { NEGAMAX_DEPTH: 5 };
    const sources: Record<string, string> = { ...ws.customBlocks };
    const bw = new Blockly.Workspace();
    loadWorkspace(bw, ws);
    expect(bw.getBlocksByType("cfs_custom_my_negamax", false)).toHaveLength(1);
    const read = readWorkspace(bw, (id) => sources[id]).workspace!;
    expect(read.versions).toEqual(ws.versions);
    expect(read.search.kind).toBe("negamax");
    expect(read.search.params).toEqual({ NEGAMAX_DEPTH: 5 });
    expect(read.engine.name).toBe(ws.engine.name);
    bw.dispose();
  });

  it("upgrades format 1 files: iterative deepening, draw detection and tapering become blocks", () => {
    const old = JSON.parse(JSON.stringify(starterWorkspace()));
    old.format = 1;
    delete old.search.kind;
    delete old.eval.kind;
    delete old.eval.taper;
    const ws = parseWorkspaceFile(JSON.stringify(old));
    expect(ws.format).toBe(2);
    expect(ws.search.kind).toBe("negamax");
    expect(ws.eval).toMatchObject({ kind: "hce", taper: true });
    expect(ws.search.slots.root.map((b) => b.type)).toContain("iterative_deepening");
    expect(ws.search.slots.pruning.map((b) => b.type)).toContain("draw_detection");
  });
});
