//! Runtime library shared by every engine exported from Chess From Scratch.
//!
//! Sprint 0 only exposes the board re-export and a perft helper so CI can
//! prove move generation works. UCI, time management, the transposition
//! table and `bench` arrive in Sprint 1.

pub use cozy_chess as chess;

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
}
