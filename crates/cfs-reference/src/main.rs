//! Reference engine placeholder. The full engine (negamax, QS, TT, NMP, RFP,
//! LMR, PVS, aspiration windows, HCE) is built in Sprint 1.

use cfs_runtime::{chess::Board, perft};

fn main() {
    let depth = std::env::args()
        .nth(1)
        .and_then(|d| d.parse().ok())
        .unwrap_or(5);
    let board = Board::default();
    let start = std::time::Instant::now();
    let nodes = perft(&board, depth);
    let secs = start.elapsed().as_secs_f64().max(1e-9);
    println!(
        "perft {depth}: {nodes} nodes, {:.0} nps",
        nodes as f64 / secs
    );
}
