# Build, test and play

In the [desktop app](The-Desktop-App), **▶ Run** does the building and gives you buttons for the commands below. This page shows how to do it yourself, which works for projects exported from the website too.

## Build

You need Rust. Install it once from [rustup.rs](https://rustup.rs).

In the project folder (exported zip, or your linked folder), run:

```
cargo build --release
```

Always use `--release`. Without it the engine is about ten times slower.

Your engine is in `target/release/`, named after your engine (on Windows with `.exe`).

The project is built for your own computer's processor, which makes it as fast as possible. To build a program that runs on other computers too, delete the file `.cargo/config.toml` first.

## Talk to it

```
cargo run --release
```

Then type commands, one per line:

| Command | What it does |
|---|---|
| `uci` | the engine says its name and `uciok` |
| `isready` | the engine says `readyok` |
| `position startpos` | set up the starting position |
| `position startpos moves e2e4 e7e5` | the starting position after these moves |
| `go depth 6` | search 6 moves deep and answer `bestmove` |
| `go movetime 1000` | think for one second |
| `quit` | stop |

## Bench

```
./target/release/your-engine bench
```

`bench` searches a fixed set of positions and prints something like `150455 nodes 1519747 nps`. The first number is your engine's fingerprint. It only changes when the search or evaluation changes. The second is its speed (nodes per second), which changes from computer to computer.

Use it to check a change. Made your own version of a block but didn't mean to change how it plays? The node count should stay the same.

## Play against it

Add the program to a chess GUI:

- [En Croissant](https://encroissant.org): *Engines > Add new > Local*.
- [Cute Chess](https://cutechess.com): *Tools > Settings > Engines > +*.
- Arena: *Engines > Install New Engine*.

Let two versions play each other there too, to get a first feeling.

## Did my change make it stronger?

A handful of games tells you very little. Engines are tested with thousands of fast games, until the result is clear. In the desktop app, **Tests** does all of this for you: see [Testing your changes](Testing-Changes). By hand, the usual tool is [fastchess](https://github.com/Disservin/fastchess):

1. Build the old version and copy the program to `old` (or `old.exe`).
2. Make your change, build again and copy it to `new`.
3. Get an opening book, for example `UHO_Lichess_4852_v1.epd` from the [Stockfish books](https://github.com/official-stockfish/books).
4. Run:

```
fastchess -engine cmd=./new name=new -engine cmd=./old name=old \
  -each tc=8+0.08 -rounds 10000 -repeat -concurrency 4 \
  -openings file=UHO_Lichess_4852_v1.epd format=epd order=random \
  -sprt elo0=0 elo1=5 alpha=0.05 beta=0.05
```

It plays until it is sure enough. *H1 accepted* means the new version is better. *H0 accepted* means it isn't (or not by much).

Set `-concurrency` to the number of processor cores you want to use.

If you have an [OpenBench](https://github.com/AndyGrant/OpenBench) server, it uses the `bench` command above to check your builds.
