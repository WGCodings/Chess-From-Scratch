/**
 * The block catalogue: every block the MVP offers, where it may be placed,
 * its parameters with defaults, and the Rust constant each parameter becomes.
 *
 * The editor (Sprint 3) builds its toolbox and parameter fields from this
 * table, and the generator emits `params.rs` from it, so the two can never
 * disagree.
 */

/** A (middlegame, endgame) score pair, `S(mg, eg)` in Rust. */
export type Score = [number, number];

export type ParamValue = number | Score | Score[];

export type RustType = "i32" | "u64" | "usize" | "f64" | "S" | "[S; 4]" | "[S; 8]";

export interface ParamSpec {
  /** Key in the workspace JSON. */
  key: string;
  label: string;
  /** Name of the generated Rust constant. */
  rust: string;
  type: RustType;
  default: ParamValue;
  min?: number;
  max?: number;
  /** Emitted as a `///` doc comment above the constant. */
  doc?: string;
}

/** Places a block can go in the negamax skeleton. */
export type SearchSlot = "root" | "pruning" | "ordering" | "move_loop" | "reductions" | "leaf";

export const SEARCH_SLOTS: readonly SearchSlot[] = [
  "root",
  "pruning",
  "ordering",
  "move_loop",
  "reductions",
  "leaf",
];

export type SearchBlockType =
  | "aspiration_windows"
  | "reverse_futility_pruning"
  | "null_move_pruning"
  | "tt_move_ordering"
  | "mvv_lva"
  | "killers"
  | "history"
  | "principal_variation_search"
  | "late_move_reductions"
  | "quiescence";

export type EvalTermType = "pesto" | "mobility" | "bishop_pair" | "rook_files" | "passed_pawns";

interface BlockSpecBase {
  label: string;
  description: string;
  params: ParamSpec[];
}

export interface SearchBlockSpec extends BlockSpecBase {
  slot: SearchSlot;
  /** Engine-level blocks this one needs. */
  requires?: "transposition_table"[];
}

export type EvalTermSpec = BlockSpecBase;

export const TIME_MANAGEMENT: BlockSpecBase = {
  label: "Time management",
  description: "Splits the remaining clock into a soft and a hard limit per move.",
  params: [
    { key: "movesToGo", label: "Moves to go (guess)", rust: "TM_MOVES_TO_GO", type: "u64", default: 25, min: 1, max: 100 },
    { key: "incPercent", label: "Increment used (%)", rust: "TM_INC_PERCENT", type: "u64", default: 75, min: 0, max: 100 },
    { key: "hardMultiplier", label: "Hard limit (x soft)", rust: "TM_HARD_MULTIPLIER", type: "u64", default: 3, min: 1, max: 10 },
    { key: "overheadMs", label: "Move overhead (ms)", rust: "TM_OVERHEAD_MS", type: "u64", default: 25, min: 0, max: 1000 },
  ],
};

export const TRANSPOSITION_TABLE: BlockSpecBase = {
  label: "Transposition table",
  description:
    "Remembers searched positions. Enables TT cutoffs, TT move ordering and the UCI Hash option.",
  params: [
    { key: "hashMb", label: "Hash (MB)", rust: "TT_HASH_MB", type: "usize", default: 16, min: 1, max: 65536 },
  ],
};

export const SEARCH_BLOCKS: Record<SearchBlockType, SearchBlockSpec> = {
  aspiration_windows: {
    label: "Aspiration windows",
    description: "Searches with a narrow window around the previous score, widening on failure.",
    slot: "root",
    params: [
      { key: "minDepth", label: "From depth", rust: "ASP_MIN_DEPTH", type: "i32", default: 4, min: 1, max: 64 },
      { key: "delta", label: "Window (cp)", rust: "ASP_DELTA", type: "i32", default: 25, min: 1, max: 500 },
    ],
  },
  reverse_futility_pruning: {
    label: "Reverse futility pruning",
    description: "Returns early when the static eval beats beta by a depth-scaled margin.",
    slot: "pruning",
    params: [
      { key: "maxDepth", label: "Up to depth", rust: "RFP_MAX_DEPTH", type: "i32", default: 6, min: 1, max: 32 },
      { key: "margin", label: "Margin per depth (cp)", rust: "RFP_MARGIN", type: "i32", default: 80, min: 1, max: 1000 },
    ],
  },
  null_move_pruning: {
    label: "Null move pruning",
    description: "Gives the opponent a free move; if we still beat beta, prune.",
    slot: "pruning",
    params: [
      { key: "minDepth", label: "From depth", rust: "NMP_MIN_DEPTH", type: "i32", default: 3, min: 1, max: 32 },
      { key: "baseReduction", label: "Base reduction", rust: "NMP_BASE_REDUCTION", type: "i32", default: 3, min: 1, max: 10 },
      { key: "depthDivisor", label: "Depth divisor", rust: "NMP_DEPTH_DIVISOR", type: "i32", default: 4, min: 1, max: 32 },
    ],
  },
  tt_move_ordering: {
    label: "TT move first",
    description: "Tries the best move stored in the transposition table first.",
    slot: "ordering",
    requires: ["transposition_table"],
    params: [],
  },
  mvv_lva: {
    label: "MVV-LVA captures",
    description: "Orders captures by most valuable victim, least valuable attacker.",
    slot: "ordering",
    params: [],
  },
  killers: {
    label: "Killer moves",
    description: "Tries two quiet moves that caused a cutoff at the same ply.",
    slot: "ordering",
    params: [],
  },
  history: {
    label: "History heuristic",
    description: "Orders quiet moves by how often they caused cutoffs before.",
    slot: "ordering",
    params: [
      { key: "bonusMax", label: "Max bonus", rust: "HISTORY_BONUS_MAX", type: "i32", default: 1200, min: 1, max: 16384 },
    ],
  },
  principal_variation_search: {
    label: "Principal variation search",
    description: "Searches later moves with a zero window, re-searching only when they look better.",
    slot: "move_loop",
    params: [],
  },
  late_move_reductions: {
    label: "Late move reductions",
    description: "Searches late quiet moves at reduced depth.",
    slot: "reductions",
    params: [
      { key: "minDepth", label: "From depth", rust: "LMR_MIN_DEPTH", type: "i32", default: 3, min: 1, max: 32 },
      { key: "minMoves", label: "After move #", rust: "LMR_MIN_MOVES", type: "usize", default: 3, min: 1, max: 64 },
      { key: "minMovesPv", label: "After move # (PV)", rust: "LMR_MIN_MOVES_PV", type: "usize", default: 4, min: 1, max: 64 },
      { key: "base", label: "Base", rust: "LMR_BASE", type: "f64", default: 0.75, min: -5, max: 5 },
      { key: "divisor", label: "Divisor", rust: "LMR_DIVISOR", type: "f64", default: 2.25, min: 0.1, max: 10 },
    ],
  },
  quiescence: {
    label: "Quiescence search",
    description: "At depth 0, keeps searching captures until the position is quiet.",
    slot: "leaf",
    params: [],
  },
};

export const EVAL_TERMS: Record<EvalTermType, EvalTermSpec> = {
  pesto: {
    label: "PeSTO tables",
    description: "Material and piece-square tables for middlegame and endgame.",
    params: [],
  },
  mobility: {
    label: "Mobility",
    description: "Bonus per safe square each knight, bishop, rook and queen can reach.",
    params: [
      {
        key: "weights",
        label: "Weight per square (N, B, R, Q)",
        rust: "MOBILITY",
        type: "[S; 4]",
        default: [[4, 4], [5, 5], [2, 4], [1, 2]],
        min: -50,
        max: 50,
        doc: "Per reachable safe square: knight, bishop, rook, queen.",
      },
    ],
  },
  bishop_pair: {
    label: "Bishop pair",
    description: "Bonus for keeping both bishops.",
    params: [
      { key: "bonus", label: "Bonus", rust: "BISHOP_PAIR", type: "S", default: [30, 50], min: -200, max: 200 },
    ],
  },
  rook_files: {
    label: "Rook on open file",
    description: "Bonus for rooks on files without pawns, or without own pawns.",
    params: [
      { key: "open", label: "Open file", rust: "ROOK_OPEN_FILE", type: "S", default: [25, 10], min: -200, max: 200 },
      { key: "halfOpen", label: "Half-open file", rust: "ROOK_HALF_OPEN_FILE", type: "S", default: [12, 8], min: -200, max: 200 },
    ],
  },
  passed_pawns: {
    label: "Passed pawns",
    description: "Bonus for pawns no enemy pawn can stop, growing as they advance.",
    params: [
      {
        key: "byRank",
        label: "Bonus by rank (1-8)",
        rust: "PASSED_PAWN",
        type: "[S; 8]",
        default: [[0, 0], [5, 10], [10, 20], [15, 35], [30, 60], [50, 100], [80, 150], [0, 0]],
        min: -500,
        max: 500,
        doc: "Indexed by rank from the pawn owner's side: rank 1 .. rank 8.",
      },
    ],
  },
};

/** Default parameter values for a spec. */
export function defaultParams(params: ParamSpec[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of params) out[p.key] = structuredClone(p.default);
  return out;
}
