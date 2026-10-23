// @block engine
// A chess engine built with Chess From Scratch.
//
// Your engine:
//   search.rs    the search and the search blocks you placed
// @block file_eval
//   eval.rs      the evaluation terms you placed
// @end file_eval
// @block file_psqt
//   psqt.rs      your piece-square tables
// @end file_psqt
//   params.rs    every block parameter, ready to tune
//
// The machinery around it (yours to change too):
//   uci.rs       talks to chess GUIs (UCI protocol)
//   position.rs  the board plus history for repetition detection
//   time.rs      decides how long to think
//   moves.rs     move lists and the principal variation
//   score.rs     score constants and info output
//   bench.rs     the `bench` command
// @block file_tt
//   tt.rs        the transposition table
// @end file_tt

// The files (modules) the engine is made of.
mod bench;
// @block file_eval
mod eval;
// @end file_eval
mod moves;
mod params;
mod position;
// @block file_psqt
mod psqt;
// @end file_psqt
mod score;
mod search;
mod time;
// @block file_tt
mod tt;
// @end file_tt
mod uci;

// Start: run `bench` when asked on the command line (OpenBench does this), otherwise talk UCI.
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("bench") {
        let depth = args.get(1).and_then(|d| d.parse().ok());
        bench::run::<search::Searcher>(depth);
    } else {
        uci::run::<search::Searcher>();
    }
}
// @end engine
