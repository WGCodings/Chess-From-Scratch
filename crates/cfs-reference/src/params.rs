//! Every block parameter as a constant. Edit these to tune the engine.

#![allow(dead_code, unused_imports)]

use crate::eval::S;

// @block engine
pub const ENGINE_NAME: &str = "CFS Reference";
pub const ENGINE_AUTHOR: &str = "WG";
pub const ENGINE_BENCH_DEPTH: i32 = 5;
// @end engine

// @block time_management
pub const TM_MOVES_TO_GO: u64 = 25;
pub const TM_INC_PERCENT: u64 = 75;
pub const TM_HARD_MULTIPLIER: u64 = 3;
pub const TM_OVERHEAD_MS: u64 = 25;
// @end time_management

// @block transposition_table
pub const TT_HASH_MB: usize = 16;
// @end transposition_table

// @block aspiration_windows
pub const ASP_MIN_DEPTH: i32 = 4;
pub const ASP_DELTA: i32 = 25;
// @end aspiration_windows

// @block reverse_futility_pruning
pub const RFP_MAX_DEPTH: i32 = 6;
pub const RFP_MARGIN: i32 = 80;
// @end reverse_futility_pruning

// @block null_move_pruning
pub const NMP_MIN_DEPTH: i32 = 3;
pub const NMP_BASE_REDUCTION: i32 = 3;
pub const NMP_DEPTH_DIVISOR: i32 = 4;
// @end null_move_pruning

// @block history
pub const HISTORY_BONUS_MAX: i32 = 1200;
// @end history

// @block late_move_reductions
pub const LMR_MIN_DEPTH: i32 = 3;
pub const LMR_MIN_MOVES: usize = 3;
pub const LMR_MIN_MOVES_PV: usize = 4;
pub const LMR_BASE: f64 = 0.75;
pub const LMR_DIVISOR: f64 = 2.25;
// @end late_move_reductions

// @block eval_mobility
/// Per reachable safe square: knight, bishop, rook, queen.
pub const MOBILITY: [S; 4] = [S(4, 4), S(5, 5), S(2, 4), S(1, 2)];
// @end eval_mobility

// @block eval_bishop_pair
pub const BISHOP_PAIR: S = S(30, 50);
// @end eval_bishop_pair

// @block eval_rook_files
pub const ROOK_OPEN_FILE: S = S(25, 10);
pub const ROOK_HALF_OPEN_FILE: S = S(12, 8);
// @end eval_rook_files

// @block eval_passed_pawns
/// Indexed by rank from the pawn owner's side: rank 1 .. rank 8.
pub const PASSED_PAWN: [S; 8] = [
    S(0, 0),
    S(5, 10),
    S(10, 20),
    S(15, 35),
    S(30, 60),
    S(50, 100),
    S(80, 150),
    S(0, 0),
];
// @end eval_passed_pawns
