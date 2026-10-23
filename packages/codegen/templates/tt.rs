// @block transposition_table
//! Transposition table (the "Transposition table" block).

use cozy_chess::Move;

use crate::score::MATE_BOUND;

// @block tt_move_ordering|use_tt_move
use cozy_chess::{Piece, Square};
// @end tt_move_ordering|use_tt_move

/// What a stored score says about the true score.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum Bound {
    #[default]
    None,
    /// The true score equals the stored score.
    Exact,
    /// The true score is at least the stored score (beta cutoff).
    Lower,
    /// The true score is at most the stored score (fail low).
    Upper,
}

/// One stored search result.
#[derive(Clone, Copy, Debug, Default)]
pub struct TtEntry {
    key: u32,
    mv: u16,
    /// Score as stored; convert with [`score_from_tt`].
    pub score: i16,
    pub depth: u8,
    pub bound: Bound,
}

impl TtEntry {
    // @block tt_move_ordering|use_tt_move
    /// The best move found, if any.
    pub fn mv(&self) -> Option<Move> {
        unpack_move(self.mv)
    }
    // @end tt_move_ordering|use_tt_move

    /// True when the stored bound proves a cutoff for this window.
    pub fn cuts(&self, score: i32, alpha: i32, beta: i32) -> bool {
        match self.bound {
            Bound::Exact => true,
            Bound::Lower => score >= beta,
            Bound::Upper => score <= alpha,
            Bound::None => false,
        }
    }
}

pub struct TranspositionTable {
    entries: Vec<TtEntry>,
}

impl TranspositionTable {
    pub fn new(mb: usize) -> Self {
        let mut tt = Self {
            entries: Vec::new(),
        };
        tt.resize(mb);
        tt
    }

    /// Reallocates to `mb` megabytes and clears.
    pub fn resize(&mut self, mb: usize) {
        let len = (mb.max(1) * 1024 * 1024 / std::mem::size_of::<TtEntry>()).max(1);
        self.entries = vec![TtEntry::default(); len];
    }

    pub fn clear(&mut self) {
        self.entries.fill(TtEntry::default());
    }

    #[inline]
    fn index(&self, hash: u64) -> usize {
        ((hash as u128 * self.entries.len() as u128) >> 64) as usize
    }

    #[inline]
    pub fn probe(&self, hash: u64) -> Option<TtEntry> {
        let entry = self.entries[self.index(hash)];
        (entry.bound != Bound::None && entry.key == (hash >> 32) as u32).then_some(entry)
    }

    /// Stores a result. `score` must already be converted with [`score_to_tt`].
    #[inline]
    pub fn store(&mut self, hash: u64, mv: Option<Move>, score: i32, depth: i32, bound: Bound) {
        let index = self.index(hash);
        let key = (hash >> 32) as u32;
        let old = self.entries[index];
        let same = old.key == key && old.bound != Bound::None;
        if same && bound != Bound::Exact && depth + 4 < old.depth as i32 {
            return;
        }
        let mv = match mv {
            Some(mv) => pack_move(mv),
            None if same => old.mv,
            None => 0,
        };
        self.entries[index] = TtEntry {
            key,
            mv,
            score: score as i16,
            depth: depth.clamp(0, 255) as u8,
            bound,
        };
    }

    /// Permille of the first 1000 slots in use, for `info hashfull`.
    pub fn hashfull(&self) -> usize {
        let n = self.entries.len().min(1000);
        let used = self.entries[..n]
            .iter()
            .filter(|e| e.bound != Bound::None)
            .count();
        used * 1000 / n.max(1)
    }
}

/// Mate scores are stored relative to the node, not the root.
#[inline]
pub fn score_to_tt(score: i32, ply: usize) -> i32 {
    if score >= MATE_BOUND {
        score + ply as i32
    } else if score <= -MATE_BOUND {
        score - ply as i32
    } else {
        score
    }
}

/// Inverse of [`score_to_tt`].
#[inline]
pub fn score_from_tt(score: i16, ply: usize) -> i32 {
    let score = score as i32;
    if score >= MATE_BOUND {
        score - ply as i32
    } else if score <= -MATE_BOUND {
        score + ply as i32
    } else {
        score
    }
}

fn pack_move(mv: Move) -> u16 {
    let promo = mv.promotion.map_or(0, |p| p as u16 + 1);
    mv.from as u16 | (mv.to as u16) << 6 | promo << 12
}

// @block tt_move_ordering|use_tt_move
fn unpack_move(packed: u16) -> Option<Move> {
    if packed == 0 {
        return None;
    }
    let promo = (packed >> 12) as usize;
    Some(Move {
        from: Square::index((packed & 63) as usize),
        to: Square::index((packed >> 6 & 63) as usize),
        promotion: (promo > 0).then(|| Piece::index(promo - 1)),
    })
}
// @end tt_move_ordering|use_tt_move

// @block tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn move_packing_round_trips() {
        for s in ["e2e4", "a7a8q", "h2h1n", "e1h1"] {
            let mv: Move = s.parse().unwrap();
            assert_eq!(unpack_move(pack_move(mv)), Some(mv));
        }
    }

    #[test]
    fn store_and_probe() {
        let mut tt = TranspositionTable::new(1);
        let hash = 0xDEAD_BEEF_1234_5678;
        assert!(tt.probe(hash).is_none());
        let mv: Move = "e2e4".parse().unwrap();
        tt.store(hash, Some(mv), 42, 5, Bound::Exact);
        let e = tt.probe(hash).unwrap();
        assert_eq!(e.mv(), Some(mv));
        assert_eq!(e.score, 42);
        assert_eq!(e.depth, 5);
    }

    #[test]
    fn mate_score_adjustment() {
        let s = crate::score::MATE - 10;
        assert_eq!(score_from_tt(score_to_tt(s, 4) as i16, 4), s);
    }
}
// @end tests
// @end transposition_table
