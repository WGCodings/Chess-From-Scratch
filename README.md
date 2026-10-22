# Chess From Scratch (CFS)

A drag-and-drop editor for building UCI chess engines, aimed at beginner engine
developers. Blocks in the browser, real Rust underneath: a workspace exports to a
complete Cargo project that you compile and fully own.

## Repository layout

```
crates/
  cfs-runtime/     MIT runtime shipped inside every exported engine (cozy-chess, UCI, TT, bench)
  cfs-reference/   hand-written reference engine; codegen must match its bench node count
packages/
  codegen/         workspace -> Rust project generator (TypeScript, no UI dependencies)
apps/
  web/             Blockly editor (Vite + TypeScript)
```

## Requirements

- Rust stable (1.80+)
- Node 20+ and npm

## Common commands

```sh
# Rust
cargo test --release                       # includes perft checks
cargo run --release -p cfs-reference -- 5  # perft 5 from the start position

# Web
npm install
npm run dev        # editor at http://localhost:5173
npm test           # codegen unit tests
npm run build      # typecheck + production build
```

## Status

Sprint 0 (project setup). See the MVP plan doc in the Claude project for scope
and the sprint roadmap.
