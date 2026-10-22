//! ---
//! id: check_extension
//! label: Check extension
//! slot: extensions
//! description: Searches moves that give check one ply deeper.
//! info: A move that gives check forces a reply, so the line is narrow and often tactical. Searching it one ply deeper helps the engine see mates and combinations that would otherwise sit just past the horizon.
//! cpw: https://www.chessprogramming.org/Check_Extensions
//! params:
//!   CHECK_EXTENSION: i32 = 1 (0..2) "Plies"
//! ---

// @hook extensions
// The move gives check: search it deeper.
if !pos.board().checkers().is_empty() {
    extension += CHECK_EXTENSION;
}
