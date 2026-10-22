//! Negamax search skeleton. Each placed block sits between
//! `// @block <name>` and `// @end <name>` markers.

// Some imports are only used by some blocks; don't warn about the others.
#![allow(unused_imports)]

// Imports: the stop flag shared with the UCI thread, the chess library and the other parts of
// the engine.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cozy_chess::{Board, Color, Move, Piece};

use crate::eval::evaluate;
use crate::moves::{MoveList, PvTable};
use crate::params::*;
use crate::position::Position;
use crate::score::{print_info, IterationInfo, INF, MATE, MATE_BOUND, MAX_PLY};
use crate::time::TimeManager;
use crate::uci::{Engine, SearchResult};

// @block mvv_lva|quiescence|use_is_capture
use crate::moves::is_capture;
// @end mvv_lva|quiescence|use_is_capture
// @block killers|history|late_move_reductions|use_quiet
use crate::moves::is_quiet;
// @end killers|history|late_move_reductions|use_quiet

// @block transposition_table
// The transposition table stores results of positions searched before.
use crate::tt::{score_from_tt, score_to_tt, Bound, TranspositionTable};
// @end transposition_table

// @hook search_imports

/// Everything the search keeps: counters, the clock, the stop flag and the best line.
pub struct Searcher {
    nodes: u64,            // positions visited in this search
    seldepth: usize,       // deepest ply reached, reported to the GUI
    stopped: bool,         // set when time is up; the search then unwinds
    can_stop: bool,        // false until depth 1 is finished, so there is always a move
    stop: Arc<AtomicBool>, // set by the UCI thread on `stop`
    tm: TimeManager,       // decides when time is up
    pv: PvTable,           // the principal variation: the best line found
    // @block transposition_table
    // Remembers search results by position hash, shared across iterations.
    tt: TranspositionTable,
    // @end transposition_table
    // @block killers
    // Quiet moves that recently caused a cutoff, per ply.
    killers: Killers,
    // @end killers
    // @block history
    // How often each quiet move caused a cutoff, over the whole search.
    history: History,
    // @end history
    // @block late_move_reductions
    // Precomputed reductions by depth and move number.
    lmr: [[i32; 64]; 64],
    // @end late_move_reductions
    // @hook searcher_fields
}

// The interface the UCI loop talks to: name, author, setup and searching.
impl Engine for Searcher {
    const NAME: &'static str = ENGINE_NAME;
    const AUTHOR: &'static str = ENGINE_AUTHOR;
    const BENCH_DEPTH: i32 = ENGINE_BENCH_DEPTH;
    // @block transposition_table
    // Default size of the transposition table, shown to GUIs as the Hash option.
    const DEFAULT_HASH_MB: usize = TT_HASH_MB;
    // @end transposition_table

    /// Creates the searcher once, when the engine starts.
    fn new() -> Self {
        Self {
            nodes: 0,
            seldepth: 0,
            stopped: false,
            can_stop: false,
            stop: Arc::new(AtomicBool::new(false)),
            tm: TimeManager::fixed_depth(1),
            pv: PvTable::default(),
            // @block transposition_table
            // Allocate the transposition table with the default Hash size.
            tt: TranspositionTable::new(TT_HASH_MB),
            // @end transposition_table
            // @block killers
            // Start with empty killer slots.
            killers: Killers::default(),
            // @end killers
            // @block history
            // Start with all history scores at zero.
            history: History::default(),
            // @end history
            // @block late_move_reductions
            // Fill the reduction table once at startup.
            lmr: lmr_table(),
            // @end late_move_reductions
            // @hook searcher_init
        }
    }

    /// Called on `ucinewgame`: forget what was learned in the previous game.
    fn new_game(&mut self) {
        // @block transposition_table
        // A new game: old positions are no longer useful.
        self.tt.clear();
        // @end transposition_table
        // @block killers
        // A new game: forget the killer moves.
        self.killers.clear();
        // @end killers
        // @block history
        // A new game: forget the history scores.
        self.history.clear();
        // @end history
        // @hook new_game
    }

    // @block transposition_table
    // The GUI changed the Hash option: reallocate the table.
    fn set_hash(&mut self, mb: usize) {
        self.tt.resize(mb);
    }
    // @end transposition_table

    /// Called by the UCI loop on `go`: searches until time or depth runs out and returns the
    /// best move.
    fn search(
        &mut self,
        pos: &Position,
        tm: TimeManager,
        stop: Arc<AtomicBool>,
        verbose: bool,
    ) -> SearchResult {
        // Reset the counters and take over the clock and stop flag for this search.
        self.nodes = 0;
        self.stopped = false;
        self.can_stop = false;
        self.stop = stop;
        self.tm = tm;
        // @block killers
        // Killers are tied to plies of one search, so start each search fresh.
        self.killers.clear();
        // @end killers
        // @hook root

        // Work on our own copy of the position; no best move yet.
        let mut pos = pos.clone();
        let mut best_move = None;
        // @block aspiration_windows
        // The last finished iteration's score: the centre of the next aspiration window.
        let mut score = 0;
        // @end aspiration_windows

        // Iterative deepening: search depth 1, 2, 3, ... and keep the last finished result.
        for depth in 1..=self.tm.max_depth {
            self.seldepth = 0;
            // @block aspiration_windows
            let new_score = self.search_root(&mut pos, depth, score);
            if self.stopped {
                break;
            }
            score = new_score;
            // @else
            let score = self.search_root(&mut pos, depth);
            // An unfinished iteration is unreliable: keep the previous best move.
            if self.stopped {
                break;
            }
            // @end aspiration_windows
            // The finished iteration's best line; its first move is our best move. From now on
            // the search may be stopped at any time.
            let line = self.pv.root_line();
            best_move = line.first().copied().or(best_move);
            self.can_stop = true;

            // Tell the GUI what we found: depth, score, nodes, speed and the best line.
            if verbose {
                print_info(
                    pos.board(),
                    &IterationInfo {
                        depth,
                        seldepth: self.seldepth,
                        score,
                        nodes: self.nodes,
                        elapsed: self.tm.elapsed(),
                        hashfull: self.hashfull(),
                        pv: &line,
                    },
                );
            }
            // Not enough time left for another, deeper iteration?
            if self.tm.soft_stop(self.nodes) {
                break;
            }
        }

        // Hand the best move back to the UCI loop, which prints `bestmove`.
        SearchResult {
            best_move,
            nodes: self.nodes,
        }
    }
}

// The search itself.
impl Searcher {
    /// How full the hash table is, for the GUI's info line (always 0 without one).
    fn hashfull(&self) -> usize {
        // @block transposition_table
        // How full the table is, reported to the GUI in permille.
        self.tt.hashfull()
        // @else
        0
        // @end transposition_table
    }

    /// Checks the clock every 1024 nodes. Depth 1 always finishes.
    #[inline]
    fn check_stop(&mut self) {
        if self.can_stop
            && self.nodes & 1023 == 0
            && (self.stop.load(Ordering::Relaxed) || self.tm.hard_stop(self.nodes))
        {
            self.stopped = true;
        }
    }

    /// Searches the current position to `depth` and returns its score.
    // @block aspiration_windows
    fn search_root(&mut self, pos: &mut Position, depth: i32, prev_score: i32) -> i32 {
        // @else
    fn search_root(&mut self, pos: &mut Position, depth: i32) -> i32 {
        // @end aspiration_windows
        // @block aspiration_windows
        // Search with a narrow window around the last score; most iterations land inside it,
        // which is cheaper.
        if depth >= ASP_MIN_DEPTH {
            let mut delta = ASP_DELTA;
            let mut alpha = (prev_score - delta).max(-INF);
            let mut beta = (prev_score + delta).min(INF);
            loop {
                let score = self.negamax(pos, depth, 0, alpha, beta);
                if self.stopped {
                    return score;
                }
                if score <= alpha {
                    alpha = (score - delta).max(-INF);
                } else if score >= beta {
                    beta = (score + delta).min(INF);
                } else {
                    return score;
                }
                delta *= 2;
            }
        }
        // @end aspiration_windows
        // @block alpha_beta
        // The root starts with the widest window: every score is still possible.
        self.negamax(pos, depth, 0, -INF, INF)
        // @else
        self.negamax(pos, depth, 0)
        // @end alpha_beta
    }

    // @block alpha_beta
    /// Negamax with alpha-beta pruning. Returns the score of `pos` for the side to move, but
    /// only exactly when it lies between alpha (what we can already reach) and beta (what the
    /// opponent will allow); outside that window a bound is good enough.
    fn negamax(
        &mut self,
        pos: &mut Position,
        depth: i32,
        ply: usize,
        mut alpha: i32,
        beta: i32,
    ) -> i32 {
        // @else
    /// Negamax: the score of a position for the side to move is the best of the negated scores
    /// of its replies, searched `depth` moves deep.
    fn negamax(&mut self, pos: &mut Position, depth: i32, ply: usize) -> i32 {
        // @end alpha_beta
        // @block transposition_table|reverse_futility_pruning|null_move_pruning|late_move_reductions|use_pv_node
        // A PV node has an open window, so its exact score matters: prune it less.
        let pv_node = beta - alpha > 1;
        // @end transposition_table|reverse_futility_pruning|null_move_pruning|late_move_reductions|use_pv_node
        // Forget the PV below this node; it is rebuilt from the moves searched here.
        self.pv.clear(ply);

        // At the horizon, stop searching and score the position.
        if depth <= 0 {
            // @hook leaf
            // @block quiescence
            // At depth 0 keep searching captures so we never evaluate in the middle of an
            // exchange.
            return self.qsearch(pos, ply, alpha, beta);
            // @else
            return evaluate(pos.board());
            // @end quiescence
        }

        // Count the node and stop when time is up (the result is then thrown away).
        self.nodes += 1;
        self.check_stop();
        if self.stopped {
            return 0;
        }
        self.seldepth = self.seldepth.max(ply);
        // Repetitions and the fifty-move rule are draws.
        if ply > 0 && pos.is_draw() {
            return 0;
        }
        if ply >= MAX_PLY - 1 {
            return evaluate(pos.board());
        }

        let board = pos.board().clone();
        // @block null_move_pruning|history|use_stm
        let stm = board.side_to_move();
        // @end null_move_pruning|history|use_stm
        let in_check = !board.checkers().is_empty();

        // @block transposition_table
        // Seen this position before at enough depth? Reuse that result, and remember its best
        // move.
        // @block tt_move_ordering|use_tt_move
        let mut tt_move = None;
        // @end tt_move_ordering|use_tt_move
        // Look the position up by its hash.
        if let Some(entry) = self.tt.probe(board.hash()) {
            // @block tt_move_ordering|use_tt_move
            tt_move = entry.mv();
            // @end tt_move_ordering|use_tt_move
            // Searched deep enough before, and the stored bound settles this window: done.
            let tt_score = score_from_tt(entry.score, ply);
            if !pv_node && entry.depth as i32 >= depth && entry.cuts(tt_score, alpha, beta) {
                return tt_score;
            }
        }
        // @end transposition_table

        // @hook node_start

        // @block reverse_futility_pruning|null_move_pruning|use_static_eval
        // The static evaluation guides the pruning decisions below.
        let static_eval = if in_check { -INF } else { evaluate(&board) };
        // @end reverse_futility_pruning|null_move_pruning|use_static_eval

        // @block reverse_futility_pruning
        // Static eval is far above beta even after a safety margin: assume the node fails high.
        if !pv_node
            && !in_check
            && depth <= RFP_MAX_DEPTH
            && static_eval - RFP_MARGIN * depth >= beta
        {
            return static_eval;
        }
        // @end reverse_futility_pruning

        // @block null_move_pruning
        // Give the opponent a free move. If a reduced search still beats beta, this node is good
        // enough to cut.
        if !pv_node
            && !in_check
            && depth >= NMP_MIN_DEPTH
            && static_eval >= beta
            && has_non_pawn_material(&board, stm)
            && !pos.last_move_was_null()
        {
            let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;
            pos.make_null();
            let score = -self.negamax(pos, depth - 1 - r, ply + 1, -beta, -beta + 1);
            pos.unmake();
            if self.stopped {
                return 0;
            }
            if score >= beta {
                return if score >= MATE_BOUND { beta } else { score };
            }
        }
        // @end null_move_pruning

        // @hook pruning

        // No legal moves: checkmate (bad, sooner is worse) or stalemate (a draw).
        // @block tt_move_ordering|mvv_lva|killers|history|slot_ordering
        let mut moves = MoveList::all(&board);
        // @else
        let moves = MoveList::all(&board);
        // @end tt_move_ordering|mvv_lva|killers|history|slot_ordering
        if moves.is_empty() {
            return if in_check { -MATE + ply as i32 } else { 0 };
        }

        // @block tt_move_ordering|mvv_lva|killers|history|slot_ordering
        // Give every move an ordering score; the loop below tries the highest scores first.
        for i in 0..moves.len() {
            let mv = moves.get(i);
            let mut order = 0;
            // @block tt_move_ordering
            // The best move from the transposition table is the most likely best move: try it
            // first.
            if Some(mv) == tt_move {
                order = 1_000_000;
            }
            // @end tt_move_ordering
            // @block mvv_lva
            // Try captures next, the most valuable victim first and with the cheapest attacker.
            if order == 0 && is_capture(&board, mv) {
                order = 100_000 + mvv_lva(&board, mv);
            }
            // @end mvv_lva
            // @block killers
            // Quiet moves that caused a cutoff at this ply in a sibling node.
            if order == 0 {
                match self.killers.slot(ply, mv) {
                    Some(0) => order = 90_000,
                    Some(_) => order = 80_000,
                    None => {}
                }
            }
            // @end killers
            // @block history
            // Other quiet moves: those that often caused cutoffs before go first.
            if order == 0 {
                order = self.history.get(stm, mv);
            }
            // @end history
            // @hook ordering
            moves.set_score(i, order);
        }
        // @end tt_move_ordering|mvv_lva|killers|history|slot_ordering

        // @block transposition_table
        // Remember the window we started with, to know what kind of score we store.
        let original_alpha = alpha;
        let mut best_move = None;
        // @end transposition_table
        // @block history
        // Quiet moves searched so far: punished if a later quiet move causes the cutoff.
        let mut quiets_tried = MoveList::new();
        // @end history
        let mut best_score = -INF;

        // Try every move: play it, search the reply, take it back.
        for i in 0..moves.len() {
            // @block tt_move_ordering|mvv_lva|killers|history|slot_ordering
            let mv = moves.pick(i);
            // @else
            let mv = moves.get(i);
            // @end tt_move_ordering|mvv_lva|killers|history|slot_ordering
            // @block killers|history|late_move_reductions|use_quiet
            let quiet = is_quiet(&board, mv);
            // @end killers|history|late_move_reductions|use_quiet
            pos.make_move(mv);
            // @block slot_extensions|slot_reductions
            // Extensions and reductions: some moves deserve a deeper (or shallower) search.
            let mut extension = 0;
            // @hook extensions
            // @hook reductions
            let new_depth = depth - 1 + extension;
            // @else
            let new_depth = depth - 1;
            // @end slot_extensions|slot_reductions

            // @block alpha_beta
            // @block principal_variation_search|late_move_reductions
            let mut score;
            if i == 0 {
                // The first move is searched with the full window.
                score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
            } else {
                // @block late_move_reductions
                // Late quiet moves rarely matter: search them at reduced depth.
                let mut r = 0;
                let min_moves = if pv_node {
                    LMR_MIN_MOVES_PV
                } else {
                    LMR_MIN_MOVES
                };
                if depth >= LMR_MIN_DEPTH && i >= min_moves && quiet && !in_check {
                    r = self.lmr[depth.min(63) as usize][i.min(63)].clamp(0, new_depth - 1);
                }
                // @end late_move_reductions

                // @block principal_variation_search
                // After the first move, prove a move is no better with a cheap zero-window
                // search; re-search only if it is.
                // @block late_move_reductions
                score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);
                if score > alpha && r > 0 {
                    score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);
                }
                // @else
                score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);
                // @end late_move_reductions
                if score > alpha && score < beta {
                    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
                }
                // @else
                // A reduced move that beats alpha is searched again at full depth.
                score = -self.negamax(pos, new_depth - r, ply + 1, -beta, -alpha);
                if score > alpha && r > 0 {
                    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
                }
                // @end principal_variation_search
            }
            // @else
            // The move's score is the negated score of the reply, searched in our window.
            let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
            // @end principal_variation_search|late_move_reductions
            // @else
            // The move's score is the negated score of the opponent's best reply.
            let score = -self.negamax(pos, new_depth, ply + 1);
            // @end alpha_beta
            pos.unmake();

            if self.stopped {
                return 0;
            }

            // @hook move_loop

            // A new best move: remember it and its line.
            if score > best_score {
                best_score = score;
                // @block alpha_beta
                // Better than anything found so far: raise alpha.
                if score > alpha {
                    alpha = score;
                    // @block transposition_table
                    // Remember the best move, to store it in the transposition table.
                    best_move = Some(mv);
                    // @end transposition_table
                    // The best line now starts with this move.
                    self.pv.update(ply, mv);
                    // Beta cutoff: the opponent will never allow this position, so the
                    // remaining moves do not matter.
                    if score >= beta {
                        // @block killers
                        // Remember this quiet move as a killer for this ply.
                        if quiet {
                            self.killers.push(ply, mv);
                        }
                        // @end killers
                        // @block history
                        // Reward the quiet move that caused the cutoff, punish the quiet moves
                        // tried before it.
                        if quiet {
                            let bonus = (depth * depth).min(HISTORY_BONUS_MAX);
                            self.history.update(stm, mv, bonus);
                            for j in 0..quiets_tried.len() {
                                self.history.update(stm, quiets_tried.get(j), -bonus);
                            }
                        }
                        // @end history
                        // @hook on_cutoff
                        // Skip the remaining moves.
                        break;
                    }
                }
                // @else
                self.pv.update(ply, mv);
                // @end alpha_beta
            }
            // @block history
            if quiet {
                quiets_tried.push(mv);
            }
            // @end history
        }

        // @block transposition_table
        // Store the result so later visits to this position can reuse it.
        let bound = if best_score >= beta {
            Bound::Lower
        } else if best_score > original_alpha {
            Bound::Exact
        } else {
            Bound::Upper
        };
        self.tt.store(
            board.hash(),
            best_move,
            score_to_tt(best_score, ply),
            depth,
            bound,
        );
        // @end transposition_table

        best_score
    }

    // @block quiescence
    /// Searches captures (or all evasions when in check) until the position
    /// is quiet, so the static evaluation is not taken mid-exchange.
    fn qsearch(&mut self, pos: &mut Position, ply: usize, mut alpha: i32, beta: i32) -> i32 {
        self.nodes += 1;
        self.check_stop();
        if self.stopped {
            return 0;
        }
        self.seldepth = self.seldepth.max(ply);
        if pos.is_draw() {
            return 0;
        }
        let board = pos.board().clone();
        if ply >= MAX_PLY - 1 {
            return evaluate(&board);
        }

        let in_check = !board.checkers().is_empty();
        let mut best_score = -INF;
        if !in_check {
            let stand_pat = evaluate(&board);
            if stand_pat >= beta {
                return stand_pat;
            }
            alpha = alpha.max(stand_pat);
            best_score = stand_pat;
        }

        let mut moves = if in_check {
            MoveList::all(&board)
        } else {
            MoveList::captures(&board)
        };
        if in_check && moves.is_empty() {
            return -MATE + ply as i32;
        }
        for i in 0..moves.len() {
            let mv = moves.get(i);
            if is_capture(&board, mv) {
                moves.set_score(i, mvv_lva(&board, mv));
            }
        }

        for i in 0..moves.len() {
            let mv = moves.pick(i);
            pos.make_move(mv);
            let score = -self.qsearch(pos, ply + 1, -beta, -alpha);
            pos.unmake();
            if self.stopped {
                return 0;
            }
            if score > best_score {
                best_score = score;
                if score > alpha {
                    alpha = score;
                    if score >= beta {
                        break;
                    }
                }
            }
        }
        best_score
    }
    // @end quiescence
}

// @block late_move_reductions
/// Reduction by depth and move number: base + ln(depth) * ln(move) / divisor.
fn lmr_table() -> [[i32; 64]; 64] {
    let mut table = [[0; 64]; 64];
    for (depth, row) in table.iter_mut().enumerate().skip(1) {
        for (moves, r) in row.iter_mut().enumerate().skip(1) {
            *r = (LMR_BASE + (depth as f64).ln() * (moves as f64).ln() / LMR_DIVISOR) as i32;
        }
    }
    table
}
// @end late_move_reductions

// @block mvv_lva|quiescence
/// Most Valuable Victim, Least Valuable Attacker: higher is better.
#[inline]
pub fn mvv_lva(board: &Board, mv: Move) -> i32 {
    const VALUE: [i32; 6] = [1, 3, 3, 5, 9, 0];
    let victim = board.piece_on(mv.to).unwrap_or(Piece::Pawn);
    let attacker = board.piece_on(mv.from).unwrap_or(Piece::Pawn);
    VALUE[victim as usize] * 16 - VALUE[attacker as usize]
}
// @end mvv_lva|quiescence

// @block null_move_pruning
/// True when `color` has a knight, bishop, rook or queen (null-move safety).
#[inline]
pub fn has_non_pawn_material(board: &Board, color: Color) -> bool {
    let pawns_and_king = board.pieces(Piece::Pawn) | board.pieces(Piece::King);
    !(board.colors(color) & !pawns_and_king).is_empty()
}
// @end null_move_pruning

// @block killers
/// Two quiet moves per ply that recently caused a beta cutoff.
pub struct Killers {
    table: [[Option<Move>; 2]; MAX_PLY + 1],
}

impl Default for Killers {
    fn default() -> Self {
        Self {
            table: [[None; 2]; MAX_PLY + 1],
        }
    }
}

impl Killers {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    /// 0 for the first killer, 1 for the second, None otherwise.
    #[inline]
    pub fn slot(&self, ply: usize, mv: Move) -> Option<usize> {
        self.table[ply].iter().position(|&k| k == Some(mv))
    }

    #[inline]
    pub fn push(&mut self, ply: usize, mv: Move) {
        let slots = &mut self.table[ply];
        if slots[0] != Some(mv) {
            slots[1] = slots[0];
            slots[0] = Some(mv);
        }
    }
}
// @end killers

// @block history
/// Butterfly history: a score per side, from-square and to-square.
pub struct History {
    table: Box<[[[i32; 64]; 64]; 2]>,
}

impl Default for History {
    fn default() -> Self {
        Self {
            table: Box::new([[[0; 64]; 64]; 2]),
        }
    }
}

impl History {
    /// Scores saturate towards this value.
    pub const MAX: i32 = 16_384;

    pub fn clear(&mut self) {
        self.table.iter_mut().flatten().for_each(|row| row.fill(0));
    }

    #[inline]
    pub fn get(&self, color: Color, mv: Move) -> i32 {
        self.table[color as usize][mv.from as usize][mv.to as usize]
    }

    /// Adds `bonus` (negative for a malus) with gravity so scores stay bounded.
    #[inline]
    pub fn update(&mut self, color: Color, mv: Move, bonus: i32) {
        let bonus = bonus.clamp(-Self::MAX, Self::MAX);
        let entry = &mut self.table[color as usize][mv.from as usize][mv.to as usize];
        *entry += bonus - *entry * bonus.abs() / Self::MAX;
    }
}
// @end history

// @hook search_helpers
