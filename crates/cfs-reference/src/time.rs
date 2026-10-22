//! `go` command limits and a simple soft/hard time manager.

use std::time::{Duration, Instant};

use cozy_chess::Color;

use crate::score::MAX_PLY;

/// Limits parsed from a UCI `go` command.
#[derive(Clone, Debug, Default)]
pub struct Limits {
    pub wtime: Option<u64>,
    pub btime: Option<u64>,
    pub winc: Option<u64>,
    pub binc: Option<u64>,
    pub movestogo: Option<u64>,
    pub movetime: Option<u64>,
    pub depth: Option<i32>,
    pub nodes: Option<u64>,
    pub infinite: bool,
}

impl Limits {
    /// Parses the tokens after `go`.
    pub fn parse(tokens: &[&str]) -> Self {
        let mut limits = Self::default();
        let mut iter = tokens.iter();
        while let Some(&token) = iter.next() {
            let mut next = || iter.next().and_then(|v| v.parse::<i64>().ok());
            match token {
                "wtime" => limits.wtime = next().map(|v| v.max(0) as u64),
                "btime" => limits.btime = next().map(|v| v.max(0) as u64),
                "winc" => limits.winc = next().map(|v| v.max(0) as u64),
                "binc" => limits.binc = next().map(|v| v.max(0) as u64),
                "movestogo" => limits.movestogo = next().map(|v| v.max(1) as u64),
                "movetime" => limits.movetime = next().map(|v| v.max(0) as u64),
                "depth" => limits.depth = next().map(|v| v as i32),
                "nodes" => limits.nodes = next().map(|v| v.max(0) as u64),
                "infinite" => limits.infinite = true,
                _ => {}
            }
        }
        limits
    }
}

/// Tunable time-management settings (the "Time management" block).
#[derive(Clone, Copy, Debug)]
pub struct TimeParams {
    /// Assumed number of moves left when the GUI does not say.
    pub moves_to_go: u64,
    /// Percentage of the increment added to each move's budget.
    pub inc_percent: u64,
    /// Hard limit as a multiple of the soft limit.
    pub hard_multiplier: u64,
    /// Safety margin for GUI and OS latency, in milliseconds.
    pub overhead_ms: u64,
}

impl Default for TimeParams {
    fn default() -> Self {
        Self {
            moves_to_go: 25,
            inc_percent: 75,
            hard_multiplier: 3,
            overhead_ms: 25,
        }
    }
}

/// Decides when the search should stop.
#[derive(Clone, Debug)]
pub struct TimeManager {
    start: Instant,
    soft: Option<Duration>,
    hard: Option<Duration>,
    max_nodes: Option<u64>,
    /// Deepest iteration to start.
    pub max_depth: i32,
}

impl TimeManager {
    pub fn new(limits: &Limits, side: Color, params: &TimeParams) -> Self {
        let start = Instant::now();
        let max_depth = limits
            .depth
            .unwrap_or(MAX_PLY as i32 - 1)
            .clamp(1, MAX_PLY as i32 - 1);
        let (time, inc) = match side {
            Color::White => (limits.wtime, limits.winc.unwrap_or(0)),
            Color::Black => (limits.btime, limits.binc.unwrap_or(0)),
        };

        let (soft, hard) = if limits.infinite {
            (None, None)
        } else if let Some(movetime) = limits.movetime {
            let t = movetime.saturating_sub(params.overhead_ms).max(1);
            (Some(t), Some(t))
        } else if let Some(time) = time {
            let usable = time.saturating_sub(params.overhead_ms).max(1);
            let mtg = limits.movestogo.unwrap_or(params.moves_to_go).max(1);
            let soft = (usable / mtg + inc * params.inc_percent / 100).min(usable);
            let hard = (soft * params.hard_multiplier)
                .min(usable * 3 / 4)
                .max(soft.min(usable));
            (Some(soft.max(1)), Some(hard.max(1)))
        } else {
            (None, None)
        };

        Self {
            start,
            soft: soft.map(Duration::from_millis),
            hard: hard.map(Duration::from_millis),
            max_nodes: limits.nodes,
            max_depth,
        }
    }

    /// Search exactly to `depth` with no time or node limit (used by `bench`).
    pub fn fixed_depth(depth: i32) -> Self {
        Self::new(
            &Limits {
                depth: Some(depth),
                ..Limits::default()
            },
            Color::White,
            &TimeParams::default(),
        )
    }

    pub fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }

    /// Checked between iterations: is it worth starting another one?
    pub fn soft_stop(&self, nodes: u64) -> bool {
        self.soft.is_some_and(|s| self.elapsed() >= s) || self.max_nodes.is_some_and(|n| nodes >= n)
    }

    /// Checked inside the search: must we abort right now?
    pub fn hard_stop(&self, nodes: u64) -> bool {
        self.hard.is_some_and(|h| self.elapsed() >= h) || self.max_nodes.is_some_and(|n| nodes >= n)
    }
}

// @block tests
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_go() {
        let l = Limits::parse(&["wtime", "1000", "btime", "2000", "winc", "10", "depth", "7"]);
        assert_eq!(l.wtime, Some(1000));
        assert_eq!(l.btime, Some(2000));
        assert_eq!(l.winc, Some(10));
        assert_eq!(l.depth, Some(7));
        assert!(!l.infinite);
    }

    #[test]
    fn budget_stays_within_clock() {
        let l = Limits::parse(&["wtime", "100", "btime", "100"]);
        let tm = TimeManager::new(&l, Color::White, &TimeParams::default());
        assert!(tm.hard.unwrap() <= Duration::from_millis(100));
        assert!(tm.soft.unwrap() <= tm.hard.unwrap());
    }
}
// @end tests
