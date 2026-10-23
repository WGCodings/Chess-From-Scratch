# Your first engine

In this page you build the simplest engine there is: one that plays a random legal move. It is a weak player, but it is a real engine. Every engine you make after this one should beat it.

The app has the same steps built in. Click **Tutorial** at the top and it checks each step for you.

## 1. Start with an empty canvas

Open the app. If there are blocks on the canvas, pick **New > Empty (just the engine)**, or delete them.

## 2. Add the Engine block

Click **Engine** in the drawer on the left. Drag the **Engine** block onto the canvas.

The Engine block is the root of everything. It has three places to plug things in:

- **settings**: time management and a transposition table (you don't need them yet),
- **search**: how the engine picks a move,
- **evaluation**: how it judges a position.

Click *My Engine* on the block and type a name. The name becomes the name of your program, so keep it short.

## 3. Add a search

Open **Search** in the drawer and drag **Random mover** into the **search** slot of the Engine block. It clicks into place.

Look at **Status** at the bottom right. It turns green: your engine is complete. A random mover doesn't need an evaluation.

## 4. Look at the code

The right side of the screen shows the Rust project your blocks make. Click `src/search.rs`.

Find the function called `search`. This is what happens when a chess program asks your engine for a move:

```rust
let mut moves: Vec<Move> = Vec::new();
pos.board().generate_moves(|list| {
    moves.extend(list);
    false
});
let best_move = if moves.is_empty() {
    None
} else {
    Some(moves[(self.next() % moves.len() as u64) as usize])
};
```

In plain words: ask the board for all legal moves, put them in a list, and take one at a random spot in that list.

Two more files are worth a look:

- `src/uci.rs` reads commands from the chess program, like `position` and `go`, and answers with `bestmove`.
- `src/main.rs` is where the program starts.

You will see lines like `// @block random_mover` and `// @end random_mover`. Everything between them belongs to the Random mover block. Remove the block and that code is gone too.

## 5. Get the project onto your computer

You have two choices.

**Export (works everywhere).** Click **Export Rust project**. You get a zip file. Unzip it somewhere.

**Link folder (Chrome and Edge).** Click **Link folder** and pick an empty folder. The app writes the project there and keeps it up to date. Open that folder in VS Code with *File > Open Folder*. See [Coding in VS Code](Coding-In-VS-Code).

## 6. Install Rust (only once)

Go to [rustup.rs](https://rustup.rs) and follow the steps. On Windows, run `rustup-init.exe` and press Enter to accept the defaults.

Open a **new** terminal and check that it worked:

```
cargo --version
```

## 7. Build it

Open a terminal in the project folder. In VS Code that is *Terminal > New Terminal*. Then run:

```
cargo build --release
```

The first time takes a minute, because it downloads the chess library (cozy-chess). After that it is quick.

Your engine is now a program in `target/release`. On Windows it ends in `.exe`.

## 8. Talk to it

Start it and type a few commands, one per line:

```
cargo run --release
uci
position startpos
go
quit
```

After `uci` it says its name and `uciok`. After `go` it answers with a move, like `bestmove g1f3`.

## 9. Play against it

Add the program to a chess GUI:

- **En Croissant**: *Engines > Add new > Local*, then pick the file from `target/release`.
- **Cute Chess**: *Tools > Settings > Engines*, click **+**, pick the file. Then *Game > New*.
- **Arena**: *Engines > Install New Engine*.

Now play. You should win easily.

## What next?

Make it smarter, one block at a time:

1. Swap **Random mover** for **Negamax search**, and plug a **Hand-crafted evaluation** with **Material** into the evaluation slot. Now it looks ahead and counts pieces.
2. Add **Iterative deepening**, so it uses its thinking time well.
3. Add **Alpha-beta pruning**. It finds the same moves much faster, so it can look deeper.

After each step, build again and let the new version play the old one. Right-click any block and pick **Explain this block** to learn what it does.
