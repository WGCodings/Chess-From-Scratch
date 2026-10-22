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
  in the browser; Save/Open use the same `workspace.json` that every exported
  project contains. Export downloads the complete Cargo project as a zip.

## Status

Sprint 3 (Blockly editor). See the MVP plan doc in the
Claude project for scope and the sprint roadmap.
