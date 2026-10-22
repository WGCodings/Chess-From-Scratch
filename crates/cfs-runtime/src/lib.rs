//! Runtime library shared by every engine exported from Chess From Scratch.
//!
//! The generated engine code (search, eval, parameters) is small and readable
//! because everything that is not a "block" lives here: the board (via
//! cozy-chess), the UCI loop, time management, the transposition table,
//! move-ordering tables, evaluation helpers and the `bench` command.

pub use cozy_chess as chess;

pub mod bench;
pub mod eval;
pub mod moves;
pub mod position;
pub mod score;
pub mod time;
pub mod tt;
pub mod uci;

pub use position::Position;
pub use score::*;
pub use time::{Limits, TimeManager, TimeParams};
pub use tt::{Bound, TranspositionTable, TtEntry};
pub use uci::{Engine, SearchResult};

use cozy_chess::Board;

/// Counts leaf nodes of the legal move tree to `depth`.
pub fn perft(board: &Board, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let mut nodes = 0;
    board.generate_moves(|moves| {
        if depth == 1 {
            nodes += moves.len() as u64;
        } else {
            for mv in moves {
                let mut child = board.clone();
                child.play_unchecked(mv);
                nodes += perft(&child, depth - 1);
            }
        }
        false
    });
    nodes
}

/// Entry point for an exported engine's `main`: runs `bench` when asked on
/// the command line (as OpenBench does), otherwise the UCI loop.
pub fn main<E: Engine>() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("bench") {
        let depth = args.get(1).and_then(|d| d.parse().ok());
        bench::run::<E>(depth);
    } else {
        uci::run::<E>();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perft_startpos() {
        let board = Board::default();
        assert_eq!(perft(&board, 1), 20);
        assert_eq!(perft(&board, 2), 400);
        assert_eq!(perft(&board, 3), 8_902);
        assert_eq!(perft(&board, 4), 197_281);
    }

    #[test]
    fn perft_kiwipete() {
        let board: Board = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
            .parse()
            .unwrap();
        assert_eq!(perft(&board, 1), 48);
        assert_eq!(perft(&board, 2), 2_039);
        assert_eq!(perft(&board, 3), 97_862);
    }

    #[test]
    fn perft_tricky_positions() {
        let cases = [
            ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 5, 674_624),
            (
                "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
                4,
                422_333,
            ),
            (
                "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
                4,
                2_103_487,
            ),
        ];
        for (fen, depth, expected) in cases {
            let board: Board = fen.parse().unwrap();
            assert_eq!(perft(&board, depth), expected, "{fen}");
        }
    }
}
