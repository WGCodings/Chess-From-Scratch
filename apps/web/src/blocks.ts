/**
 * Blockly block definitions and the toolbox, generated from the codegen
 * block catalogue so the editor and the generator always agree.
 */

import * as Blockly from "blockly";
import {
  EVAL_TERMS,
  MAX_BENCH_DEPTH,
  DEFAULT_BENCH_DEPTH,
  SEARCH_BLOCKS,
  BASIC_TIME,
  TIME_MANAGEMENT,
  TRANSPOSITION_TABLE,
  SKELETON_TYPES,
  isCustomSlot,
  skeletonSpec,
  type BlockFile,
  type SkeletonType,
  type EvalTermType,
  type ParamSpec,
  type SearchBlockType,
  type SearchSlot,
} from "@cfs/codegen";

// Block types --------------------------------------------------------------

export const ENGINE = "cfs_engine";
export const NEGAMAX = "cfs_negamax";
export const HCE = "cfs_hce";
export const TIME = "cfs_time_management";
export const BASIC_TIME_BLOCK = "cfs_basic_time";
export const TT = "cfs_transposition_table";
export const RANDOM = "cfs_random_mover";
export const TAPER = "cfs_taper";

export const searchType = (t: SearchBlockType) => `cfs_search_${t}`;
export const evalType = (t: EvalTermType) => `cfs_eval_${t}`;
/** Blockly type of a custom block (forks and new blocks). */
export const customType = (id: string) => `cfs_custom_${id}`;
export const CUSTOM_PREFIX = "cfs_custom_";

/** Statement input name for each search slot on the negamax block. */
export const SLOT_INPUT: Record<SearchSlot, string> = {
  root: "ROOT",
  pruning: "PRUNING",
  ordering: "ORDERING",
  extensions: "EXTENSIONS",
  move_loop: "MOVE_LOOP",
  reductions: "REDUCTIONS",
  leaf: "LEAF",
};

const SLOT_LABEL: Record<SearchSlot, string> = {
  root: "at the root",
  pruning: "before the move loop",
  ordering: "order moves by",
  extensions: "extend moves",
  move_loop: "move loop",
  reductions: "reduce late moves",
  leaf: "at depth 0",
};

// Colours (one family per kind of block) ------------------------------------

export const COLOURS = {
  engine: "#3d4a5c",
  setting: "#6b7a90",
  skeleton: "#2f6f4f",
  root: "#3f8f7a",
  pruning: "#c76b2e",
  ordering: "#3d73b8",
  extensions: "#b8564a",
  move_loop: "#7a5bb5",
  reductions: "#9a4fa0",
  leaf: "#2c8a9a",
  eval: "#b08a1e",
  evalTerm: "#c49a2c",
} as const;

// Field naming --------------------------------------------------------------

/** Blockly field names for one parameter, in display order. */
export function fieldNames(spec: ParamSpec): string[] {
  switch (spec.type) {
    case "S":
      return [`${spec.key}_mg`, `${spec.key}_eg`];
    case "[S; 4]":
    case "[S; 8]": {
      const n = spec.type === "[S; 4]" ? 4 : 8;
      return Array.from({ length: n }, (_, i) => [`${spec.key}_${i}_mg`, `${spec.key}_${i}_eg`]).flat();
    }
    default:
      return [spec.key];
  }
}

const PIECES = ["Knight", "Bishop", "Rook", "Queen"];

function numberField(name: string, value: number, spec: ParamSpec) {
  return {
    type: "field_number",
    name,
    value,
    min: spec.min,
    max: spec.max,
    precision: spec.type === "f64" ? 0.01 : 1,
  };
}

interface Row {
  message: string;
  args: object[];
}

/** One row per scalar, one row per score, one row per array element. */
function paramRows(spec: ParamSpec): Row[] {
  const d = spec.default;
  switch (spec.type) {
    case "S": {
      const [mg, eg] = d as [number, number];
      return [
        {
          message: `${spec.label}   mg %1  eg %2`,
          args: [numberField(`${spec.key}_mg`, mg, spec), numberField(`${spec.key}_eg`, eg, spec)],
        },
      ];
    }
    case "[S; 4]":
    case "[S; 8]": {
      const items = d as [number, number][];
      const name = (i: number) => (spec.type === "[S; 4]" ? PIECES[i]! : `Rank ${i + 1}`);
      return [
        { message: spec.label, args: [] },
        ...items.map(([mg, eg], i) => ({
          message: `   ${name(i)}   mg %1  eg %2`,
          args: [
            numberField(`${spec.key}_${i}_mg`, mg, spec),
            numberField(`${spec.key}_${i}_eg`, eg, spec),
          ],
        })),
      ];
    }
    default:
      return [{ message: `${spec.label} %1`, args: [numberField(spec.key, d as number, spec)] }];
  }
}

/** A JSON block definition with a title row and one row per parameter. */
function paramBlock(
  type: string,
  title: string,
  params: ParamSpec[],
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const def: Record<string, unknown> = { type, inputsInline: false, ...extra };
  const rows: Row[] = [{ message: title, args: [] }, ...params.flatMap(paramRows)];
  rows.forEach((row, i) => {
    def[`message${i}`] = row.message;
    def[`args${i}`] = row.args;
  });
  return def;
}

// Definitions ---------------------------------------------------------------

/** Appends rows to a block definition after the ones it has. */
function addRows(def: Record<string, unknown>, rows: Row[]): Record<string, unknown> {
  let n = 0;
  while (def[`message${n}`] !== undefined) n++;
  rows.forEach((row, k) => {
    def[`message${n + k}`] = row.message;
    def[`args${n + k}`] = row.args;
  });
  return def;
}

const SETTING = { previousStatement: "engine_setting", nextStatement: "engine_setting", colour: COLOURS.setting };

/**
 * The shape of each skeleton block. Your own version of a skeleton block
 * gets the same shape with its own title and parameters.
 */
export function skeletonDef(base: SkeletonType, type: string, title: string, params: ParamSpec[]): Record<string, unknown> {
  switch (base) {
    case "engine":
      return addRows(
        {
          type,
          message0: `${title} %1 by %2`,
          args0: [
            { type: "field_input", name: "NAME", text: "My Engine" },
            { type: "field_input", name: "AUTHOR", text: "me" },
          ],
          message1: "bench depth %1",
          args1: [
            { type: "field_number", name: "BENCH_DEPTH", value: DEFAULT_BENCH_DEPTH, min: 1, max: MAX_BENCH_DEPTH, precision: 1 },
          ],
          colour: COLOURS.engine,
          tooltip: "The root of your engine. Plug a search and an evaluation into it.",
        },
        [
          ...params.flatMap(paramRows),
          { message: "settings %1", args: [{ type: "input_statement", name: "SETTINGS", check: "engine_setting" }] },
          { message: "search %1", args: [{ type: "input_statement", name: "SEARCH", check: "search_skeleton" }] },
          { message: "evaluation %1", args: [{ type: "input_statement", name: "EVAL", check: "eval_skeleton" }] },
        ],
      );
    case "negamax":
      return addRows(
        paramBlock(type, title, params, {
          previousStatement: "search_skeleton",
          colour: COLOURS.skeleton,
          tooltip: "Negamax: a fixed-depth search on its own. Drop search blocks into its slots.",
        }),
        (Object.keys(SLOT_INPUT) as SearchSlot[]).map((slot) => ({
          message: `${SLOT_LABEL[slot]} %1`,
          args: [{ type: "input_statement", name: SLOT_INPUT[slot], check: `slot_${slot}` }],
        })),
      );
    case "random_mover":
      return paramBlock(type, title, params, {
        previousStatement: "search_skeleton",
        colour: COLOURS.skeleton,
        tooltip: "Plays a random legal move. Needs no evaluation.",
      });
    case "hce":
      return addRows(
        paramBlock(type, title, params, {
          previousStatement: "eval_skeleton",
          colour: COLOURS.eval,
          tooltip: "Adds up the terms below. Without Tapered evaluation the middlegame values are the score.",
        }),
        [
          { message: "blend by phase %1", args: [{ type: "input_statement", name: "TAPER", check: "taper" }] },
          { message: "terms %1", args: [{ type: "input_statement", name: "TERMS", check: "eval_term" }] },
        ],
      );
    case "taper":
      return paramBlock(type, title, params, {
        previousStatement: "taper",
        colour: COLOURS.evalTerm,
        tooltip: "Blends middlegame and endgame values by game phase.",
      });
    case "transposition_table":
      return paramBlock(type, title, params, { ...SETTING, tooltip: TRANSPOSITION_TABLE.description });
    case "basic_time":
      return paramBlock(type, title, params, { ...SETTING, tooltip: BASIC_TIME.description });
    case "time_management":
      return paramBlock(type, title, params, { ...SETTING, tooltip: TIME_MANAGEMENT.description });
  }
}

/** The Blockly type of each built-in skeleton block. */
export const SKELETON_BLOCK: Record<SkeletonType, string> = {
  engine: "cfs_engine",
  negamax: "cfs_negamax",
  random_mover: "cfs_random_mover",
  hce: "cfs_hce",
  taper: "cfs_taper",
  transposition_table: "cfs_transposition_table",
  basic_time: "cfs_basic_time",
  time_management: "cfs_time_management",
};

/** The skeleton type of a built-in Blockly type, if it is one. */
export function skeletonOf(blockType: string): SkeletonType | null {
  const hit = Object.entries(SKELETON_BLOCK).find(([, t]) => t === blockType);
  return hit ? (hit[0] as SkeletonType) : null;
}

let defined = false;

/** Registers every CFS block type with Blockly (idempotent). */
export function defineBlocks(): void {
  if (defined) return;
  defined = true;

  const defs: Record<string, unknown>[] = SKELETON_TYPES.map((base) =>
    skeletonDef(base, SKELETON_BLOCK[base], base === "engine" ? "Engine" : skeletonSpec(base)!.label, skeletonSpec(base)!.params),
  );

  for (const [type, spec] of Object.entries(SEARCH_BLOCKS) as [SearchBlockType, (typeof SEARCH_BLOCKS)[SearchBlockType]][]) {
    defs.push(
      paramBlock(searchType(type), spec.label, spec.params, {
        previousStatement: `slot_${spec.slot}`,
        nextStatement: `slot_${spec.slot}`,
        colour: COLOURS[spec.slot],
        tooltip:
          spec.description +
          (spec.requires
            ? ` Needs ${spec.requires.map((r) => (r === "transposition_table" ? "a Transposition table" : SEARCH_BLOCKS[r].label)).join(" and ")}.`
            : ""),
      }),
    );
  }
  for (const [type, spec] of Object.entries(EVAL_TERMS) as [EvalTermType, (typeof EVAL_TERMS)[EvalTermType]][]) {
    defs.push(
      paramBlock(evalType(type), spec.label, spec.params, {
        previousStatement: "eval_term",
        nextStatement: "eval_term",
        colour: COLOURS.evalTerm,
        tooltip: spec.description,
      }),
    );
  }

  Blockly.common.defineBlocksWithJsonArray(defs);
}

/** Defines (or redefines) the Blockly type of a custom block. */
export function defineCustomBlock(b: BlockFile): string {
  const type = customType(b.id);
  if (b.base && skeletonSpec(b.base) && !isCustomSlot(b.slot)) {
    // Your version of a skeleton block: same shape, your title and parameters.
    const def = skeletonDef(b.base as SkeletonType, type, `✎ ${b.label}`, b.params);
    def.tooltip = `${b.description || "Your own version."} Right-click > Edit this block to change its code.`;
    delete Blockly.Blocks[type];
    Blockly.common.defineBlocksWithJsonArray([def]);
    return type;
  }
  const slot = b.slot === "eval" || !isCustomSlot(b.slot) ? null : b.slot;
  const def = paramBlock(type, `✎ ${b.label}`, b.params, {
    previousStatement: slot ? `slot_${slot}` : "eval_term",
    nextStatement: slot ? `slot_${slot}` : "eval_term",
    colour: slot ? COLOURS[slot] : COLOURS.evalTerm,
    tooltip: `${b.description || "Your own block."}${b.requires.length ? ` Needs ${b.requires.join(" and ")}.` : ""} Right-click > Edit this block to change its code.`,
  });
  delete Blockly.Blocks[type];
  Blockly.common.defineBlocksWithJsonArray([def]);
  return type;
}

/** Every CFS block may appear at most once. */
export function maxInstances(): Record<string, number> {
  const types = [
    ...Object.values(SKELETON_BLOCK),
    ENGINE,
    NEGAMAX,
    HCE,
    TIME,
    BASIC_TIME_BLOCK,
    TT,
    ...(Object.keys(SEARCH_BLOCKS) as SearchBlockType[]).map(searchType),
    ...(Object.keys(EVAL_TERMS) as EvalTermType[]).map(evalType),
  ];
  return Object.fromEntries(types.map((t) => [t, 1]));
}

// Toolbox -------------------------------------------------------------------

const blocksIn = (slot: SearchSlot) =>
  (Object.keys(SEARCH_BLOCKS) as SearchBlockType[])
    .filter((t) => SEARCH_BLOCKS[t].slot === slot)
    .map((t) => ({ kind: "block", type: searchType(t) }));

/** Entries of the My blocks category. */
export interface ToolboxCustom {
  id: string;
  group: "project" | "library" | "example";
}

export const NEW_BLOCK_BUTTON = "cfsNewBlock";
export const IMPORT_BLOCK_BUTTON = "cfsImportBlock";

/** Disabled reason of drawer blocks whose requirements are not in the engine yet. */
export const NEEDS_REASON = "cfs_needs";

/** Marks the drawer blocks in `disabled` as not placeable yet. */
function markDisabled(items: object[], disabled: ReadonlySet<string>): object[] {
  return items.map((item) => {
    const it = item as { kind: string; type?: string; contents?: object[] };
    if (it.kind === "block" && it.type && disabled.has(it.type)) return { ...it, disabledReasons: [NEEDS_REASON] };
    if (it.contents) return { ...it, contents: markDisabled(it.contents, disabled) };
    return it;
  });
}

/** The drawer. Blocks in `disabled` are greyed out: they need another block first. */
export function toolbox(custom: ToolboxCustom[] = [], disabled: ReadonlySet<string> = new Set()): Blockly.utils.toolbox.ToolboxDefinition {
  const def = catalogue(custom) as { kind: string; contents: object[] };
  return { ...def, contents: markDisabled(def.contents, disabled) } as Blockly.utils.toolbox.ToolboxDefinition;
}

function catalogue(custom: ToolboxCustom[]): Blockly.utils.toolbox.ToolboxDefinition {
  const category = (name: string, colour: string, contents: object[]) => ({
    kind: "category",
    name,
    colour,
    contents,
  });
  return {
    kind: "categoryToolbox",
    contents: [
      category("Engine", COLOURS.engine, [
        { kind: "block", type: ENGINE },
        { kind: "block", type: BASIC_TIME_BLOCK },
        { kind: "block", type: TIME },
        { kind: "block", type: TT },
      ]),
      category("Search", COLOURS.skeleton, [
        { kind: "block", type: RANDOM },
        { kind: "block", type: NEGAMAX },
        ...blocksIn("root"),
      ]),
      category("Pruning", COLOURS.pruning, blocksIn("pruning")),
      category("Move ordering", COLOURS.ordering, blocksIn("ordering")),
      category("Move loop", COLOURS.move_loop, [...blocksIn("move_loop"), ...blocksIn("reductions")]),
      category("Leaf", COLOURS.leaf, blocksIn("leaf")),
      category("Evaluation", COLOURS.eval, [
        { kind: "block", type: HCE },
        { kind: "block", type: TAPER },
        ...(Object.keys(EVAL_TERMS) as EvalTermType[]).map((t) => ({ kind: "block", type: evalType(t) })),
      ]),
      category("My blocks", "#5c5c5c", [
        { kind: "button", text: "New block…", callbackKey: NEW_BLOCK_BUTTON },
        { kind: "button", text: "Import block file…", callbackKey: IMPORT_BLOCK_BUTTON },
        ...customGroup(custom, "project", "In this project"),
        ...customGroup(custom, "library", "Saved in your browser"),
        ...customGroup(custom, "example", "Examples"),
      ]),
    ],
  } as Blockly.utils.toolbox.ToolboxDefinition;
}

function customGroup(custom: ToolboxCustom[], group: ToolboxCustom["group"], title: string): object[] {
  const items = custom.filter((c) => c.group === group);
  if (items.length === 0) return [];
  return [{ kind: "label", text: title }, ...items.map((c) => ({ kind: "block", type: customType(c.id) }))];
}
