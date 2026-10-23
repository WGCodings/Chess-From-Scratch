# Blocks on top of blocks

Engines grow one idea at a time. Often a new idea changes the code of an older one. Principal variation search changes how Alpha-beta searches a move. Late move reductions then change Principal variation search again.

You can build your own blocks the same way. A block that **requires** another block can change that block's lines. It doesn't have to know about blocks that come later.

## The easy way: New block on top

1. Right-click the block you want to build on, say *My alpha-beta pruning*.
2. Pick **New block on top of this one** and give the new block a name, for example *My PVS*.
3. The code view opens at that block's code. Change the lines you want.
4. Click **Save as blocks**.

Your changes become a new block. The block you built on stays exactly as it was. The new block is placed right below it, in the same slot.

You can do this again on top of *My PVS*, and so on.

## What the new block looks like

```rust
//! ---
//! id: my_pvs
//! label: My PVS
//! slot: move_loop
//! requires: my_alpha_beta
//! ---

// @replace search.rs "let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);"
let mut score;
if i == 0 {
    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
} else {
    score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);
    if score > alpha && score < beta {
        score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);
    }
}
```

`requires: my_alpha_beta` says it builds on *My alpha-beta pruning*. `@replace` says: take this exact line and put my code there instead.

The next block, *My LMR*, would say `requires: my_pvs` and change a line of *My PVS*:

```rust
// @insert search.rs before "score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);"
let r = if depth >= 3 && i >= 3 && quiet { 1 } else { 0 };

// @replace search.rs "score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);"
score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);
if score > alpha && r > 0 {
    score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);
}
```

## The three ways to change lines

| Line | What it does |
|---|---|
| `// @replace search.rs "a line"` | puts your code where that line was |
| `// @replace search.rs "first line" to "last line"` | puts your code where those lines were |
| `// @insert search.rs before "a line"` | adds your code above that line |
| `// @insert search.rs after "a line"` | adds your code below that line |

The line in quotes must match a line of the code exactly, but spaces at the start don't matter. If the same line appears twice, add `#2` after the quotes to pick the second one. Only lines that are really in your engine count.

## What happens when you remove blocks

- Remove the top block (*My LMR*) and the lines it changed come back as they were.
- Remove a block in the middle (*My PVS*) and the block on top of it (*My LMR*) turns red in Status: "My LMR needs My PVS".
- If you change a line in *My alpha-beta pruning* that *My PVS* replaces, Status tells you: "My PVS: the line ... is not in search.rs". Change the line in *My PVS* to match, or undo your change.

## Two blocks changing the same line

Two blocks that don't know about each other can't both change the same line. The second one can't find its line any more. Make one require the other, like *My LMR* requires *My PVS* above.
