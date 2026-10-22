# Chess From Scratch (CFS)

A drag-and-drop editor for building UCI chess engines, aimed at beginner engine
developers. Blocks in the browser, real Rust underneath: a workspace exports to a
complete Cargo project that you compile and fully own.

## Repository layout

```
crates/
  cfs-runtime/     MIT runtime shipped inside every exported engine (cozy-chess, UCI, TT, bench)
  cfs-reference/   generator output for the "every block" workspace (golden file, bench 945193)
packages/
  codegen/         block catalogue, workspace format, Rust templates and project generator
apps/
  web/             Blockly editor (Vite + TypeScript)
```

## Requirements

- Rust stable (1.80+)
- Node 20+ and npm

## Common commands

```sh
# Rust
cargo test --release                            # perft, runtime unit tests, bench fingerprint
cargo build --release -p cfs-reference          # the reference engine (UCI)
./target/release/cfs-reference bench            # deterministic node count + nps (OpenBench format)

# Web
npm install
npm run dev        # editor at http://localhost:5173
npm test           # codegen unit tests (includes: reference == generator output)
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
writes `params.rs` from the block catalogue, and vendors the runtime crate,
producing a standalone Cargo project.

## Status

Sprint 2 (workspace model + code generator). See the MVP plan doc in the
Claude project for scope and the sprint roadmap.
