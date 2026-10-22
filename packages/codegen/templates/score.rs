//! Score constants and UCI `info` line formatting.

use std::time::Duration;

use cozy_chess::{util::display_uci_move, Board, Move};

/// Deepest ply the search may reach.
pub const MAX_PLY: usize = 128;
/// Larger than any real score.
pub const INF: i32 = 32_000;
/// Score of delivering mate right now; mate in n plies is `MATE - n`.
pub const MATE: i32 = 31_000;
/// Scores at or beyond this are mate scores.
pub const MATE_BOUND: i32 = MATE - MAX_PLY as i32;

/// Formats a score as UCI `cp <n>` or `mate <n>`.
pub fn uci_score(score: i32) -> String {
    if score >= MATE_BOUND {
        format!("mate {}", (MATE - score + 1) / 2)
    } else if score <= -MATE_BOUND {
        format!("mate -{}", (MATE + score + 1) / 2)
    } else {
        format!("cp {score}")
    }
}

/// Formats a principal variation in UCI notation, starting from `board`.
pub fn uci_pv(board: &Board, pv: &[Move]) -> String {
    let mut board = board.clone();
    let mut out = Vec::with_capacity(pv.len());
    for &mv in pv {
        if !board.is_legal(mv) {
            break;
        }
        out.push(display_uci_move(&board, mv).to_string());
        board.play_unchecked(mv);
    }
    out.join(" ")
}

/// Everything needed for one `info` line after a completed iteration.
pub struct IterationInfo<'a> {
    pub depth: i32,
    pub seldepth: usize,
    pub score: i32,
    pub nodes: u64,
    pub elapsed: Duration,
    pub hashfull: usize,
    pub pv: &'a [Move],
}

/// Prints a UCI `info` line.
pub fn print_info(board: &Board, info: &IterationInfo) {
    let ms = info.elapsed.as_millis().max(1) as u64;
    let nps = info.nodes * 1000 / ms;
    println!(
        "info depth {} seldepth {} score {} nodes {} nps {} hashfull {} time {} pv {}",
        info.depth,
        info.seldepth,
        uci_score(info.score),
        info.nodes,
        nps,
        info.hashfull,
        ms,
        uci_pv(board, info.pv)
    );
}

// @block tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mate_scores() {
        assert_eq!(uci_score(MATE - 1), "mate 1");
        assert_eq!(uci_score(MATE - 3), "mate 2");
        assert_eq!(uci_score(-(MATE - 2)), "mate -1");
        assert_eq!(uci_score(35), "cp 35");
    }
}
// @end tests
