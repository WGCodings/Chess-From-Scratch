import * as Blockly from "blockly";
import { beforeAll, describe, expect, it } from "vitest";
import {
  emptyWorkspace,
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
    ws.search.slots.pruning[0]!.params.margin = 123;
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

  it("parses exported workspace files", () => {
    const json = generateProject(starterWorkspace()).find((f) => f.path === "workspace.json")!.contents;
    expect(parseWorkspaceFile(json)).toEqual(starterWorkspace());
    expect(() => parseWorkspaceFile('{"hello": 1}')).toThrow();
  });
});
