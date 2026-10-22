//! `bench`: searches a fixed set of positions to a fixed depth and prints
//! the total node count and speed. The node count is the engine's
//! fingerprint (OpenBench uses it to verify builds), so it must be
//! deterministic.

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use crate::position::Position;
use crate::time::TimeManager;
use crate::uci::Engine;

/// Depth used when `bench` is run without an argument.
pub const DEFAULT_DEPTH: i32 = 8;

pub const POSITIONS: [&str; 16] = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3",
    "r1bq1rk1/pp2bppp/2n1pn2/2pp4/3P4/2PBPN2/PP1N1PPP/R1BQ1RK1 w - - 0 8",
    "2r3k1/pp3ppp/4p3/3pP3/3P4/P1R5/1P3PPP/6K1 w - - 0 25",
    "8/8/4k3/3p4/3P4/4K3/8/8 w - - 0 1",
    "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1",
    "r2q1rk1/ppp2ppp/2n1bn2/2bpp3/4P3/2PP1NP1/PP1N1PBP/R1BQ1RK1 w - - 0 8",
    "4rrk1/pp1n3p/3q2pQ/2p1pb2/2PP4/2P3N1/P2B2PP/4RRK1 b - - 7 19",
    "3r1rk1/p5pp/bpp1pp2/8/q1PP1P2/b3P3/P2NQRPP/1R2B1K1 b - - 6 22",
    "8/5pk1/6p1/4P2p/7P/5PK1/8/8 b - - 0 40",
    "1r6/5k2/8/8/8/8/2K5/7R w - - 0 60",
];

/// Runs the benchmark and prints `<nodes> nodes <nps> nps`.
/// Returns the total node count.
pub fn run<E: Engine>(depth: Option<i32>) -> u64 {
    let depth = depth.unwrap_or(DEFAULT_DEPTH);
    let mut engine = E::new();
    let stop = Arc::new(AtomicBool::new(false));
    let start = Instant::now();
    let mut total = 0;
    for fen in POSITIONS {
        let pos = Position::from_fen(fen).expect("bench FEN is valid");
        engine.new_game();
        let result = engine.search(
            &pos,
            TimeManager::fixed_depth(depth),
            Arc::clone(&stop),
            false,
        );
        total += result.nodes;
    }
    let ms = start.elapsed().as_millis().max(1) as u64;
    println!("{total} nodes {} nps", total * 1000 / ms);
    total
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bench_positions_parse() {
        for fen in POSITIONS {
            assert!(Position::from_fen(fen).is_ok(), "{fen}");
        }
    }
}
