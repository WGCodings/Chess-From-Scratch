//! Hand-crafted evaluation: the sum of the placed terms, tapered by phase.

#![allow(unused_imports, unused_mut)]

use crate::params::*;
use cfs_runtime::chess::{Board, Color};
use cfs_runtime::eval::{self, S};

/// Static evaluation in centipawns from the side to move's point of view.
pub fn evaluate(board: &Board) -> i32 {
    let mut score = S::default();

    // @block eval_pesto
    score += eval::pesto(board);
    // @end eval_pesto

    // @block eval_mobility
    score += eval::mobility(board, MOBILITY);
    // @end eval_mobility

    // @block eval_bishop_pair
    score += eval::bishop_pair(board, BISHOP_PAIR);
    // @end eval_bishop_pair

    // @block eval_rook_files
    score += eval::rook_files(board, ROOK_OPEN_FILE, ROOK_HALF_OPEN_FILE);
    // @end eval_rook_files

    // @block eval_passed_pawns
    score += eval::passed_pawns(board, PASSED_PAWN);
    // @end eval_passed_pawns

    let white = eval::taper(score, eval::phase(board));
    match board.side_to_move() {
        Color::White => white,
        Color::Black => -white,
    }
}
