// CFS Reference: built with Chess From Scratch.
//
// Your engine:
//   search.rs    the negamax skeleton and the search blocks you placed
//   eval.rs      the evaluation terms you placed
//   params.rs    every block parameter, ready to tune
//
// The machinery around it (yours to change too):
//   uci.rs       talks to chess GUIs (UCI protocol)
//   position.rs  the board plus history for repetition detection
//   time.rs      decides how long to think
//   moves.rs     move lists and the principal variation
//   score.rs     score constants and info output
//   bench.rs     the `bench` command
//   tt.rs        the transposition table

// The files (modules) the engine is made of.
mod bench;
mod eval;
mod moves;
mod params;
mod position;
mod score;
mod search;
mod time;
mod tt;
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
