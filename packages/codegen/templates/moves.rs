//! Move lists, capture detection and the principal-variation table.

use cozy_chess::{Board, Move, Square};

use crate::score::MAX_PLY;

// @block mvv_lva|quiescence|killers|history|late_move_reductions|use_is_capture|use_quiet
use cozy_chess::Piece;
// @end mvv_lva|quiescence|killers|history|late_move_reductions|use_is_capture|use_quiet

/// Maximum number of legal moves in any chess position.
pub const MAX_MOVES: usize = 218;

/// A fixed-capacity list of legal moves (with an ordering score per move when moves are
/// ordered).
pub struct MoveList {
    moves: [Move; MAX_MOVES],
    // @block tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
    scores: [i32; MAX_MOVES],
    // @end tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
    len: usize,
}

impl Default for MoveList {
    fn default() -> Self {
        Self::new()
    }
}

impl MoveList {
    pub fn new() -> Self {
        const NULL: Move = Move {
            from: Square::A1,
            to: Square::A1,
            promotion: None,
        };
        Self {
            moves: [NULL; MAX_MOVES],
            // @block tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
            scores: [0; MAX_MOVES],
            // @end tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
            len: 0,
        }
    }

    /// All legal moves.
    pub fn all(board: &Board) -> Self {
        let mut list = Self::new();
        board.generate_moves(|moves| {
            for mv in moves {
                list.push(mv);
            }
            false
        });
        list
    }

    // @block quiescence
    // Quiescence search only looks at captures, so it needs a capture-only list.
    /// Legal captures (including en passant and capturing promotions).
    pub fn captures(board: &Board) -> Self {
        let mut list = Self::new();
        let enemies = board.colors(!board.side_to_move());
        board.generate_moves(|moves| {
            for mv in moves {
                if enemies.has(mv.to) || is_en_passant(board, mv) {
                    list.push(mv);
                }
            }
            false
        });
        list
    }
    // @end quiescence

    #[inline]
    pub fn push(&mut self, mv: Move) {
        self.moves[self.len] = mv;
        // @block tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
        self.scores[self.len] = 0;
        // @end tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
        self.len += 1;
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    #[inline]
    pub fn get(&self, i: usize) -> Move {
        self.moves[i]
    }

    // @block tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
    #[inline]
    pub fn set_score(&mut self, i: usize, score: i32) {
        self.scores[i] = score;
    }

    /// Selection sort step: moves the best-scored move among `i..` to `i`
    /// and returns it.
    #[inline]
    pub fn pick(&mut self, i: usize) -> Move {
        let mut best = i;
        for j in i + 1..self.len {
            if self.scores[j] > self.scores[best] {
                best = j;
            }
        }
        self.moves.swap(i, best);
        self.scores.swap(i, best);
        self.moves[i]
    }
    // @end tt_move_ordering|mvv_lva|killers|history|quiescence|slot_ordering
}

// @block mvv_lva|quiescence|killers|history|late_move_reductions|use_is_capture|use_quiet
#[inline]
fn is_en_passant(board: &Board, mv: Move) -> bool {
    board.piece_on(mv.from) == Some(Piece::Pawn)
        && mv.from.file() != mv.to.file()
        && board.piece_on(mv.to).is_none()
}

/// True when the move captures a piece (castling is never a capture).
#[inline]
pub fn is_capture(board: &Board, mv: Move) -> bool {
    board.colors(!board.side_to_move()).has(mv.to) || is_en_passant(board, mv)
}
// @end mvv_lva|quiescence|killers|history|late_move_reductions|use_is_capture|use_quiet

// @block killers|history|late_move_reductions|use_quiet
/// True for moves that are neither captures nor promotions.
#[inline]
pub fn is_quiet(board: &Board, mv: Move) -> bool {
    mv.promotion.is_none() && !is_capture(board, mv)
}
// @end killers|history|late_move_reductions|use_quiet

/// Triangular principal-variation table.
pub struct PvTable {
    lines: Box<[[Option<Move>; MAX_PLY + 1]; MAX_PLY + 1]>,
    len: [usize; MAX_PLY + 1],
}

impl Default for PvTable {
    fn default() -> Self {
        Self {
            lines: Box::new([[None; MAX_PLY + 1]; MAX_PLY + 1]),
            len: [0; MAX_PLY + 1],
        }
    }
}

impl PvTable {
    /// Call on entering a node at `ply`.
    #[inline]
    pub fn clear(&mut self, ply: usize) {
        self.len[ply] = 0;
    }

    /// `mv` is the new best move at `ply`; the child's line follows it.
    #[inline]
    pub fn update(&mut self, ply: usize, mv: Move) {
        let child = self.len[ply + 1].min(MAX_PLY - ply);
        self.lines[ply][0] = Some(mv);
        for i in 0..child {
            self.lines[ply][i + 1] = self.lines[ply + 1][i];
        }
        self.len[ply] = child + 1;
    }

    /// The principal variation from the root.
    pub fn root_line(&self) -> Vec<Move> {
        self.lines[0][..self.len[0]]
            .iter()
            .flatten()
            .copied()
            .collect()
    }
}

// @block tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_are_a_subset() {
        let board: Board = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
            .parse()
            .unwrap();
        let all = MoveList::all(&board);
        let caps = MoveList::captures(&board);
        assert_eq!(all.len(), 48);
        assert_eq!(caps.len(), 8);
    }

    #[test]
    fn castling_is_not_a_capture() {
        let board: Board = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1".parse().unwrap();
        let castle: Move = "e1h1".parse().unwrap();
        assert!(board.is_legal(castle));
        assert!(!is_capture(&board, castle));
    }

    #[test]
    fn pick_orders_by_score() {
        let board = Board::default();
        let mut list = MoveList::all(&board);
        for i in 0..list.len() {
            list.set_score(i, i as i32);
        }
        let last = list.get(list.len() - 1);
        assert_eq!(list.pick(0), last);
    }
}
// @end tests
