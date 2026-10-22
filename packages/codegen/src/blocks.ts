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
  | "alpha_beta"
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
  /** One line, shown as the block's tooltip. */
  description: string;
  /** A short explanation of the idea, shown when the block is added. */
  info: string;
  /** Chess Programming Wiki page with the full story. */
  cpw: string;
  params: ParamSpec[];
}

export interface SearchBlockSpec extends BlockSpecBase {
  slot: SearchSlot;
  /** Blocks this one needs: other search blocks or the transposition table. */
  requires?: (SearchBlockType | "transposition_table")[];
}

export type EvalTermSpec = BlockSpecBase;

export type TimeBlockType = "basic_time" | "time_management";

export const BASIC_TIME: BlockSpecBase = {
  label: "Basic time management",
  description:
    "Thinks for time left / N plus half the increment on every move. Also used when no time block is placed.",
  info: "Every move gets an equal share of the clock: the time left divided by the number of moves we still expect to play, plus half of the increment. Simple and safe: the engine can never lose on time, but it does not spend more time on hard positions.",
  cpw: "https://www.chessprogramming.org/Time_Management",
  params: [
    { key: "movesLeft", label: "Divide time left by", rust: "TM_MOVES_LEFT", type: "u64", default: 40, min: 1, max: 200 },
  ],
};

export const TIME_MANAGEMENT: BlockSpecBase = {
  label: "Soft/hard time management",
  description: "Splits the remaining clock into a soft limit (no new iteration) and a hard limit (abort the search).",
  info: "Two limits per move. After each iteration of iterative deepening the engine checks the soft limit and does not start a new iteration when it has passed. The hard limit is checked during the search and aborts it, so one very long iteration cannot flag the clock.",
  cpw: "https://www.chessprogramming.org/Time_Management",
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
  info: "The same position is often reached through different move orders (transpositions). The table stores, per position hash, the score, the depth it was searched to and the best move. When the position comes up again at the same or lower depth the stored score can be reused, and the stored move is a strong first guess for move ordering.",
  cpw: "https://www.chessprogramming.org/Transposition_Table",
  params: [
    { key: "hashMb", label: "Hash (MB)", rust: "TT_HASH_MB", type: "usize", default: 16, min: 1, max: 65536 },
  ],
};

export const SEARCH_BLOCKS: Record<SearchBlockType, SearchBlockSpec> = {
  alpha_beta: {
    label: "Alpha-beta pruning",
    description: "Stops searching a node's moves as soon as one proves the opponent will avoid it.",
    info: "Plain negamax looks at every move. Alpha-beta keeps a window: alpha is the score we can already reach, beta the score the opponent will allow. A move that scores beta or more refutes the opponent's previous move, so the remaining moves are skipped (a beta cutoff). The result is the same as plain negamax, found much faster, especially when good moves are tried first. Most other search blocks build on it.",
    cpw: "https://www.chessprogramming.org/Alpha-Beta",
    slot: "move_loop",
    params: [],
  },
  aspiration_windows: {
    label: "Aspiration windows",
    description: "Searches with a narrow window around the previous score, widening on failure.",
    slot: "root",
    info: "Instead of searching with the full window (-infinity, +infinity), iterative deepening searches around the previous iteration's score with a small margin. Most of the time the true score lands inside, and the narrow window prunes more. If it falls outside, the window is widened and the depth searched again.",
    cpw: "https://www.chessprogramming.org/Aspiration_Windows",
    requires: ["alpha_beta"],
    params: [
      { key: "minDepth", label: "From depth", rust: "ASP_MIN_DEPTH", type: "i32", default: 4, min: 1, max: 64 },
      { key: "delta", label: "Window (cp)", rust: "ASP_DELTA", type: "i32", default: 25, min: 1, max: 500 },
    ],
  },
  reverse_futility_pruning: {
    label: "Reverse futility pruning",
    description: "Returns early when the static eval beats beta by a depth-scaled margin.",
    slot: "pruning",
    info: "Also called static null move pruning. Near the leaves, if the static evaluation minus a margin that grows with depth is still at least beta, the side to move is so far ahead that a full search would almost surely fail high too, so the node returns right away.",
    cpw: "https://www.chessprogramming.org/Reverse_Futility_Pruning",
    requires: ["alpha_beta"],
    params: [
      { key: "maxDepth", label: "Up to depth", rust: "RFP_MAX_DEPTH", type: "i32", default: 6, min: 1, max: 32 },
      { key: "margin", label: "Margin per depth (cp)", rust: "RFP_MARGIN", type: "i32", default: 80, min: 1, max: 1000 },
    ],
  },
  null_move_pruning: {
    label: "Null move pruning",
    description: "Gives the opponent a free move; if we still beat beta, prune.",
    slot: "pruning",
    info: "The side to move passes (makes a null move) and the opponent gets a reduced-depth search. If our position is still at least beta after giving away a whole move, it is so strong that the real moves will fail high as well, so the node is cut. Skipped in check and without pieces, where passing would be illegal or zugzwang is likely.",
    cpw: "https://www.chessprogramming.org/Null_Move_Pruning",
    requires: ["alpha_beta"],
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
    requires: ["alpha_beta", "transposition_table"],
    info: "Alpha-beta prunes most when the best move is searched first. The move stored in the transposition table was the best move last time this position was searched, so it is usually the best first try.",
    cpw: "https://www.chessprogramming.org/Hash_Move",
    params: [],
  },
  mvv_lva: {
    label: "MVV-LVA captures",
    description: "Orders captures by most valuable victim, least valuable attacker.",
    slot: "ordering",
    info: "Most Valuable Victim, Least Valuable Attacker. Captures are ordered by what they win first (queen before pawn) and by what they risk second (pawn takes queen before queen takes queen). Good captures early cause cutoffs early.",
    cpw: "https://www.chessprogramming.org/MVV-LVA",
    params: [],
  },
  killers: {
    label: "Killer moves",
    description: "Tries two quiet moves that caused a cutoff at the same ply.",
    slot: "ordering",
    info: "A killer is a quiet move that caused a beta cutoff in another node at the same ply. Positions at the same depth are often similar, so that move is likely to refute this one too. Two killers are kept per ply and tried right after the captures.",
    cpw: "https://www.chessprogramming.org/Killer_Heuristic",
    requires: ["alpha_beta"],
    params: [],
  },
  history: {
    label: "History heuristic",
    description: "Orders quiet moves by how often they caused cutoffs before.",
    slot: "ordering",
    info: "A table scores every quiet move by side, from-square and to-square. When a quiet move causes a cutoff its score goes up by depth squared, and the quiet moves tried before it go down. Remaining quiet moves are tried in order of their score.",
    cpw: "https://www.chessprogramming.org/History_Heuristic",
    requires: ["alpha_beta"],
    params: [
      { key: "bonusMax", label: "Max bonus", rust: "HISTORY_BONUS_MAX", type: "i32", default: 1200, min: 1, max: 16384 },
    ],
  },
  principal_variation_search: {
    label: "Principal variation search",
    description: "Searches later moves with a zero window, re-searching only when they look better.",
    slot: "move_loop",
    info: "With good move ordering the first move is usually the best. The other moves are searched with a zero-width window just to prove they are worse, which is much cheaper. Only when a move turns out better is it searched again with the full window.",
    cpw: "https://www.chessprogramming.org/Principal_Variation_Search",
    requires: ["alpha_beta"],
    params: [],
  },
  late_move_reductions: {
    label: "Late move reductions",
    description: "Searches late quiet moves at reduced depth.",
    slot: "reductions",
    info: "Thanks to move ordering, moves late in the list rarely turn out best. Late quiet moves are searched at reduced depth (more reduction for deeper nodes and later moves). If a reduced search unexpectedly beats alpha, the move is searched again at full depth.",
    cpw: "https://www.chessprogramming.org/Late_Move_Reductions",
    requires: ["alpha_beta"],
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
    info: "Stopping the search at a fixed depth can evaluate in the middle of an exchange, for example right after QxP before PxQ (the horizon effect). Quiescence search keeps searching captures at the leaves until the position is quiet. The side to move may also stand pat on the static evaluation.",
    cpw: "https://www.chessprogramming.org/Quiescence_Search",
    requires: ["alpha_beta"],
    params: [],
  },
};

export const EVAL_TERMS: Record<EvalTermType, EvalTermSpec> = {
  pesto: {
    label: "PeSTO tables",
    description: "Material and piece-square tables for middlegame and endgame.",
    info: "A material value for every piece plus a piece-square table that adds a bonus or penalty for each square, with separate middlegame and endgame values. These tables from Ronald Friederich's PeSTO were tuned automatically and alone already give a reasonable evaluation.",
    cpw: "https://www.chessprogramming.org/PeSTO%27s_Evaluation_Function",
    params: [],
  },
  mobility: {
    label: "Mobility",
    description: "Bonus per safe square each knight, bishop, rook and queen can reach.",
    info: "The number of squares a piece can move to is a good measure of its activity. Here only squares not occupied by own pieces and not attacked by enemy pawns count, multiplied by a weight per piece type.",
    cpw: "https://www.chessprogramming.org/Mobility",
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
    info: "Two bishops can cover squares of both colours, which a single bishop never can. The pair is worth noticeably more than two separate bishops, especially in open positions and endgames.",
    cpw: "https://www.chessprogramming.org/Bishop_Pair",
    params: [
      { key: "bonus", label: "Bonus", rust: "BISHOP_PAIR", type: "S", default: [30, 50], min: -200, max: 200 },
    ],
  },
  rook_files: {
    label: "Rook on open file",
    description: "Bonus for rooks on files without pawns, or without own pawns.",
    info: "A rook needs open lines. On a file without any pawns (open) it can reach the enemy camp; on a file with only enemy pawns (half-open) it can pressure them. Both get a bonus.",
    cpw: "https://www.chessprogramming.org/Rook_on_Open_File",
    params: [
      { key: "open", label: "Open file", rust: "ROOK_OPEN_FILE", type: "S", default: [25, 10], min: -200, max: 200 },
      { key: "halfOpen", label: "Half-open file", rust: "ROOK_HALF_OPEN_FILE", type: "S", default: [12, 8], min: -200, max: 200 },
    ],
  },
  passed_pawns: {
    label: "Passed pawns",
    description: "Bonus for pawns no enemy pawn can stop, growing as they advance.",
    info: "A pawn with no enemy pawns in front of it on its own or neighbouring files can only be stopped by pieces. The further it has advanced, the bigger the threat of promotion, so the bonus grows per rank, especially in the endgame.",
    cpw: "https://www.chessprogramming.org/Passed_Pawn",
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

export const TIME_BLOCKS: Record<TimeBlockType, BlockSpecBase> = {
  basic_time: BASIC_TIME,
  time_management: TIME_MANAGEMENT,
};

/** Explanations for the skeleton blocks that have no parameters of their own. */
export const SKELETON_INFO = {
  engine: {
    label: "Engine",
    info: "The root of your engine. It talks to chess GUIs through the UCI protocol, keeps the board and runs the search you plug in. Bench depth sets how deep the bench command searches its test positions.",
    cpw: "https://www.chessprogramming.org/UCI",
  },
  negamax: {
    label: "Negamax search",
    info: "Negamax is minimax written from the side to move's point of view: a position's score is minus the best score of the opponent's replies. Alpha-beta pruning skips moves that cannot change the result. Iterative deepening searches depth 1, 2, 3, ... so there is always a best move ready when time runs out.",
    cpw: "https://www.chessprogramming.org/Negamax",
  },
  hce: {
    label: "Hand-crafted evaluation",
    info: "Scores a position from rules you choose. Each term gives a middlegame and an endgame value; the two are blended by game phase (tapered evaluation), so a term can matter more in the endgame than in the middlegame.",
    cpw: "https://www.chessprogramming.org/Tapered_Eval",
  },
} as const;

/** Default parameter values for a spec. */
export function defaultParams(params: ParamSpec[]): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of params) out[p.key] = structuredClone(p.default);
  return out;
}
