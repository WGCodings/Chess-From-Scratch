//! Building blocks for hand-crafted evaluation.
//!
//! Every term returns a middlegame/endgame pair [`S`] from White's point of
//! view. The generated `eval.rs` adds up the terms the user placed, tapers by
//! game phase and flips the sign for Black.

use std::ops::{Add, AddAssign, Mul, Neg, Sub, SubAssign};

use cozy_chess::{
    get_bishop_moves, get_knight_moves, get_pawn_attacks, get_rook_moves, BitBoard, Board, Color,
    Piece, Rank, Square,
};

/// A (middlegame, endgame) score pair.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct S(pub i32, pub i32);

impl Add for S {
    type Output = S;
    #[inline]
    fn add(self, o: S) -> S {
        S(self.0 + o.0, self.1 + o.1)
    }
}
impl AddAssign for S {
    #[inline]
    fn add_assign(&mut self, o: S) {
        *self = *self + o;
    }
}
impl Sub for S {
    type Output = S;
    #[inline]
    fn sub(self, o: S) -> S {
        S(self.0 - o.0, self.1 - o.1)
    }
}
impl SubAssign for S {
    #[inline]
    fn sub_assign(&mut self, o: S) {
        *self = *self - o;
    }
}
impl Neg for S {
    type Output = S;
    #[inline]
    fn neg(self) -> S {
        S(-self.0, -self.1)
    }
}
impl Mul<i32> for S {
    type Output = S;
    #[inline]
    fn mul(self, k: i32) -> S {
        S(self.0 * k, self.1 * k)
    }
}

/// Phase weights per piece; 24 is a full middlegame, 0 a pawn endgame.
pub const PHASE_MAX: i32 = 24;
const PHASE_WEIGHT: [i32; 6] = [0, 1, 1, 2, 4, 0];

/// Game phase from 0 (endgame) to [`PHASE_MAX`] (opening).
#[inline]
pub fn phase(board: &Board) -> i32 {
    Piece::ALL
        .iter()
        .map(|&p| board.pieces(p).len() as i32 * PHASE_WEIGHT[p as usize])
        .sum::<i32>()
        .min(PHASE_MAX)
}

/// Blends middlegame and endgame scores by phase.
#[inline]
pub fn taper(score: S, phase: i32) -> i32 {
    (score.0 * phase + score.1 * (PHASE_MAX - phase)) / PHASE_MAX
}

/// Sums `term(color)` for White minus the same for Black.
#[inline]
fn both(mut term: impl FnMut(Color) -> S) -> S {
    term(Color::White) - term(Color::Black)
}

// ---------------------------------------------------------------------------
// PeSTO material and piece-square tables (Ronald Friederich, via the Chess
// Programming Wiki). Tables are written from rank 8 down to rank 1, so a
// White piece on square `sq` reads index `sq ^ 56`.
// ---------------------------------------------------------------------------

const PESTO_MATERIAL: [S; 6] = [
    S(82, 94),
    S(337, 281),
    S(365, 297),
    S(477, 512),
    S(1025, 936),
    S(0, 0),
];

#[rustfmt::skip]
const MG_PST: [[i32; 64]; 6] = [
    [
          0,   0,   0,   0,   0,   0,  0,   0,
         98, 134,  61,  95,  68, 126, 34, -11,
         -6,   7,  26,  31,  65,  56, 25, -20,
        -14,  13,   6,  21,  23,  12, 17, -23,
        -27,  -2,  -5,  12,  17,   6, 10, -25,
        -26,  -4,  -4, -10,   3,   3, 33, -12,
        -35,  -1, -20, -23, -15,  24, 38, -22,
          0,   0,   0,   0,   0,   0,  0,   0,
    ],
    [
        -167, -89, -34, -49,  61, -97, -15, -107,
         -73, -41,  72,  36,  23,  62,   7,  -17,
         -47,  60,  37,  65,  84, 129,  73,   44,
          -9,  17,  19,  53,  37,  69,  18,   22,
         -13,   4,  16,  13,  28,  19,  21,   -8,
         -23,  -9,  12,  10,  19,  17,  25,  -16,
         -29, -53, -12,  -3,  -1,  18, -14,  -19,
        -105, -21, -58, -33, -17, -28, -19,  -23,
    ],
    [
        -29,   4, -82, -37, -25, -42,   7,  -8,
        -26,  16, -18, -13,  30,  59,  18, -47,
        -16,  37,  43,  40,  35,  50,  37,  -2,
         -4,   5,  19,  50,  37,  37,   7,  -2,
         -6,  13,  13,  26,  34,  12,  10,   4,
          0,  15,  15,  15,  14,  27,  18,  10,
          4,  15,  16,   0,   7,  21,  33,   1,
        -33,  -3, -14, -21, -13, -12, -39, -21,
    ],
    [
         32,  42,  32,  51, 63,  9,  31,  43,
         27,  32,  58,  62, 80, 67,  26,  44,
         -5,  19,  26,  36, 17, 45,  61,  16,
        -24, -11,   7,  26, 24, 35,  -8, -20,
        -36, -26, -12,  -1,  9, -7,   6, -23,
        -45, -25, -16, -17,  3,  0,  -5, -33,
        -44, -16, -20,  -9, -1, 11,  -6, -71,
        -19, -13,   1,  17, 16,  7, -37, -26,
    ],
    [
        -28,   0,  29,  12,  59,  44,  43,  45,
        -24, -39,  -5,   1, -16,  57,  28,  54,
        -13, -17,   7,   8,  29,  56,  47,  57,
        -27, -27, -16, -16,  -1,  17,  -2,   1,
         -9, -26,  -9, -10,  -2,  -4,   3,  -3,
        -14,   2, -11,  -2,  -5,   2,  14,   5,
        -35,  -8,  11,   2,   8,  15,  -3,   1,
         -1, -18,  -9,  10, -15, -25, -31, -50,
    ],
    [
        -65,  23,  16, -15, -56, -34,   2,  13,
         29,  -1, -20,  -7,  -8,  -4, -38, -29,
         -9,  24,   2, -16, -20,   6,  22, -22,
        -17, -20, -12, -27, -30, -25, -14, -36,
        -49,  -1, -27, -39, -46, -44, -33, -51,
        -14, -14, -22, -46, -44, -30, -15, -27,
          1,   7,  -8, -64, -43, -16,   9,   8,
        -15,  36,  12, -54,   8, -28,  24,  14,
    ],
];

#[rustfmt::skip]
const EG_PST: [[i32; 64]; 6] = [
    [
          0,   0,   0,   0,   0,   0,   0,   0,
        178, 173, 158, 134, 147, 132, 165, 187,
         94, 100,  85,  67,  56,  53,  82,  84,
         32,  24,  13,   5,  -2,   4,  17,  17,
         13,   9,  -3,  -7,  -7,  -8,   3,  -1,
          4,   7,  -6,   1,   0,  -5,  -1,  -8,
         13,   8,   8,  10,  13,   0,   2,  -7,
          0,   0,   0,   0,   0,   0,   0,   0,
    ],
    [
        -58, -38, -13, -28, -31, -27, -63, -99,
        -25,  -8, -25,  -2,  -9, -25, -24, -52,
        -24, -20,  10,   9,  -1,  -9, -19, -41,
        -17,   3,  22,  22,  22,  11,   8, -18,
        -18,  -6,  16,  25,  16,  17,   4, -18,
        -23,  -3,  -1,  15,  10,  -3, -20, -22,
        -42, -20, -10,  -5,  -2, -20, -23, -44,
        -29, -51, -23, -15, -22, -18, -50, -64,
    ],
    [
        -14, -21, -11,  -8, -7,  -9, -17, -24,
         -8,  -4,   7, -12, -3, -13,  -4, -14,
          2,  -8,   0,  -1, -2,   6,   0,   4,
         -3,   9,  12,   9, 14,  10,   3,   2,
         -6,   3,  13,  19,  7,  10,  -3,  -9,
        -12,  -3,   8,  10, 13,   3,  -7, -15,
        -14, -18,  -7,  -1,  4,  -9, -15, -27,
        -23,  -9, -23,  -5, -9, -16,  -5, -17,
    ],
    [
        13, 10, 18, 15, 12,  12,   8,   5,
        11, 13, 13, 11, -3,   3,   8,   3,
         7,  7,  7,  5,  4,  -3,  -5,  -3,
         4,  3, 13,  1,  2,   1,  -1,   2,
         3,  5,  8,  4, -5,  -6,  -8, -11,
        -4,  0, -5, -1, -7, -12,  -8, -16,
        -6, -6,  0,  2, -9,  -9, -11,  -3,
        -9,  2,  3, -1, -5, -13,   4, -20,
    ],
    [
         -9,  22,  22,  27,  27,  19,  10,  20,
        -17,  20,  32,  41,  58,  25,  30,   0,
        -20,   6,   9,  49,  47,  35,  19,   9,
          3,  22,  24,  45,  57,  40,  57,  36,
        -18,  28,  19,  47,  31,  34,  39,  23,
        -16, -27,  15,   6,   9,  17,  10,   5,
        -22, -23, -30, -16, -16, -23, -36, -32,
        -33, -28, -22, -43,  -5, -32, -20, -41,
    ],
    [
        -74, -35, -18, -18, -11,  15,   4, -17,
        -12,  17,  14,  17,  17,  38,  23,  11,
         10,  17,  23,  15,  20,  45,  44,  13,
         -8,  22,  24,  27,  26,  33,  26,   3,
        -18,  -4,  21,  24,  27,  23,   9, -11,
        -19,  -3,  11,  21,  23,  16,   7,  -9,
        -27, -11,   4,  13,  14,   4,  -5, -17,
        -53, -34, -21, -11, -28, -14, -24, -43,
    ],
];

/// Table index for a piece of `color` on `sq`.
#[inline]
fn pst_index(sq: Square, color: Color) -> usize {
    match color {
        Color::White => sq as usize ^ 56,
        Color::Black => sq as usize,
    }
}

/// PeSTO material plus piece-square tables.
pub fn pesto(board: &Board) -> S {
    both(|color| {
        let mut s = S::default();
        for piece in Piece::ALL {
            for sq in board.colored_pieces(color, piece) {
                let i = pst_index(sq, color);
                let p = piece as usize;
                s += PESTO_MATERIAL[p] + S(MG_PST[p][i], EG_PST[p][i]);
            }
        }
        s
    })
}

/// All squares attacked by `color`'s pawns.
#[inline]
pub fn pawn_attacks(board: &Board, color: Color) -> BitBoard {
    board
        .colored_pieces(color, Piece::Pawn)
        .iter()
        .fold(BitBoard::EMPTY, |acc, sq| acc | get_pawn_attacks(sq, color))
}

/// Mobility: per knight, bishop, rook and queen, `weights[piece]` times the
/// number of reachable squares not occupied by own pieces and not attacked
/// by enemy pawns.
pub fn mobility(board: &Board, weights: [S; 4]) -> S {
    let occupied = board.occupied();
    both(|color| {
        let safe = !board.colors(color) & !pawn_attacks(board, !color);
        let mut s = S::default();
        for sq in board.colored_pieces(color, Piece::Knight) {
            s += weights[0] * (get_knight_moves(sq) & safe).len() as i32;
        }
        for sq in board.colored_pieces(color, Piece::Bishop) {
            s += weights[1] * (get_bishop_moves(sq, occupied) & safe).len() as i32;
        }
        for sq in board.colored_pieces(color, Piece::Rook) {
            s += weights[2] * (get_rook_moves(sq, occupied) & safe).len() as i32;
        }
        for sq in board.colored_pieces(color, Piece::Queen) {
            let attacks = get_rook_moves(sq, occupied) | get_bishop_moves(sq, occupied);
            s += weights[3] * (attacks & safe).len() as i32;
        }
        s
    })
}

/// Bonus for owning two or more bishops.
pub fn bishop_pair(board: &Board, bonus: S) -> S {
    both(|color| {
        if board.colored_pieces(color, Piece::Bishop).len() >= 2 {
            bonus
        } else {
            S::default()
        }
    })
}

/// Rooks on files with no pawns (open) or no own pawns (half-open).
pub fn rook_files(board: &Board, open: S, half_open: S) -> S {
    let pawns = board.pieces(Piece::Pawn);
    both(|color| {
        let own_pawns = board.colored_pieces(color, Piece::Pawn);
        let mut s = S::default();
        for sq in board.colored_pieces(color, Piece::Rook) {
            let file = sq.file().bitboard();
            if (file & pawns).is_empty() {
                s += open;
            } else if (file & own_pawns).is_empty() {
                s += half_open;
            }
        }
        s
    })
}

/// Squares in front of `sq` (from `color`'s view) on its file and both
/// neighbouring files: where an enemy pawn would stop it from being passed.
fn passed_span(sq: Square, color: Color) -> BitBoard {
    let files = sq.file().bitboard() | sq.file().adjacent();
    let rank = sq.rank() as usize;
    let ahead = Rank::ALL
        .iter()
        .filter(|&&r| match color {
            Color::White => r as usize > rank,
            Color::Black => (r as usize) < rank,
        })
        .fold(BitBoard::EMPTY, |acc, &r| acc | r.bitboard());
    files & ahead
}

/// Passed pawns, scored by rank from the owner's side (`by_rank[0]` = rank 1).
pub fn passed_pawns(board: &Board, by_rank: [S; 8]) -> S {
    both(|color| {
        let enemy_pawns = board.colored_pieces(!color, Piece::Pawn);
        let mut s = S::default();
        for sq in board.colored_pieces(color, Piece::Pawn) {
            if (passed_span(sq, color) & enemy_pawns).is_empty() {
                s += by_rank[sq.rank().relative_to(color) as usize];
            }
        }
        s
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(fen: &str) -> Board {
        fen.parse().unwrap()
    }

    #[test]
    fn startpos_is_symmetric() {
        let b = Board::default();
        assert_eq!(pesto(&b), S(0, 0));
        assert_eq!(mobility(&b, [S(4, 4); 4]), S(0, 0));
        assert_eq!(phase(&b), PHASE_MAX);
    }

    #[test]
    fn mirrored_positions_negate() {
        let w = board("r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
        let b = board("rnbqk2r/pppp1ppp/5n2/2b1p3/4P3/2N2N2/PPPP1PPP/R1BQKB1R b KQkq - 4 4");
        assert_eq!(pesto(&w), -pesto(&b));
        assert_eq!(mobility(&w, [S(4, 4); 4]), -mobility(&b, [S(4, 4); 4]));
    }

    #[test]
    fn bishop_pair_counts() {
        let b = board("4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1");
        assert_eq!(bishop_pair(&b, S(30, 50)), S(30, 50));
    }

    #[test]
    fn passed_pawn_detection() {
        // White a5 is passed; white e4 is blocked by black d5's span? No: d5 guards e4's path.
        let b = board("4k3/8/8/P2p4/4P3/8/8/4K3 w - - 0 1");
        let mut by_rank = [S(0, 0); 8];
        by_rank[4] = S(10, 10); // rank 5
        by_rank[3] = S(100, 100); // rank 4 (e4) should not count
                                  // Black d5 is passed from Black's side only if no white pawn on c/d/e ahead of it:
                                  // e4 is on rank 4 (ahead for Black), so d5 is not passed.
        assert_eq!(passed_pawns(&b, by_rank), S(10, 10));
    }

    #[test]
    fn rook_file_bonuses() {
        let b = board("4k3/p7/8/8/8/8/1P6/R3K2R w - - 0 1");
        // a1 rook: a-file has a black pawn only -> half-open. h1 rook: open.
        assert_eq!(rook_files(&b, S(20, 10), S(10, 5)), S(30, 15));
    }
}
