# Adding files

Hooks cover the usual spots. Sometimes you need code somewhere else, or a whole new file. A block can do both.

## Code after (or before) any line

```rust
// @insert eval.rs after "pub fn evaluate(board: &Board) -> i32 {"
// Tempo: the side to move gets a small bonus.
let tempo = crate::tempo::tempo(board);
```

This puts the code right below that line of `eval.rs`. Use `before` instead of `after` to put it above.

- The line in quotes must match exactly (spaces at the start don't matter).
- If the line is in the file more than once, add `#2` (or `#3`, ...) after the quotes to pick which one.
- A comment line is often a good, unique line to pick.
- You can use this on `Cargo.toml` and `params.rs` too.

If the line belongs to another block, add that block under `requires:`, or your code is gone when that block is removed.

## A whole new file

```rust
// @file src/tempo.rs
//! The tempo bonus.

use cozy_chess::{Board, Color};

use crate::eval::S;
use crate::params::TEMPO;

/// The tempo bonus from White's point of view.
pub fn tempo(board: &Board) -> S {
    if board.side_to_move() == Color::White {
        TEMPO
    } else {
        -TEMPO
    }
}
```

`// @file src/tempo.rs` adds a file to the project. The app also adds `mod tempo;` to `main.rs`, so you can use it from other files as `crate::tempo::tempo(...)`.

## One block, many places

A block can have as many sections as it needs, in any files. The *Tempo bonus* example in **My blocks > Evaluation** uses three:

1. `// @file src/tempo.rs`: a new file with a function,
2. `// @insert eval.rs after ...`: one line at the start of the evaluation,
3. `// @hook eval`: adds the bonus to the score.

```rust
// @hook eval
score += tempo;
```

## Changing the skeleton itself

Want to change code that no block owns, like the UCI loop? Make your own version of the **Engine** block. See [Changing a block](Changing-A-Block).
