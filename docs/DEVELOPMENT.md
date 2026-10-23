# Developing Chess From Scratch

This page is for people who want to work on the app itself. To *use* the app,
see the [guide](https://github.com/WGCodings/Chess-From-Scratch/wiki).

## Repository layout

```
apps/
  web/             the editor (Vite + TypeScript + Blockly + CodeMirror) and the guide page
  desktop/         the desktop app (Tauri 2): the same editor plus build, run and a terminal
packages/
  codegen/         block catalogue, workspace format, Rust templates and project generator
    templates/     every line of Rust an engine can contain (search, eval, uci, tt, ...)
    examples/      example block files shown under My blocks
crates/
  cfs-reference/   generator output for the "every block" engine, with unit tests (bench 150455)
docs/wiki/         the guide (shown in the app at guide.html and published as the GitHub wiki)
deploy/            nginx config for the Docker image; notes on hosting it yourself
```

## Requirements

- Node 20+ and npm
- Rust stable (1.80+), for the Rust tests and `check:generated`

## Commands

```sh
npm install
npm run dev        # the editor at http://localhost:5173 (the guide at /guide.html)
npm test           # generator and editor unit tests
npm run build      # typecheck + production build into apps/web/dist

npm run gen:reference -w @cfs/codegen     # regenerate crates/cfs-reference/src from the templates
npm run check:generated -w @cfs/codegen   # generate, fmt, clippy, build and bench every block setup
npm run e2e -w @cfs/web                   # the editor in Chrome (set CHROMIUM_PATH for another Chromium)

cargo test --release                      # perft and unit tests for all template code
cargo build --release -p cfs-reference
./target/release/cfs-reference bench      # deterministic node count + nps (OpenBench format)
```

## The desktop app

The website is the demo; the desktop app is the full product. Both are the
same editor (`apps/web`): there is no second UI. The editor asks
`apps/web/src/platform.ts` what it can do. On the website `desktop` is null
and desktop features (Run, Terminal) explain the app; in the app it calls the
Rust commands in `apps/desktop/src-tauri/src` (write the project, cargo build,
run the engine, a terminal through a pseudo-terminal). New desktop features:
add a command in Rust, a method on the `Desktop` interface, and the UI in
`apps/web` once.

Extra requirements: the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
(on Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev`).

```sh
npm run desktop                    # the app, with the editor hot-reloading from Vite
npm run desktop:build              # installers in apps/desktop/src-tauri/target/release/bundle
npm run selftest -w @cfs/desktop   # builds the debug app and drives it: Run, UCI, bench, terminal
cd apps/desktop/src-tauri && cargo test
```

The browser tests fake the desktop with `window.__cfsDesktopMock` (see
`apps/web/e2e/run.mts`). Releases: push a tag `vX.Y.Z` and the *Desktop
release* workflow attaches the installers to a draft release.

## How code generation works

A workspace (`packages/codegen/src/workspace.ts`) lists the engine settings,
the search and evaluation skeleton, the blocks in each slot and your own
blocks. The generator renders the Rust templates, keeping each placed block's
region (between `// @block <name>` and `// @end <name>`) and the `// @else`
fallback of missing ones, applies custom blocks (versions of built-in blocks,
hooks, inserts and replacements, in the order of what they require), and
writes `params.rs` from the block parameters. The result is one flat Cargo
crate with only `cozy-chess` as a dependency and only the code the placed
blocks need. The generator also reports which block owns each line, which the
editor uses for its tours and for turning edited code back into blocks
(`packages/codegen/src/fromcode.ts`).

The reference crate uses every built-in block. Its `src/` is generated: edit the
templates and run `npm run gen:reference -w @cfs/codegen`. Its `bench` node count
(150455 at the default depth) must not change unless a change means to.

## Tests

- `npm test`: unit tests, including `packages/codegen/src/scenarios.ts`, a
  catalogue of user workflows (new blocks at every hook, inserts, edits to
  your own and built-in blocks, blocks on top of blocks, mistakes) checked for
  the blocks they produce, "what you typed is what you get" and idempotence.
- `npm run check:generated -w @cfs/codegen`: every scenario and block
  combination is generated, formatted, linted with clippy, built and benched.
- `npm run e2e -w @cfs/web`: the editor in Chrome, including the tutorial,
  Edit code, the block editor, linked folders and `.cfs` files.

## The guide

The pages in `docs/wiki/` are plain Markdown with wiki-style links
(`[text](Page-Name)`). The app shows them at `guide.html`; to publish them to
the GitHub wiki, run `scripts/publish-wiki.ps1` (Windows) or
`scripts/publish-wiki.sh`.
