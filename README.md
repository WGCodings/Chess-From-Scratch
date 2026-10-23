# Chess From Scratch

**Build your own chess engine by putting blocks together.**

Chess From Scratch is a drag-and-drop editor, a bit like Scratch, for making
chess engines. Every block is real Rust code: drop in a search, add pruning
and an evaluation, and watch the code change as you go. When you are happy,
download your engine as a normal Rust project, build it, and play against it
in any chess program. The engine you make is yours.

It is made for beginners. You don't need to know Rust to start: the built-in
tutorial walks you from an empty canvas to an engine you can play against in
about ten minutes.

## Try it

Open **[chessfromscratch.wgcodings.com](https://chessfromscratch.wgcodings.com)**
(coming soon) and click **Tutorial**. Nothing to install: it all runs in your
browser, and your work stays on your computer.

To build and play your engine you need [Rust](https://rustup.rs). The tutorial
shows you how.

## What you can do

- Start from an empty canvas, a starter engine, or an engine with every block.
- Add blocks one at a time: alpha-beta, null move pruning, late move
  reductions, quiescence search, killers, a tapered evaluation and more.
  Right-click any block to see what it does, line by line.
- Change any block, write your own, and build one on top of another.
- Write code in VS Code: link a folder and your changes come back as blocks.
- Export a complete Rust project with a `bench` command, ready for
  [fastchess](https://github.com/Disservin/fastchess) and
  [OpenBench](https://github.com/AndyGrant/OpenBench).

## Learn more

The **[guide](https://github.com/WGCodings/Chess-From-Scratch/wiki)** explains
everything in simple steps: your first engine, the blocks, changing and making
blocks, building and testing. It is also in the app (**Guide** at the top).

## Feedback

Found a bug, got stuck, or have an idea? Please
[open an issue](https://github.com/WGCodings/Chess-From-Scratch/issues). Want
to help with the code? See [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Run it yourself

```sh
npm install
npm run dev
```

Then open http://localhost:5173. To host it, see [deploy/README.md](deploy/README.md).

## License

The app is open source under the [GNU AGPL v3](LICENSE). The Rust code that
ends up in your engine (the templates and example blocks) is MIT licensed, and
every exported engine comes with an MIT license in your name.
