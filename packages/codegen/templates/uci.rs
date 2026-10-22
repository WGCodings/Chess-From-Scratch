//! The UCI protocol loop. The search runs on its own thread so `stop`,
//! `isready` and `quit` are answered while it thinks.

use std::io::{self, BufRead};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Instant;

use cozy_chess::util::{display_uci_move, parse_uci_move};
use cozy_chess::{Board, Move};

use crate::moves::MoveList;
use crate::position::Position;
use crate::time::{Limits, TimeManager, TimeParams};

/// What a finished search returns.
#[derive(Clone, Copy, Debug, Default)]
pub struct SearchResult {
    pub best_move: Option<Move>,
    pub nodes: u64,
}

/// Implemented by the generated engine code.
pub trait Engine: Send + Sized + 'static {
    const NAME: &'static str;
    const AUTHOR: &'static str;
    // @block transposition_table
    const DEFAULT_HASH_MB: usize = 16;
    // @end transposition_table
    /// Depth used by `bench` when no depth is given.
    const BENCH_DEPTH: i32 = crate::bench::DEFAULT_DEPTH;

    fn new() -> Self;
    /// Forget everything learned (TT, history, killers).
    fn new_game(&mut self);
    // @block transposition_table
    fn set_hash(&mut self, mb: usize);
    // @end transposition_table
    fn time_params() -> TimeParams {
        TimeParams::default()
    }
    /// Searches `pos`. Must return promptly once `stop` is set.
    fn search(
        &mut self,
        pos: &Position,
        tm: TimeManager,
        stop: Arc<AtomicBool>,
        verbose: bool,
    ) -> SearchResult;
}

const STARTPOS: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/// Runs the UCI loop until `quit` or end of input.
pub fn run<E: Engine>() {
    let stop = Arc::new(AtomicBool::new(false));
    let mut engine = Some(E::new());
    let mut thread: Option<JoinHandle<E>> = None;
    let mut pos = Position::default();

    let wait = |thread: &mut Option<JoinHandle<E>>, engine: &mut Option<E>| {
        if let Some(handle) = thread.take() {
            *engine = Some(handle.join().expect("search thread panicked"));
        }
    };

    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let Some(&command) = tokens.first() else {
            continue;
        };

        match command {
            "uci" => {
                println!("id name {}", E::NAME);
                println!("id author {}", E::AUTHOR);
                // @block transposition_table
                println!(
                    "option name Hash type spin default {} min 1 max 65536",
                    E::DEFAULT_HASH_MB
                );
                // @end transposition_table
                println!("option name Threads type spin default 1 min 1 max 1");
                println!("uciok");
            }
            "isready" => println!("readyok"),
            "ucinewgame" => {
                wait(&mut thread, &mut engine);
                engine.as_mut().unwrap().new_game();
            }
            // @block transposition_table
            "setoption" => {
                wait(&mut thread, &mut engine);
                set_option::<E>(engine.as_mut().unwrap(), &tokens);
            }
            // @end transposition_table
            "position" => {
                wait(&mut thread, &mut engine);
                match parse_position(&tokens) {
                    Some(p) => pos = p,
                    None => println!("info string invalid position command"),
                }
            }
            "go" => {
                wait(&mut thread, &mut engine);
                if tokens.get(1) == Some(&"perft") {
                    let depth = tokens.get(2).and_then(|d| d.parse().ok()).unwrap_or(1);
                    perft_divide(pos.board(), depth);
                    continue;
                }
                let limits = Limits::parse(&tokens[1..]);
                let tm = TimeManager::new(&limits, pos.board().side_to_move(), &E::time_params());
                stop.store(false, Ordering::Relaxed);
                let mut e = engine.take().unwrap();
                let p = pos.clone();
                let s = Arc::clone(&stop);
                thread = Some(std::thread::spawn(move || {
                    let result = e.search(&p, tm, s, true);
                    let best = result.best_move.or_else(|| first_legal_move(p.board()));
                    match best {
                        Some(mv) => println!("bestmove {}", display_uci_move(p.board(), mv)),
                        None => println!("bestmove 0000"),
                    }
                    e
                }));
            }
            "stop" => {
                stop.store(true, Ordering::Relaxed);
                wait(&mut thread, &mut engine);
            }
            "quit" => {
                stop.store(true, Ordering::Relaxed);
                wait(&mut thread, &mut engine);
                return;
            }
            "bench" => {
                wait(&mut thread, &mut engine);
                let depth = tokens.get(1).and_then(|d| d.parse().ok());
                crate::bench::run::<E>(depth);
            }
            "d" => println!("{}", pos.board()),
            _ => println!("info string unknown command: {command}"),
        }
    }

    stop.store(true, Ordering::Relaxed);
    wait(&mut thread, &mut engine);
}

// @block transposition_table
fn set_option<E: Engine>(engine: &mut E, tokens: &[&str]) {
    // setoption name <name...> value <value...>
    let name_at = tokens.iter().position(|&t| t == "name");
    let value_at = tokens.iter().position(|&t| t == "value");
    let (Some(n), Some(v)) = (name_at, value_at) else {
        return;
    };
    let name = tokens[n + 1..v].join(" ");
    let value = tokens[v + 1..].join(" ");
    if name.eq_ignore_ascii_case("Hash") {
        if let Ok(mb) = value.parse::<usize>() {
            engine.set_hash(mb.clamp(1, 65536));
        }
    }
}
// @end transposition_table

/// Parses `position startpos|fen <fen> [moves ...]`.
pub fn parse_position(tokens: &[&str]) -> Option<Position> {
    let moves_at = tokens.iter().position(|&t| t == "moves");
    let mut pos = match *tokens.get(1)? {
        "startpos" => Position::from_fen(STARTPOS).ok()?,
        "fen" => {
            let end = moves_at.unwrap_or(tokens.len());
            Position::from_fen(&tokens.get(2..end)?.join(" ")).ok()?
        }
        _ => return None,
    };
    if let Some(at) = moves_at {
        for m in &tokens[at + 1..] {
            let mv = parse_uci_move(pos.board(), m).ok()?;
            if !pos.board().is_legal(mv) {
                return None;
            }
            pos.make_move(mv);
        }
    }
    Some(pos)
}

/// Counts leaf nodes of the legal move tree to `depth`.
pub fn perft(board: &Board, depth: u32) -> u64 {
    if depth == 0 {
        return 1;
    }
    let mut nodes = 0;
    board.generate_moves(|moves| {
        if depth == 1 {
            nodes += moves.len() as u64;
        } else {
            for mv in moves {
                let mut child = board.clone();
                child.play_unchecked(mv);
                nodes += perft(&child, depth - 1);
            }
        }
        false
    });
    nodes
}

fn first_legal_move(board: &Board) -> Option<Move> {
    let list = MoveList::all(board);
    (!list.is_empty()).then(|| list.get(0))
}

fn perft_divide(board: &Board, depth: u32) {
    let start = Instant::now();
    let mut total = 0;
    let list = MoveList::all(board);
    for i in 0..list.len() {
        let mv = list.get(i);
        let mut child = board.clone();
        child.play_unchecked(mv);
        let n = perft(&child, depth.saturating_sub(1));
        println!("{}: {n}", display_uci_move(board, mv));
        total += n;
    }
    let ms = start.elapsed().as_millis().max(1) as u64;
    println!("\nnodes {total} time {ms} nps {}", total * 1000 / ms);
}

// @block tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_position_with_castling() {
        let cmd = "position startpos moves e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 e1g1";
        let tokens: Vec<&str> = cmd.split_whitespace().collect();
        let pos = parse_position(&tokens).unwrap();
        assert_eq!(
            pos.board().to_string(),
            "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4"
        );
    }

    #[test]
    fn parses_fen_position() {
        let cmd = "position fen 8/8/4k3/8/8/4K3/8/8 w - - 0 1 moves e3d4";
        let tokens: Vec<&str> = cmd.split_whitespace().collect();
        let pos = parse_position(&tokens).unwrap();
        assert_eq!(pos.board().to_string(), "8/8/4k3/8/3K4/8/8/8 b - - 1 1");
    }

    #[test]
    fn rejects_illegal_moves() {
        let tokens: Vec<&str> = "position startpos moves e2e5".split_whitespace().collect();
        assert!(parse_position(&tokens).is_none());
    }

    #[test]
    fn perft_startpos() {
        let board = Board::default();
        assert_eq!(perft(&board, 1), 20);
        assert_eq!(perft(&board, 2), 400);
        assert_eq!(perft(&board, 3), 8_902);
        assert_eq!(perft(&board, 4), 197_281);
    }

    #[test]
    fn perft_kiwipete() {
        let board: Board = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
            .parse()
            .unwrap();
        assert_eq!(perft(&board, 1), 48);
        assert_eq!(perft(&board, 2), 2_039);
        assert_eq!(perft(&board, 3), 97_862);
    }

    #[test]
    fn perft_tricky_positions() {
        let cases = [
            ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 5, 674_624),
            (
                "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
                4,
                422_333,
            ),
            (
                "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
                4,
                2_103_487,
            ),
        ];
        for (fen, depth, expected) in cases {
            let board: Board = fen.parse().unwrap();
            assert_eq!(perft(&board, depth), expected, "{fen}");
        }
    }
}
// @end tests
