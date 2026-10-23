# Making a new block

A block is one small text file. It has a short header, then the code it adds. You can write one from scratch in a few minutes.

## Start a new block

1. Open **My blocks** in the drawer, then **New or import**.
2. Click **New block…**.
3. Give it a name and pick where it goes (for example *Search: extensions*).
4. Click **Create and edit**.

The editor opens with working example code for that spot. Change it, save, and the block is placed in your engine.

## What a block looks like

Here is a whole block. It searches moves that give check one move deeper:

```rust
//! ---
//! id: check_extension
//! label: Check extension
//! slot: extensions
//! description: Searches moves that give check one ply deeper.
//! params:
//!   CHECK_EXTENSION: i32 = 1 (0..2) "Plies"
//! ---

// @hook extensions
// The move gives check: search it deeper.
if !pos.board().checkers().is_empty() {
    extension += CHECK_EXTENSION;
}
```

The top part, between the two `//! ---` lines, is the **header**:

- `id`: the block's name in the code. Small letters, numbers and `_`.
- `label`: the name you see on the block.
- `slot`: where it goes on the canvas.
- `description`: one line, shown when you hover over the block.
- `params`: numbers you can set on the block.

Below the header is the **code**. `// @hook extensions` says: put the code below at the *extensions* hook. That is the spot in the search where a move was just made and the engine decides how deep to search it.

The first comment under the hook is used as the explanation in the code tour. Write one, it helps you later.

## Which hook?

Each slot has a hook with the same name. These are the spots and what you can use there:

| Hook | What it is for | Names you can use |
|---|---|---|
| `root` | once at the start of a search | |
| `pruning` | before the move loop; `return` a score to stop searching this position | `pos`, `board`, `depth`, `ply`, `alpha`, `beta`, `in_check`, `static_eval`, `pv_node`, `stm` |
| `ordering` | give a move a score; higher is tried first | `mv`, `board`, `ply`, `stm`, `tt_move`, and set `order` |
| `extensions` | after a move is made; add to `extension` to search deeper | `mv`, `pos`, `board`, `depth`, `ply`, `quiet`, `in_check`, `i` |
| `reductions` | after a move is made; subtract from `extension` to search less deep | same as extensions |
| `move_loop` | after a move was searched | `mv`, `score`, `best_score`, `depth`, `ply`, `i`, `quiet` |
| `leaf` | at the end of the depth; `return` a score to use it | `pos`, `ply`, `alpha`, `beta` |
| `eval` | add to the evaluation: `score += S(mg, eg);` from White's side | `board`, `score` |

There are a few helper hooks too, for code around your block: `searcher_fields` (add a field to the searcher), `searcher_init` (its starting value), `new_game` (clear it on a new game), `on_cutoff` (a move was so good the search stopped early), `search_helpers` and `eval_helpers` (functions at the end of the file). The [Block file reference](Block-File-Reference) has the full list.

Names like `static_eval` or `pv_node` only exist when something uses them. Use one in your block and the app adds it for you.

## Numbers on the block

Each line under `params:` becomes a field on the block and a constant in `params.rs`:

```
//!   MY_MARGIN: i32 = 200 (1..2000) "Margin"
```

| Part | Meaning |
|---|---|
| `MY_MARGIN` | the name you use in the code |
| `i32` | the kind of number (see below) |
| `= 200` | the starting value |
| `(1..2000)` | the smallest and largest allowed (you can leave this out) |
| `"Margin"` | the label on the block (you can leave this out) |

Kinds: `i32` (whole number), `u64` and `usize` (whole number, not negative), `f64` (with decimals), `S` (a middlegame and endgame pair, written `S(10, 5)`), and `[S; 4]` or `[S; 8]` (lists of pairs, for example one per piece type).

Tip: if you write a name like `MY_MARGIN` in your code and forget to add it to `params`, the app adds it for you when you save from the code view, starting at 1.

## Needing another block

If your block only works with another block, say so:

```
//! requires: alpha_beta
```

Your block then stays greyed out in the drawer until that block is in your engine.

## Checking your block

The editor checks your block as you type: the header, the hook names, brackets that don't close, and Rust syntax. Problems show up below the code. Whether it really compiles, `cargo build` tells you. See [Build, test and play](Build-Test-Play).

## More ways to add code

A block can add code in more places than hooks:

- change lines of another block: [Blocks on top of blocks](Blocks-On-Top-Of-Blocks)
- put code after any line of any file, or add a whole file: [Adding files](Adding-Files)
