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
  TIME_MANAGEMENT,
  TRANSPOSITION_TABLE,
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
export const TT = "cfs_transposition_table";

export const searchType = (t: SearchBlockType) => `cfs_search_${t}`;
export const evalType = (t: EvalTermType) => `cfs_eval_${t}`;

/** Statement input name for each search slot on the negamax block. */
export const SLOT_INPUT: Record<SearchSlot, string> = {
  root: "ROOT",
  pruning: "PRUNING",
  ordering: "ORDERING",
  move_loop: "MOVE_LOOP",
  reductions: "REDUCTIONS",
  leaf: "LEAF",
};

const SLOT_LABEL: Record<SearchSlot, string> = {
  root: "at the root",
  pruning: "before the move loop",
  ordering: "order moves by",
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

let defined = false;

/** Registers every CFS block type with Blockly (idempotent). */
export function defineBlocks(): void {
  if (defined) return;
  defined = true;

  const defs: Record<string, unknown>[] = [
    {
      type: ENGINE,
      message0: "Engine %1 by %2",
      args0: [
        { type: "field_input", name: "NAME", text: "My Engine" },
        { type: "field_input", name: "AUTHOR", text: "me" },
      ],
      message1: "bench depth %1",
      args1: [
        { type: "field_number", name: "BENCH_DEPTH", value: DEFAULT_BENCH_DEPTH, min: 1, max: MAX_BENCH_DEPTH, precision: 1 },
      ],
      message2: "settings %1",
      args2: [{ type: "input_statement", name: "SETTINGS", check: "engine_setting" }],
      message3: "search %1",
      args3: [{ type: "input_statement", name: "SEARCH", check: "search_skeleton" }],
      message4: "evaluation %1",
      args4: [{ type: "input_statement", name: "EVAL", check: "eval_skeleton" }],
      colour: COLOURS.engine,
      tooltip: "The root of your engine. Plug a search and an evaluation into it.",
    },
    paramBlock(TIME, TIME_MANAGEMENT.label, TIME_MANAGEMENT.params, {
      previousStatement: "engine_setting",
      nextStatement: "engine_setting",
      colour: COLOURS.setting,
      tooltip: TIME_MANAGEMENT.description,
    }),
    paramBlock(TT, TRANSPOSITION_TABLE.label, TRANSPOSITION_TABLE.params, {
      previousStatement: "engine_setting",
      nextStatement: "engine_setting",
      colour: COLOURS.setting,
      tooltip: TRANSPOSITION_TABLE.description,
    }),
    {
      type: NEGAMAX,
      message0: "Negamax search (iterative deepening)",
      ...Object.fromEntries(
        (Object.keys(SLOT_INPUT) as SearchSlot[]).flatMap((slot, i) => [
          [`message${i + 1}`, `${SLOT_LABEL[slot]} %1`],
          [`args${i + 1}`, [{ type: "input_statement", name: SLOT_INPUT[slot], check: `slot_${slot}` }]],
        ]),
      ),
      previousStatement: "search_skeleton",
      colour: COLOURS.skeleton,
      tooltip: "Alpha-beta negamax with iterative deepening. Drop search blocks into its slots.",
    },
    {
      type: HCE,
      message0: "Hand-crafted evaluation (tapered)",
      message1: "terms %1",
      args1: [{ type: "input_statement", name: "TERMS", check: "eval_term" }],
      previousStatement: "eval_skeleton",
      colour: COLOURS.eval,
      tooltip: "Adds up the terms below, blending middlegame and endgame by game phase.",
    },
  ];

  for (const [type, spec] of Object.entries(SEARCH_BLOCKS) as [SearchBlockType, (typeof SEARCH_BLOCKS)[SearchBlockType]][]) {
    defs.push(
      paramBlock(searchType(type), spec.label, spec.params, {
        previousStatement: `slot_${spec.slot}`,
        nextStatement: `slot_${spec.slot}`,
        colour: COLOURS[spec.slot],
        tooltip: spec.description + (spec.requires ? " Needs a Transposition table." : ""),
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

/** Every CFS block may appear at most once. */
export function maxInstances(): Record<string, number> {
  const types = [
    ENGINE,
    NEGAMAX,
    HCE,
    TIME,
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

export function toolbox(): Blockly.utils.toolbox.ToolboxDefinition {
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
        { kind: "block", type: TIME },
        { kind: "block", type: TT },
      ]),
      category("Search", COLOURS.skeleton, [{ kind: "block", type: NEGAMAX }, ...blocksIn("root")]),
      category("Pruning", COLOURS.pruning, blocksIn("pruning")),
      category("Move ordering", COLOURS.ordering, blocksIn("ordering")),
      category("Move loop", COLOURS.move_loop, [...blocksIn("move_loop"), ...blocksIn("reductions")]),
      category("Leaf", COLOURS.leaf, blocksIn("leaf")),
      category("Evaluation", COLOURS.eval, [
        { kind: "block", type: HCE },
        ...(Object.keys(EVAL_TERMS) as EvalTermType[]).map((t) => ({ kind: "block", type: evalType(t) })),
      ]),
    ],
  } as Blockly.utils.toolbox.ToolboxDefinition;
}
