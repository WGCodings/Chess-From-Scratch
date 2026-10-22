// CFS Reference: built with Chess From Scratch.
//
// search.rs  the negamax skeleton and the search blocks you placed
// eval.rs    the evaluation terms you placed
// params.rs  every block parameter, ready to tune

mod eval;
mod params;
mod search;

fn main() {
    cfs_runtime::main::<search::Searcher>();
}
