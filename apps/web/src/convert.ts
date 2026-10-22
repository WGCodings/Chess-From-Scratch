/**
 * Converts between Blockly blocks and the generator's Workspace JSON.
 */

import * as Blockly from "blockly";
import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  SEARCH_SLOTS,
  TIME_MANAGEMENT,
  TRANSPOSITION_TABLE,
  defaultParams,
  emptyWorkspace,
  type BlockInstance,
  type EvalTermType,
  type ParamSpec,
  type Params,
  type Score,
  type SearchBlockType,
  type Workspace,
} from "@cfs/codegen";
import {
  ENGINE,
  HCE,
  NEGAMAX,
  SLOT_INPUT,
  TIME,
  TT,
  evalType,
  fieldNames,
  searchType,
} from "./blocks";

const SEARCH_BY_BLOCK = new Map(
  (Object.keys(SEARCH_BLOCKS) as SearchBlockType[]).map((t) => [searchType(t), t]),
);
const EVAL_BY_BLOCK = new Map((Object.keys(EVAL_TERMS) as EvalTermType[]).map((t) => [evalType(t), t]));

// Blocks -> workspace ---------------------------------------------------------

function readParams(block: Blockly.Block, specs: ParamSpec[]): Params {
  const out: Params = {};
  for (const spec of specs) {
    const values = fieldNames(spec).map((f) => Number(block.getFieldValue(f)));
    switch (spec.type) {
      case "S":
        out[spec.key] = values as Score;
        break;
      case "[S; 4]":
      case "[S; 8]": {
        const pairs: Score[] = [];
        for (let i = 0; i < values.length; i += 2) pairs.push([values[i]!, values[i + 1]!]);
        out[spec.key] = pairs;
        break;
      }
      default:
        out[spec.key] = values[0]!;
    }
  }
  return out;
}

/** Enabled blocks stacked under a statement input, top to bottom. */
function stack(block: Blockly.Block, input: string): Blockly.Block[] {
  const out: Blockly.Block[] = [];
  for (let b = block.getInputTargetBlock(input); b; b = b.getNextBlock()) {
    if (b.isEnabled()) out.push(b);
  }
  return out;
}

export interface ReadResult {
  /** `null` when there is no engine block to generate from. */
  workspace: Workspace | null;
  /** Structural problems the generator's validation cannot see. */
  problems: string[];
}

/** Reads the engine assembled in a Blockly workspace. */
export function readWorkspace(bw: Blockly.Workspace): ReadResult {
  const engines = bw.getBlocksByType(ENGINE, false).filter((b) => b.isEnabled());
  if (engines.length === 0) {
    return { workspace: null, problems: ["Drag an Engine block onto the workspace to start."] };
  }
  const engine = engines[0]!;
  const problems: string[] = [];
  const ws = emptyWorkspace(String(engine.getFieldValue("NAME")), String(engine.getFieldValue("AUTHOR")));
  ws.engine.benchDepth = Number(engine.getFieldValue("BENCH_DEPTH"));

  for (const b of stack(engine, "SETTINGS")) {
    if (b.type === TIME) ws.engine.timeManagement = readParams(b, TIME_MANAGEMENT.params);
    if (b.type === TT) ws.engine.transpositionTable = readParams(b, TRANSPOSITION_TABLE.params);
  }

  const search = stack(engine, "SEARCH")[0];
  if (search?.type === NEGAMAX) {
    for (const slot of SEARCH_SLOTS) {
      for (const b of stack(search, SLOT_INPUT[slot])) {
        const type = SEARCH_BY_BLOCK.get(b.type);
        if (type) ws.search.slots[slot].push({ type, params: readParams(b, SEARCH_BLOCKS[type].params) });
      }
    }
  } else {
    problems.push("Plug a Negamax search block into the engine's search slot.");
  }

  const evaluation = stack(engine, "EVAL")[0];
  if (evaluation?.type === HCE) {
    for (const b of stack(evaluation, "TERMS")) {
      const type = EVAL_BY_BLOCK.get(b.type);
      if (type) ws.eval.terms.push({ type, params: readParams(b, EVAL_TERMS[type].params) });
    }
  } else {
    problems.push("Plug a Hand-crafted evaluation block into the engine's evaluation slot.");
  }

  return { workspace: ws, problems };
}

// Workspace -> blocks ---------------------------------------------------------

type BlockState = Blockly.serialization.blocks.State;

function paramFields(specs: ParamSpec[], params: Params): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const spec of specs) {
    const value = params[spec.key] ?? defaultParams([spec])[spec.key]!;
    const flat = Array.isArray(value) ? (value as (number | Score)[]).flat() : [value];
    fieldNames(spec).forEach((name, i) => (fields[name] = flat[i] as number));
  }
  return fields;
}

/** Links block states into a stack via `next`. */
function chain(blocks: BlockState[]): { block: BlockState } | undefined {
  let next: { block: BlockState } | undefined;
  for (const block of [...blocks].reverse()) {
    if (next) block.next = next;
    next = { block };
  }
  return next;
}

function inputs(entries: [string, BlockState[]][]): Record<string, { block: BlockState }> {
  const out: Record<string, { block: BlockState }> = {};
  for (const [name, blocks] of entries) {
    const linked = chain(blocks);
    if (linked) out[name] = linked;
  }
  return out;
}

const searchState = (b: BlockInstance<SearchBlockType>): BlockState => ({
  type: searchType(b.type),
  fields: paramFields(SEARCH_BLOCKS[b.type].params, b.params),
});

const evalState = (b: BlockInstance<EvalTermType>): BlockState => ({
  type: evalType(b.type),
  fields: paramFields(EVAL_TERMS[b.type].params, b.params),
});

/** The Blockly state of a whole engine, ready for `serialization.blocks.append`. */
export function engineState(ws: Workspace, x = 40, y = 40): BlockState {
  const settings: BlockState[] = [
    { type: TIME, fields: paramFields(TIME_MANAGEMENT.params, ws.engine.timeManagement) },
  ];
  if (ws.engine.transpositionTable) {
    settings.push({ type: TT, fields: paramFields(TRANSPOSITION_TABLE.params, ws.engine.transpositionTable) });
  }
  const negamax: BlockState = {
    type: NEGAMAX,
    inputs: inputs(SEARCH_SLOTS.map((slot) => [SLOT_INPUT[slot], ws.search.slots[slot].map(searchState)])),
  };
  const hce: BlockState = { type: HCE, inputs: inputs([["TERMS", ws.eval.terms.map(evalState)]]) };
  return {
    type: ENGINE,
    x,
    y,
    fields: { NAME: ws.engine.name, AUTHOR: ws.engine.author, BENCH_DEPTH: ws.engine.benchDepth },
    inputs: inputs([
      ["SETTINGS", settings],
      ["SEARCH", [negamax]],
      ["EVAL", [hce]],
    ]),
  };
}

/** Replaces everything in `bw` with the given engine. */
export function loadWorkspace(bw: Blockly.Workspace, ws: Workspace): void {
  Blockly.Events.disable();
  try {
    bw.clear();
    Blockly.serialization.blocks.append(engineState(ws), bw);
  } finally {
    Blockly.Events.enable();
  }
}

/** Parses a workspace.json file, filling parameters missing from older files. */
export function parseWorkspaceFile(text: string): Workspace {
  const data = JSON.parse(text) as Partial<Workspace>;
  if (data?.format !== 1 || !data.engine || !data.search || !data.eval) {
    throw new Error("This is not a Chess From Scratch workspace file.");
  }
  const base = emptyWorkspace();
  return {
    ...base,
    ...data,
    engine: { ...base.engine, ...data.engine },
    search: { ...base.search, slots: { ...base.search.slots, ...data.search.slots } },
  } as Workspace;
}
