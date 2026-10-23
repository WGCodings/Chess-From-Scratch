# Block file reference

Everything a block file can contain, on one page. For a gentle start, read [Making a new block](Making-A-New-Block) first.

## The header

The header sits between two `//! ---` lines. One `key: value` per line. A long value can continue on the next lines if they start with two spaces.

| Key | Needed? | Meaning |
|---|---|---|
| `id` | yes | small letters, numbers and `_`. Also the file name and the marker name in the code. |
| `label` | no | the name on the block (the id if left out) |
| `slot` | yes | `root`, `pruning`, `ordering`, `extensions`, `move_loop`, `reductions`, `leaf` or `eval`. Your versions of skeleton blocks use `engine`, `search`, `evaluation`, `taper` or `setting`. |
| `base` | for your versions | the block this one replaces, like `null_move_pruning` or `negamax` |
| `requires` | no | blocks it needs, with commas: `alpha_beta, transposition_table`. Your own block ids work too. |
| `description` | no | one line, shown when you hover over the block |
| `info` | no | the explanation at the start of the code tour |
| `cpw` | no | a link to the [Chess Programming Wiki](https://www.chessprogramming.org) |
| `params` | no | one setting per line, two spaces in: `NAME: type = default (min..max) "Label"` |

Setting types: `i32`, `u64`, `usize`, `f64`, `S` (written `S(10, 5)`), `[S; 4]`, `[S; 8]`.

## Sections

A section starts with one of these lines, at the very start of the line. Its code runs until the next section.

| Section | What it does |
|---|---|
| `// @hook name` | adds the code at a hook |
| `// @insert file after "line"` | adds the code below an exact line of a file |
| `// @insert file before "line"` | adds the code above an exact line |
| `// @replace file "line"` | puts the code where that line was |
| `// @replace file "first" to "last"` | puts the code where those lines were |
| `// @region file n` | replaces part *n* of the base block's code in that file (used by your versions) |
| `// @file src/name.rs` | adds a whole new file |

Add `#2` after a quoted line to pick its second match. Only lines that are in your engine count.

## Hooks

| Hook | File | Use it for |
|---|---|---|
| `root` | search.rs | once at the start of every search |
| `pruning` | search.rs | before the move loop; `return` a score to prune |
| `ordering` | search.rs | score one move: set `order` (higher goes first) |
| `extensions` | search.rs | add to `extension` to search a move deeper |
| `reductions` | search.rs | subtract from `extension` to search a move less deep |
| `move_loop` | search.rs | after each move is searched |
| `leaf` | search.rs | at depth 0; `return` a score to use it |
| `eval` | eval.rs | `score += S(mg, eg);` from White's point of view |
| `search_imports` | search.rs | `use` lines at the top |
| `searcher_fields` | search.rs | fields of the searcher, like `counters: [i32; 64],` |
| `searcher_init` | search.rs | their starting values, like `counters: [0; 64],` |
| `new_game` | search.rs | runs on `ucinewgame`; clear tables here |
| `node_start` | search.rs | start of every position searched |
| `on_cutoff` | search.rs | a move caused a beta cutoff (needs Alpha-beta pruning) |
| `search_helpers` | search.rs | your own functions at the end of the file |
| `eval_helpers` | eval.rs | your own functions at the end of the file |

## Names you can use in search code

| Name | What it is |
|---|---|
| `pos` | the position (board plus history) |
| `board` | the board at this position |
| `mv` | the move being looked at |
| `stm` | the side to move |
| `depth` | how many more moves to search |
| `ply` | how far from the start of the search |
| `alpha`, `beta` | the search window |
| `in_check` | the side to move is in check |
| `static_eval` | the evaluation of this position |
| `pv_node` | an exact score matters here |
| `quiet` | the move is not a capture or promotion |
| `tt_move` | the best move from the transposition table |
| `order` | the move's ordering score (ordering hook) |
| `extension` | plies to add or take off (extensions, reductions) |
| `score`, `best_score` | the move's score and the best so far |
| `i` | the number of the move in the loop, from 0 |
| `self` | the searcher, with its fields and tables |

Helpers: `evaluate(&board)`, `is_capture(&board, mv)`, `is_quiet(&board, mv)`, `pos.is_draw()`.

## Lines inside your versions

| Line | Meaning |
|---|---|
| `// @block name` ... `// @end name` | code of another block inside this one; leave the markers |
| `// @builtin name` | stands for the code of a block not in your engine yet |
| `// @until name` ... `// @end name` | code that runs until that block is added |
