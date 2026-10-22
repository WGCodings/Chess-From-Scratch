//! ---
//! id: tempo
//! label: Tempo bonus
//! slot: eval
//! description: A small bonus for the side to move.
//! info: Having the move is worth something: the side to move can improve its position first. A tempo bonus also smooths the evaluation between odd and even search depths. This block shows the advanced sections: it adds its own file (src/tempo.rs), inserts a line into an existing function and adds the term at a hook.
//! cpw: https://www.chessprogramming.org/Tempo
//! params:
//!   TEMPO: S = S(15, 5) "Bonus"
//! ---

// @file src/tempo.rs
//! The tempo bonus (the "Tempo bonus" block).

use cozy_chess::{Board, Color};

use crate::eval::S;
use crate::params::TEMPO;

/// The tempo bonus from White's point of view.
pub fn tempo(board: &Board) -> S {
    if board.side_to_move() == Color::White {
        TEMPO
    } else {
        -TEMPO
    }
}

// @insert eval.rs after "pub fn evaluate(board: &Board) -> i32 {"
// Tempo: the side to move gets a small bonus.
let tempo = crate::tempo::tempo(board);

// @hook eval
score += tempo;
