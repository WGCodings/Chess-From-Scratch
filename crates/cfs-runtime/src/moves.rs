//! Move lists and the tables used by move-ordering blocks:
//! MVV-LVA, killer moves, history heuristic and the PV table.

use cozy_chess::{Board, Color, Move, Piece, Square};

use crate::score::MAX_PLY;

/// Maximum number of legal moves in any chess position.
pub const MAX_MOVES: usize = 218;

/// A fixed-capacity list of moves with an ordering score per move.
pub struct MoveList {
    moves: [Move; MAX_MOVES],
    scores: [i32; MAX_MOVES],
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
            scores: [0; MAX_MOVES],
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

    #[inline]
    pub fn push(&mut self, mv: Move) {
        self.moves[self.len] = mv;
        self.scores[self.len] = 0;
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
}

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

/// True for moves that are neither captures nor promotions.
#[inline]
pub fn is_quiet(board: &Board, mv: Move) -> bool {
    mv.promotion.is_none() && !is_capture(board, mv)
}

/// Most Valuable Victim, Least Valuable Attacker: higher is better.
#[inline]
pub fn mvv_lva(board: &Board, mv: Move) -> i32 {
    const VALUE: [i32; 6] = [1, 3, 3, 5, 9, 0];
    let victim = board.piece_on(mv.to).unwrap_or(Piece::Pawn);
    let attacker = board.piece_on(mv.from).unwrap_or(Piece::Pawn);
    VALUE[victim as usize] * 16 - VALUE[attacker as usize]
}

/// True when `color` has a knight, bishop, rook or queen (null-move safety).
#[inline]
pub fn has_non_pawn_material(board: &Board, color: Color) -> bool {
    let pawns_and_king = board.pieces(Piece::Pawn) | board.pieces(Piece::King);
    !(board.colors(color) & !pawns_and_king).is_empty()
}

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
