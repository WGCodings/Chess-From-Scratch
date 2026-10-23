# Changing a block

Every block in the app can be changed. You never change the original. You make **your own version** of it, and your version takes its place in your engine.

## Make your own version

1. Put the block in your engine, say **Null move pruning**.
2. Right-click it and pick **Edit this block (make your own version)**.
3. The block editor opens with a copy of its code. Change what you like.
4. Click **Save block** (or press Ctrl+S).

Your version replaces the original on the canvas. It keeps the same numbers you had set. It is marked with ✎, and it is saved in **My blocks** so you can use it in other projects.

If you don't change anything, your version makes exactly the same engine as the original.

## Add a number you can set

Say you want a new setting for your Null move pruning. Add a line under `params:` at the top:

```
//!   NMP_EXTRA: i32 = 4 (1..10) "Extra reduction"
```

That reads: a whole number called `NMP_EXTRA`, starting at 4, from 1 to 10, shown on the block as *Extra reduction*. Then use it in the code:

```rust
let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + depth / NMP_EXTRA;
```

Save, and the block gets a new field.

## Lines that belong to other blocks

Inside your version you may see lines like these. Leave them where they are:

- `// @block killers` and `// @end killers`: code of another block that sits inside this one.
- `// @builtin killers`: one line that stands for the code of Killers. You haven't added Killers yet. When you do, its code appears at that spot.
- `// @until late_move_reductions` ... `// @end late_move_reductions`: the code between them runs *until* you add Late move reductions. Then that block's code takes over.

Because of these lines, a version you make early keeps working when you add more blocks later.

## Changing the skeleton

The big blocks are blocks too: **Engine**, **Negamax search**, **Random mover**, **Hand-crafted evaluation**, **Tapered evaluation**, **Transposition table** and the time blocks. Right-click and pick **Edit this block** to make your own.

For example, make your own **Tapered evaluation** and change `PHASE_MAX` or `PHASE_WEIGHT`. The blocks plugged into it stay where they are.

## Changing code directly

You can also change code in the code view, or in VS Code. When you change lines inside a block, the app asks what you want:

- **Change the block** (or make your own version of a built-in one), or
- **New block on top of it**: the old block stays as it is, and your change becomes a new block. See [Blocks on top of blocks](Blocks-On-Top-Of-Blocks).

More in [Coding in VS Code](Coding-In-VS-Code).

## Going back

To go back to the original, delete your version from the canvas and drag the original block in again. Your version stays in **My blocks** until you right-click it and pick **Remove from My blocks**.
