# Reading the code

The right side of the app shows the Rust project your blocks make. It is the same project you get when you export, file by file.

## The files

| File | What is in it |
|---|---|
| `src/search.rs` | The search: Negamax or Random mover, and all search blocks. |
| `src/eval.rs` | The evaluation and its terms. |
| `src/psqt.rs` | Your piece-square tables, if you added that block. |
| `src/params.rs` | Every number you can set on a block, as a constant. |
| `src/uci.rs` | Talks to chess programs (the UCI protocol). |
| `src/position.rs` | The board plus the history of moves (for repetitions). |
| `src/time.rs` | How long to think. |
| `src/moves.rs` | Move lists and small helpers. |
| `src/score.rs` | Scores, mate scores and the `info` lines. |
| `src/bench.rs` | The `bench` command: a speed and correctness check. |
| `src/main.rs` | Where the program starts. |
| `Cargo.toml` | The project name and its one library, cozy-chess. |
| `workspace.json` | Your blocks, so you can open the project in the app again. |

The project only contains code your blocks need. No transposition table block means no `tt.rs`.

## Markers: which block wrote this?

Lines like these show which block owns a piece of code:

```rust
// @block null_move_pruning
...code of Null move pruning...
// @end null_move_pruning
```

Remove the block, and everything between its markers is gone. Some code is shared by a few blocks. You see that as `// @block killers|history`: the code is there when either block is.

Sometimes there is an `// @else` line. The code after it is what runs when the block is *not* there.

Double-click any line to edit the block that owns it.

## Hooks: the ⚓ lines

The ⚓ lines between the code are **hooks**. A hook is a fixed spot where blocks can add code. For example, `// @hook pruning` is where pruning blocks go. Each slot has one hook with the same name. When you make your own block, you pick the hook it adds code to. See [Making a new block](Making-A-New-Block).

## Parameters

The numbers on blocks, like *Margin* or *Depth*, end up in `src/params.rs`:

```rust
pub const RFP_MARGIN: i32 = 80;
```

The code uses them by name. Change the number on the block and the constant changes. You can also tune them in the file after you export.

## The library: cozy-chess

The board, the moves and the move generator come from a library called [cozy-chess](https://docs.rs/cozy-chess). You see it in code like `board.generate_moves(...)`, `board.checkers()` or `Piece::Knight`. Its documentation lists everything it can do.
