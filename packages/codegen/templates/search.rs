//! Negamax search skeleton. Each placed block sits between
//! `// @block <name>` and `// @end <name>` markers.

#![allow(
    unused_imports,
    unused_mut,
    unused_variables,
    unused_assignments,
    dead_code
)]

use crate::eval::evaluate;
use crate::params::*;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cfs_runtime::chess::Move;
use cfs_runtime::moves::{
    has_non_pawn_material, is_capture, is_quiet, mvv_lva, History, Killers, MoveList, PvTable,
};
use cfs_runtime::score::{print_info, IterationInfo, INF, MATE, MATE_BOUND, MAX_PLY};
use cfs_runtime::tt::{score_from_tt, score_to_tt, Bound, TranspositionTable};
use cfs_runtime::{Engine, Position, SearchResult, TimeManager, TimeParams};

pub struct Searcher {
    nodes: u64,
    seldepth: usize,
    stopped: bool,
    can_stop: bool,
    stop: Arc<AtomicBool>,
    tm: TimeManager,
    pv: PvTable,
    // @block transposition_table
    tt: TranspositionTable,
    // @end transposition_table
    // @block killers
    killers: Killers,
    // @end killers
    // @block history
    history: History,
    // @end history
    // @block late_move_reductions
    lmr: [[i32; 64]; 64],
    // @end late_move_reductions
}

impl Engine for Searcher {
    const NAME: &'static str = ENGINE_NAME;
    const AUTHOR: &'static str = ENGINE_AUTHOR;
    // @block transposition_table
    const DEFAULT_HASH_MB: usize = TT_HASH_MB;
    // @end transposition_table

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
            tt: TranspositionTable::new(TT_HASH_MB),
            // @end transposition_table
            // @block killers
            killers: Killers::default(),
            // @end killers
            // @block history
            history: History::default(),
            // @end history
            // @block late_move_reductions
            lmr: lmr_table(),
            // @end late_move_reductions
        }
    }

    fn new_game(&mut self) {
        // @block transposition_table
        self.tt.clear();
        // @end transposition_table
        // @block killers
        self.killers.clear();
        // @end killers
        // @block history
        self.history.clear();
        // @end history
    }

    fn set_hash(&mut self, mb: usize) {
        // @block transposition_table
        self.tt.resize(mb);
        // @end transposition_table
    }

    fn time_params() -> TimeParams {
        TimeParams {
            moves_to_go: TM_MOVES_TO_GO,
            inc_percent: TM_INC_PERCENT,
            hard_multiplier: TM_HARD_MULTIPLIER,
            overhead_ms: TM_OVERHEAD_MS,
        }
    }

    /// Iterative deepening: search depth 1, 2, 3, ... until time runs out.
    fn search(
        &mut self,
        pos: &Position,
        tm: TimeManager,
        stop: Arc<AtomicBool>,
        verbose: bool,
    ) -> SearchResult {
        self.nodes = 0;
        self.stopped = false;
        self.can_stop = false;
        self.stop = stop;
        self.tm = tm;
        // @block killers
        self.killers.clear();
        // @end killers

        let mut pos = pos.clone();
        let mut best_move = None;
        let mut score = 0;

        for depth in 1..=self.tm.max_depth {
            self.seldepth = 0;
            let new_score = self.search_root(&mut pos, depth, score);
            if self.stopped {
                break;
            }
            score = new_score;
            let line = self.pv.root_line();
            best_move = line.first().copied().or(best_move);
            self.can_stop = true;

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
            if self.tm.soft_stop(self.nodes) {
                break;
            }
        }

        SearchResult {
            best_move,
            nodes: self.nodes,
        }
    }
}

impl Searcher {
    fn hashfull(&self) -> usize {
        // @block transposition_table
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

    fn search_root(&mut self, pos: &mut Position, depth: i32, prev_score: i32) -> i32 {
        // @block aspiration_windows
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
        self.negamax(pos, depth, 0, -INF, INF)
    }

    fn negamax(
        &mut self,
        pos: &mut Position,
        depth: i32,
        ply: usize,
        mut alpha: i32,
        beta: i32,
    ) -> i32 {
        let pv_node = beta - alpha > 1;
        self.pv.clear(ply);

        if depth <= 0 {
            // @block quiescence
            return self.qsearch(pos, ply, alpha, beta);
            // @else
            return evaluate(pos.board());
            // @end quiescence
        }

        self.nodes += 1;
        self.check_stop();
        if self.stopped {
            return 0;
        }
        self.seldepth = self.seldepth.max(ply);
        if ply > 0 && pos.is_draw() {
            return 0;
        }
        if ply >= MAX_PLY - 1 {
            return evaluate(pos.board());
        }

        let board = pos.board().clone();
        let stm = board.side_to_move();
        let in_check = !board.checkers().is_empty();
        let mut tt_move: Option<Move> = None;

        // @block transposition_table
        if let Some(entry) = self.tt.probe(board.hash()) {
            tt_move = entry.mv();
            let tt_score = score_from_tt(entry.score, ply);
            if !pv_node && entry.depth as i32 >= depth && entry.cuts(tt_score, alpha, beta) {
                return tt_score;
            }
        }
        // @end transposition_table

        let static_eval = if in_check { -INF } else { evaluate(&board) };

        // @block reverse_futility_pruning
        if !pv_node
            && !in_check
            && depth <= RFP_MAX_DEPTH
            && static_eval - RFP_MARGIN * depth >= beta
        {
            return static_eval;
        }
        // @end reverse_futility_pruning

        // @block null_move_pruning
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

        let mut moves = MoveList::all(&board);
        if moves.is_empty() {
            return if in_check { -MATE + ply as i32 } else { 0 };
        }

        for i in 0..moves.len() {
            let mv = moves.get(i);
            let mut order = 0;
            // @block tt_move_ordering
            if Some(mv) == tt_move {
                order = 1_000_000;
            }
            // @end tt_move_ordering
            // @block mvv_lva
            if order == 0 && is_capture(&board, mv) {
                order = 100_000 + mvv_lva(&board, mv);
            }
            // @end mvv_lva
            // @block killers
            if order == 0 {
                match self.killers.slot(ply, mv) {
                    Some(0) => order = 90_000,
                    Some(_) => order = 80_000,
                    None => {}
                }
            }
            // @end killers
            // @block history
            if order == 0 {
                order = self.history.get(stm, mv);
            }
            // @end history
            moves.set_score(i, order);
        }

        let original_alpha = alpha;
        let mut best_score = -INF;
        let mut best_move = None;
        let mut quiets_tried = MoveList::new();

        for i in 0..moves.len() {
            let mv = moves.pick(i);
            let quiet = is_quiet(&board, mv);
            pos.make_move(mv);
            let new_depth = depth - 1;
            let mut score;

            if i == 0 {
                score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
            } else {
                let mut r = 0;
                // @block late_move_reductions
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
                score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);
                if score > alpha && r > 0 {
                    score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);
                }
                if score > alpha && score < beta {
                    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
                }
                // @else
                score = -self.negamax(pos, new_depth - r, ply + 1, -beta, -alpha);
                if score > alpha && r > 0 {
                    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
                }
                // @end principal_variation_search
            }
            pos.unmake();

            if self.stopped {
                return 0;
            }

            if score > best_score {
                best_score = score;
                if score > alpha {
                    alpha = score;
                    best_move = Some(mv);
                    self.pv.update(ply, mv);
                    if score >= beta {
                        // @block killers
                        if quiet {
                            self.killers.push(ply, mv);
                        }
                        // @end killers
                        // @block history
                        if quiet {
                            let bonus = (depth * depth).min(HISTORY_BONUS_MAX);
                            self.history.update(stm, mv, bonus);
                            for j in 0..quiets_tried.len() {
                                self.history.update(stm, quiets_tried.get(j), -bonus);
                            }
                        }
                        // @end history
                        break;
                    }
                }
            }
            if quiet {
                quiets_tried.push(mv);
            }
        }

        // @block transposition_table
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
