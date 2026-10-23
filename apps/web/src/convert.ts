/**
 * Converts between Blockly blocks and the generator's Workspace JSON.
 */

import * as Blockly from "blockly";
import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  SEARCH_SLOTS,
  SKELETON_TYPES,
  defaultParams,
  emptyWorkspace,
  evalSpec,
  isCustomSlot,
  normalizeWorkspace,
  parseBlock,
  searchSpec,
  skeletonSpec,
  type BlockFile,
  type BlockInstance,
  type EvalTermType,
  type ParamSpec,
  type Params,
  type Score,
  type SearchBlockType,
  type SkeletonType,
  type TimeBlockType,
  type Workspace,
} from "@cfs/codegen";
import {
  CUSTOM_PREFIX,
  SKELETON_BLOCK,
  SLOT_INPUT,
  customType,
  defineCustomBlock,
  evalType,
  fieldNames,
  searchType,
  skeletonOf,
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

/** A skeleton block on the canvas: built in, or your own version of one. */
interface SkeletonBlock {
  type: SkeletonType;
  /** Your version's block file, when it is one. */
  version?: BlockFile;
  source?: string;
}

/** What skeleton a Blockly block is, without recording anything. */
export function skeletonBlock(b: Blockly.Block, sourceOf: BlockSource): SkeletonBlock | null {
  const builtin = skeletonOf(b.type);
  if (builtin) return { type: builtin };
  if (!b.type.startsWith(CUSTOM_PREFIX)) return null;
  const source = sourceOf(b.type.slice(CUSTOM_PREFIX.length));
  const version = source === undefined ? null : parseBlock(source).block;
  if (!version?.base || isCustomSlot(version.slot) || !(SKELETON_TYPES as string[]).includes(version.base)) return null;
  return { type: version.base as SkeletonType, version, source };
}

const TIME_TYPES: readonly SkeletonType[] = ["time_management", "basic_time"];

/** Reads the engine assembled in a Blockly workspace. */
export function readWorkspace(bw: Blockly.Workspace, sourceOf: BlockSource = () => undefined): ReadResult {
  const engines = bw
    .getAllBlocks(false)
    .filter((b) => b.isEnabled() && skeletonBlock(b, sourceOf)?.type === "engine");
  if (engines.length === 0) {
    return { workspace: null, problems: ["Drag an Engine block onto the workspace to start."] };
  }
  const engine = engines[0]!;
  const problems: string[] = [];
  const ws = emptyWorkspace(String(engine.getFieldValue("NAME")), String(engine.getFieldValue("AUTHOR")));
  ws.engine.benchDepth = Number(engine.getFieldValue("BENCH_DEPTH"));
  ws.versionParams = {};

  /** The skeleton a block is; a version is recorded with its parameters. */
  const skeleton = (b: Blockly.Block | undefined) => {
    const info = b ? skeletonBlock(b, sourceOf) : null;
    if (!b || !info) return null;
    const specs = info.version ? info.version.params : (skeletonSpec(info.type)?.params ?? []);
    if (info.version) {
      ws.customBlocks![info.version.id] = info.source!;
      ws.versions![info.type] = info.version.id;
    }
    return { ...info, params: readParams(b, specs) };
  };

  const root = skeleton(engine)!;
  if (root.version) ws.versionParams.engine = root.params;

  for (const b of stack(engine, "SETTINGS")) {
    const info = skeleton(b);
    if (!info) continue;
    if (TIME_TYPES.includes(info.type)) {
      if (ws.engine.timeManagement) {
        problems.push("Use only one time management block.");
      } else {
        ws.engine.timeManagement = { type: info.type as TimeBlockType, params: info.params };
      }
    }
    if (info.type === "transposition_table") ws.engine.transpositionTable = info.params;
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

  const searchBlock = stack(engine, "SEARCH")[0];
  const search = skeleton(searchBlock);
  if (search?.type === "negamax") {
    ws.search.kind = "negamax";
    ws.search.params = search.params;
    for (const slot of SEARCH_SLOTS) {
      for (const b of stack(searchBlock!, SLOT_INPUT[slot])) {
        const type = SEARCH_BY_BLOCK.get(b.type);
        if (type) ws.search.slots[slot].push({ type, params: readParams(b, SEARCH_BLOCKS[type].params) });
        const c = custom(b);
        if (c) ws.search.slots[slot].push(c);
      }
    }
  } else if (search?.type === "random_mover") {
    ws.search.kind = "random_mover";
    if (search.version) ws.versionParams.random_mover = search.params;
  }

  const evalBlock = stack(engine, "EVAL")[0];
  const evaluation = skeleton(evalBlock);
  if (evaluation?.type === "hce") {
    ws.eval.kind = "hce";
    if (evaluation.version) ws.versionParams.hce = evaluation.params;
    const taper = skeleton(stack(evalBlock!, "TAPER")[0]);
    ws.eval.taper = taper?.type === "taper";
    if (taper?.version) ws.versionParams.taper = taper.params;
    for (const b of stack(evalBlock!, "TERMS")) {
      const type = EVAL_BY_BLOCK.get(b.type);
      if (type) ws.eval.terms.push({ type, params: readParams(b, EVAL_TERMS[type].params) });
      const c = custom(b);
      if (c) ws.eval.terms.push(c);
    }
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
  /** A skeleton block, or your version of it when the workspace has one. */
  const skeletonState = (
    type: SkeletonType,
    params: Params | undefined,
    children: [string, BlockState[]][] = [],
    fields: Record<string, string | number> = {},
  ): BlockState => {
    const id = ws.versions?.[type];
    const version = id ? parseBlock(ws.customBlocks?.[id] ?? "").block : null;
    const specs = version ? version.params : (skeletonSpec(type)?.params ?? []);
    return {
      type: version ? customType(version.id) : SKELETON_BLOCK[type],
      fields: { ...fields, ...paramFields(specs, params ?? {}) },
      inputs: inputs(children),
    };
  };
  const vp = ws.versionParams ?? {};
  const settings: BlockState[] = [];
  const tm = ws.engine.timeManagement;
  if (tm) settings.push(skeletonState(tm.type, tm.params));
  if (ws.engine.transpositionTable) settings.push(skeletonState("transposition_table", ws.engine.transpositionTable));
  const search: BlockState[] = [];
  if (ws.search.kind === "negamax") {
    search.push(
      skeletonState(
        "negamax",
        ws.search.params,
        SEARCH_SLOTS.map((slot) => [SLOT_INPUT[slot], (ws.search.slots[slot] ?? []).map(searchState)]),
      ),
    );
  } else if (ws.search.kind === "random_mover") {
    search.push(skeletonState("random_mover", vp.random_mover));
  }
  const evaluation: BlockState[] = [];
  if (ws.eval.kind === "hce") {
    evaluation.push(
      skeletonState("hce", vp.hce, [
        ["TAPER", ws.eval.taper ? [skeletonState("taper", vp.taper)] : []],
        ["TERMS", ws.eval.terms.map(evalState)],
      ]),
    );
  }
  return {
    ...skeletonState(
      "engine",
      vp.engine,
      [
        ["SETTINGS", settings],
        ["SEARCH", search],
        ["EVAL", evaluation],
      ],
      { NAME: ws.engine.name, AUTHOR: ws.engine.author, BENCH_DEPTH: ws.engine.benchDepth },
    ),
    x,
    y,
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
  if ((data?.format as number) !== 1 && data?.format !== 2) throw new Error("This is not a Chess From Scratch workspace file.");
  if (!data.engine || !data.search || !data.eval) {
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
    search: { ...base.search, ...data.search, slots: { ...base.search.slots, ...data.search.slots } },
    eval: { ...base.eval, ...data.eval },
  } as Workspace);
}
