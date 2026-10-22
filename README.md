# Chess From Scratch (CFS)

A drag-and-drop editor for building UCI chess engines, aimed at beginner engine
developers. Blocks in the browser, real Rust underneath: a workspace exports to a
complete Cargo project that you compile and fully own.

## Repository layout

```
crates/
  cfs-reference/   generator output for the "every block" workspace, with unit tests (bench 150455)
packages/
  codegen/         block catalogue, workspace format, Rust templates and project generator
    templates/     every line of Rust an engine can contain (search, eval, uci, tt, ...)
apps/
  web/             Blockly editor (Vite + TypeScript): blocks, live Rust preview, export
```

## Requirements

- Rust stable (1.80+)
- Node 20+ and npm

## Common commands

```sh
# Rust
cargo test --release                            # perft and unit tests for all template code
cargo build --release -p cfs-reference          # the reference engine (UCI)
./target/release/cfs-reference bench            # deterministic node count + nps (OpenBench format)

# Web
npm install
npm run dev        # editor at http://localhost:5173
npm test           # codegen + editor tests (reference == generator output, blocks round-trip)
npm run build      # typecheck + production build

# Code generator
npm run gen:reference -w @cfs/codegen     # regenerate crates/cfs-reference/src from templates
npm run check:generated -w @cfs/codegen   # build + clippy + bench 19 block combinations (needs cargo)
```

## Reference engine

`cfs-reference` uses every MVP block: iterative deepening, aspiration windows,
TT, reverse futility pruning, null move pruning, MVV-LVA, killers, history,
PVS, LMR and quiescence search, with a tapered HCE (PeSTO, mobility, bishop
pair, rook on open/half-open files, passed pawns). Its `src/` is generated:
edit the templates in `packages/codegen/templates/` and run
`npm run gen:reference -w @cfs/codegen`. Every block sits between
`// @block <name>` and `// @end <name>` markers, and every parameter is a
constant in `params.rs`.

Besides standard UCI it understands `bench [depth]`, `go perft <depth>` and `d`.

## How code generation works

A workspace (JSON, see `packages/codegen/src/workspace.ts`) lists the engine
settings, the search blocks placed in each slot and the eval terms. The
generator renders the Rust templates, keeping each placed block's region
(with markers) and replacing missing ones with their `// @else` fallback,
and writes `params.rs` from the block catalogue. The result is one flat Cargo
crate (only `cozy-chess` as a dependency) that contains only the code the
placed blocks need: no TT block means no `tt.rs`, an unplaced eval term
leaves no trace. `// @block a|b` marks helpers shared by several blocks, and regions nest
(PVS sits inside Alpha-beta). The generator also reports which block owns
each line, which the editor uses for its explanations.
The unit tests in the templates (`// @block tests`) are kept only in the
reference crate.

## The editor

Every engine starts bare bones: plain negamax (no pruning at all), basic time
management and PeSTO tables. Every improvement is a block you add yourself,
starting with Alpha-beta pruning, which most other search blocks build on.
Drop feature blocks into the slots of the Negamax and Evaluation blocks. Blocks only fit where they belong
(typed connections), each block appears once, and loose blocks are greyed out
and ignored.

- **Code view**: a project tree on the right shows every generated file, laid
  out like the Rust project you export (`.cargo/`, `src/`, `Cargo.toml`, ...).
  Your engine's files (`search.rs`, `eval.rs`, `params.rs`) are marked.
  Selecting a block highlights its code.
- **Change tour**: adding a block explains the idea (with a Chess Programming
  Wiki link) and then walks through every place in every file that changed,
  each with a one-line reason taken from the code's own comments. Next/Back
  or the arrow keys step through it; Skip or Esc closes it. Right-click any
  block and choose *Explain this block* to walk through all of its code, part
  by part. On the Engine, Negamax or Evaluation block this explains the
  skeleton itself, every section of `main.rs`, `uci.rs`, `search.rs`, ...
- **Time management**: an engine always has one. Without a time block it uses
  the Basic rule (time left / 40 + half the increment); the Soft/hard block
  adds a soft limit for iterations and a hard limit for the search.
- **Status** lists errors (which block export) and warnings. Work autosaves
  in the browser. Save downloads a `.cfs` project bundle (a zip with
  `workspace.json` and `blocks/*.block.rs`); Open reads `.cfs`, a plain
  `workspace.json` or a single `.block.rs`. Export downloads the complete
  Cargo project as a zip.

## Custom blocks

A block is one text file, `<id>.block.rs`: a `//! ---` header (id, label,
slot, base, requires, description, info, parameters) and the code it adds.

```rust
//! ---
//! id: check_extension
//! label: Check extension
//! slot: extensions
//! params:
//!   CHECK_EXTENSION: i32 = 1 (0..2) "Plies"
//! ---

// @hook extensions
if !pos.board().checkers().is_empty() {
    extension += CHECK_EXTENSION;
}
```

- `// @hook <name>` adds code at a named place in the skeleton. Every slot
  has one hook with the slot's name, where blocks of that slot work: `root`,
  `pruning`, `ordering`, `extensions`, `move_loop`, `reductions`, `leaf` and
  `eval`. Support hooks add fields and helpers: `searcher_fields`,
  `searcher_init`, `new_game`, `node_start`, `on_cutoff`, `search_imports`,
  `search_helpers`, `eval_helpers` (`HOOKS` in
  `packages/codegen/src/blockfile.ts`). Hooks are fixed; old names
  (`search_start`, `move_order`, `eval_terms`) still work.
- `// @region <file> <n>` replaces the n-th region of the `base` block: this
  is what *Edit this block* produces when you fork a built-in block. An
  unedited fork generates exactly the base block's code.
- `// @insert <file> after "<exact line>"` adds code anywhere, effectively a
  hook of your own; `// @file src/<name>.rs` adds a whole file (and its `mod`
  line).
- Parameters use plain names you choose and become constants in `params.rs`.
- Skeleton values (`pv_node`, `static_eval`, `stm`, `quiet`, `tt_move`,
  `is_capture`) are generated only when some block uses them; mentioning one
  in a custom block switches it on.

You can also work the other way round, from code to blocks: *Edit code*
on the code pane makes the generated file editable. Code you type between
`// @block <name>` and `// @end <name>` lines becomes a block when you click
*Save as blocks*: right below a hook (the ⚓ lines) it becomes a `@hook`
section, anywhere else an `@insert` after the line above it (with `#n` when
that line occurs more than once). A block may get code in several places and
files. Edits inside your own blocks are saved into their block files, and
edits inside a built-in block make your own version of it. UPPER_CASE names
nothing defines become parameters (starting at 1). Skeleton code itself can't
be changed this way. Both editors indent with Tab, re-indent with Format
(Shift+Alt+F) and complete cozy-chess (`board.`, `Piece::`, ...), skeleton
values and parameters (Ctrl+Space).

**Linked folder** (Chrome and Edge): *Link folder* writes the whole Cargo
project into a folder on your computer and keeps it in sync. Open it in VS
Code (rust-analyzer gives full cozy-chess completion) and build it with
cargo; saved edits come back into the app the same way as with *Edit code*,
edited `blocks/*.block.rs` files update their blocks, and changes made in the
app are written to the folder.

In the editor: right-click a block > *Edit this block* (built-in blocks are
forked into your own version), *My blocks > New block…* for a block from
scratch, or double-click a line of generated code to edit the block it
belongs to (on skeleton code this offers a block that inserts after that
line). Saved blocks live in the browser's block library (*My blocks*) for
future projects and inside the project's `.cfs` bundle and export. Example
blocks are in `packages/codegen/examples/`. The editor checks a block's
structure and runs a Rust syntax check on the generated files; whether it
compiles is up to cargo.

## Tests

- `npm test`: unit tests, including `packages/codegen/src/scenarios.ts`, a
  catalogue of user workflows (new blocks at every hook, inserts, edits to
  your own and built-in blocks, several files, mistakes) checked for the
  blocks they produce, "what you typed is what you get" and idempotence.
- `npm run check:generated -w @cfs/codegen`: every scenario and block
  combination is generated, formatted, linted with clippy, built and benched.
- `npm run e2e -w @cfs/web`: the editor in Chrome (toolbox search, Edit code,
  Tab/Format/completion, block editor, linked folder, `.cfs` bundles). Set
  `CHROMIUM_PATH` to use another Chromium.

## Status

Sprint 5 (editable and custom blocks). See the MVP plan doc in the
Claude project for scope and the sprint roadmap.
