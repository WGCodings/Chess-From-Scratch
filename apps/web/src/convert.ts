/**
 * Converts between Blockly blocks and the generator's Workspace JSON.
 */

import * as Blockly from "blockly";
import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  SEARCH_SLOTS,
  TIME_BLOCKS,
  TRANSPOSITION_TABLE,
  defaultParams,
  emptyWorkspace,
  evalSpec,
  normalizeWorkspace,
  parseBlock,
  searchSpec,
  type BlockInstance,
  type EvalTermType,
  type ParamSpec,
  type Params,
  type Score,
  type SearchBlockType,
  type TimeBlockType,
  type Workspace,
} from "@cfs/codegen";
import {
  BASIC_TIME_BLOCK,
  CUSTOM_PREFIX,
  ENGINE,
  HCE,
  NEGAMAX,
  SLOT_INPUT,
  TIME,
  TT,
  customType,
  defineCustomBlock,
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

/** Looks up the source of a custom block by id (project, then library, then examples). */
export type BlockSource = (id: string) => string | undefined;

/** Reads the engine assembled in a Blockly workspace. */
export function readWorkspace(bw: Blockly.Workspace, sourceOf: BlockSource = () => undefined): ReadResult {
  const engines = bw.getBlocksByType(ENGINE, false).filter((b) => b.isEnabled());
  if (engines.length === 0) {
    return { workspace: null, problems: ["Drag an Engine block onto the workspace to start."] };
  }
  const engine = engines[0]!;
  const problems: string[] = [];
  const ws = emptyWorkspace(String(engine.getFieldValue("NAME")), String(engine.getFieldValue("AUTHOR")));
  ws.engine.benchDepth = Number(engine.getFieldValue("BENCH_DEPTH"));

  for (const b of stack(engine, "SETTINGS")) {
    const time: TimeBlockType | null =
      b.type === TIME ? "time_management" : b.type === BASIC_TIME_BLOCK ? "basic_time" : null;
    if (time) {
      if (ws.engine.timeManagement) {
        problems.push("Use only one time management block.");
      } else {
        ws.engine.timeManagement = { type: time, params: readParams(b, TIME_BLOCKS[time].params) };
      }
    }
    if (b.type === TT) ws.engine.transpositionTable = readParams(b, TRANSPOSITION_TABLE.params);
  }

  // Custom blocks: their parameters come from their block file.
  const custom = (b: Blockly.Block) => {
    if (!b.type.startsWith(CUSTOM_PREFIX)) return null;
    const id = b.type.slice(CUSTOM_PREFIX.length);
    const src = sourceOf(id);
    if (src === undefined) {
      problems.push(`The block "${id}" is not in this project or in My blocks.`);
      return null;
    }
    ws.customBlocks![id] = src;
    const block = parseBlock(src).block;
    return { type: id, params: block ? readParams(b, block.params) : {} };
  };

  const search = stack(engine, "SEARCH")[0];
  if (search?.type === NEGAMAX) {
    for (const slot of SEARCH_SLOTS) {
      for (const b of stack(search, SLOT_INPUT[slot])) {
        const type = SEARCH_BY_BLOCK.get(b.type);
        if (type) ws.search.slots[slot].push({ type, params: readParams(b, SEARCH_BLOCKS[type].params) });
        const c = custom(b);
        if (c) ws.search.slots[slot].push(c);
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
      const c = custom(b);
      if (c) ws.eval.terms.push(c);
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

/** The Blockly state of a whole engine, ready for `serialization.blocks.append`. */
export function engineState(ws: Workspace, x = 40, y = 40): BlockState {
  const customState = (b: BlockInstance<string>): BlockState => {
    const block = parseBlock(ws.customBlocks?.[b.type] ?? "").block;
    return { type: customType(b.type), fields: paramFields(block?.params ?? [], b.params) };
  };
  const searchState = (b: BlockInstance<string>): BlockState => {
    const spec = searchSpec(b.type);
    return spec ? { type: searchType(b.type as SearchBlockType), fields: paramFields(spec.params, b.params) } : customState(b);
  };
  const evalState = (b: BlockInstance<string>): BlockState => {
    const spec = evalSpec(b.type);
    return spec ? { type: evalType(b.type as EvalTermType), fields: paramFields(spec.params, b.params) } : customState(b);
  };
  const settings: BlockState[] = [];
  const tm = ws.engine.timeManagement;
  if (tm) {
    settings.push({
      type: tm.type === "time_management" ? TIME : BASIC_TIME_BLOCK,
      fields: paramFields(TIME_BLOCKS[tm.type].params, tm.params),
    });
  }
  if (ws.engine.transpositionTable) {
    settings.push({ type: TT, fields: paramFields(TRANSPOSITION_TABLE.params, ws.engine.transpositionTable) });
  }
  const negamax: BlockState = {
    type: NEGAMAX,
    inputs: inputs(SEARCH_SLOTS.map((slot) => [SLOT_INPUT[slot], (ws.search.slots[slot] ?? []).map(searchState)])),
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
  for (const src of Object.values(ws.customBlocks ?? {})) {
    const block = parseBlock(src).block;
    if (block?.id) defineCustomBlock(block);
  }
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
  const engine = { ...base.engine, ...data.engine } as Workspace["engine"] & { timeManagement: unknown };
  // Files from before time blocks existed stored the soft/hard parameters directly.
  const tm = engine.timeManagement as Record<string, unknown> | null;
  if (tm && !("type" in tm)) {
    engine.timeManagement = { type: "time_management", params: tm as Params };
  }
  return normalizeWorkspace({
    ...base,
    ...data,
    engine: engine as Workspace["engine"],
    search: { ...base.search, slots: { ...base.search.slots, ...data.search.slots } },
  } as Workspace);
}
