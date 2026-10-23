// @block random_mover
//! Random mover: plays a random legal move. The simplest engine there is,
//! and a good first opponent: everything else should beat it.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use cozy_chess::Move;

use crate::params::*;
use crate::position::Position;
use crate::time::TimeManager;
use crate::uci::{Engine, SearchResult};

/// The engine: just a random number generator.
pub struct Searcher {
    rng: u64, // state of the random number generator
}

// The interface the UCI loop talks to: name, author, setup and searching.
impl Engine for Searcher {
    const NAME: &'static str = ENGINE_NAME;
    const AUTHOR: &'static str = ENGINE_AUTHOR;
    const BENCH_DEPTH: i32 = ENGINE_BENCH_DEPTH;

    /// Creates the engine once, seeding the random numbers from the clock.
    fn new() -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);
        Self { rng: seed | 1 }
    }

    /// Called on `ucinewgame`: nothing to forget.
    fn new_game(&mut self) {}

    /// Called by the UCI loop on `go`: picks one of the legal moves at random.
    fn search(
        &mut self,
        pos: &Position,
        _tm: TimeManager,
        _stop: Arc<AtomicBool>,
        _verbose: bool,
    ) -> SearchResult {
        let mut moves: Vec<Move> = Vec::new();
        pos.board().generate_moves(|list| {
            moves.extend(list);
            false
        });
        let best_move = if moves.is_empty() {
            None
        } else {
            Some(moves[(self.next() % moves.len() as u64) as usize])
        };
        SearchResult {
            best_move,
            nodes: 1,
        }
    }
}

impl Searcher {
    /// The next random number (xorshift64).
    fn next(&mut self) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng
    }
}
// @end random_mover
