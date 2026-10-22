//! A board plus the history needed for repetition detection, with
//! make/unmake so the search can walk the tree without cloning histories.

use cozy_chess::{Board, FenParseError, Move};

#[derive(Clone)]
struct Entry {
    board: Board,
    // @block null_move_pruning
    null: bool,
    // @end null_move_pruning
}

/// The current position and every position before it in the game and search.
#[derive(Clone)]
pub struct Position {
    stack: Vec<Entry>,
}

impl Default for Position {
    fn default() -> Self {
        Self::from_board(Board::default())
    }
}

impl Position {
    pub fn from_board(board: Board) -> Self {
        let mut stack = Vec::with_capacity(512);
        // @block null_move_pruning
        stack.push(Entry { board, null: false });
        // @else
        stack.push(Entry { board });
        // @end null_move_pruning
        Self { stack }
    }

    pub fn from_fen(fen: &str) -> Result<Self, FenParseError> {
        Ok(Self::from_board(Board::from_fen(fen, false)?))
    }

    /// The current board.
    #[inline]
    pub fn board(&self) -> &Board {
        &self
            .stack
            .last()
            .expect("position stack is never empty")
            .board
    }

    /// Plays a legal move.
    #[inline]
    pub fn make_move(&mut self, mv: Move) {
        let mut board = self.board().clone();
        board.play_unchecked(mv);
        // @block null_move_pruning
        self.stack.push(Entry { board, null: false });
        // @else
        self.stack.push(Entry { board });
        // @end null_move_pruning
    }

    // @block null_move_pruning
    /// Passes the turn. Returns false (and does nothing) when in check.
    #[inline]
    pub fn make_null(&mut self) -> bool {
        match self.board().null_move() {
            Some(board) => {
                self.stack.push(Entry { board, null: true });
                true
            }
            None => false,
        }
    }
    // @end null_move_pruning

    /// Takes back the last move or null move.
    #[inline]
    pub fn unmake(&mut self) {
        debug_assert!(self.stack.len() > 1);
        self.stack.pop();
    }

    // @block null_move_pruning
    /// True when the move that led here was a null move.
    #[inline]
    pub fn last_move_was_null(&self) -> bool {
        self.stack.last().is_some_and(|e| e.null)
    }
    // @end null_move_pruning

    /// Fifty-move rule or a repetition of an earlier position.
    pub fn is_draw(&self) -> bool {
        let board = self.board();
        if board.halfmove_clock() >= 100 {
            return true;
        }
        let hash = board.hash();
        let reachable = board.halfmove_clock() as usize;
        self.stack
            .iter()
            .rev()
            .skip(2)
            .step_by(2)
            .take(reachable / 2)
            .any(|e| e.board.hash() == hash)
    }
}

// @block tests
#[cfg(test)]
mod tests {
    use super::*;
    use cozy_chess::util::parse_uci_move;

    fn play(pos: &mut Position, moves: &str) {
        for m in moves.split_whitespace() {
            let mv = parse_uci_move(pos.board(), m).unwrap();
            pos.make_move(mv);
        }
    }

    #[test]
    fn detects_repetition() {
        let mut pos = Position::default();
        play(&mut pos, "g1f3 g8f6 f3g1");
        assert!(!pos.is_draw());
        play(&mut pos, "f6g8");
        assert!(pos.is_draw());
    }

    #[test]
    fn null_move_round_trip() {
        let mut pos = Position::default();
        let hash = pos.board().hash();
        assert!(pos.make_null());
        assert!(pos.last_move_was_null());
        pos.unmake();
        assert_eq!(pos.board().hash(), hash);
    }
}
// @end tests
