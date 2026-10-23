# Coding in VS Code

You don't have to write code in the app. You can write it in VS Code (or any editor), and the app turns it into blocks. You can also edit right in the app's code view.

## Link a folder (Chrome and Edge)

1. Click **Link folder** at the top and pick an empty folder.
2. The app writes the whole project there. The top bar says *Linked to (your folder)*.
3. In VS Code, use *File > Open Folder* and open that folder.

Now the app and the folder stay in sync:

- Change blocks in the app, and the files in the folder change.
- Save a file in VS Code, and within a few seconds the app picks it up.

For the best help while typing, install the **rust-analyzer** extension in VS Code. It knows everything about cozy-chess.

After a reload, the app remembers the folder. Click **Reconnect (folder)** in the top bar.

## Edit code in the app

Click **Edit code** above the code view. The file becomes editable. Click **Save as blocks** (or press Ctrl+S) when you're done, or **Cancel**.

While typing:

- **Tab** indents. **Format** (Shift+Alt+F) fixes all indentation.
- **Ctrl+Space** shows suggestions: names you can use, cozy-chess methods, your parameters. **Tab** or **Enter** picks one.
- Inside the brackets of a function call, a small box shows what the function wants, like `piece_on(square: Square)`.

## What happens when you save

**New code** must sit between two marker lines, with a name you choose:

```rust
// @hook extensions
// @block my_check_ext
if !pos.board().checkers().is_empty() {
    extension += 1;
}
// @end my_check_ext
```

- Right below a ⚓ hook line, it becomes a new block at that hook, in the slot with the same name.
- Anywhere else, it becomes a block that inserts after the line above it.
- Typed inside one of your own blocks, it becomes a block that builds on that block.
- A comment line right above `// @block` goes into the block as its explanation.

**Changes inside an existing block** make the app ask you:

- **Change the block**: your block file is updated. For a built-in block, you get your own version of it.
- **New block on top of it**: the block stays as it is, and your change becomes a new block. See [Blocks on top of blocks](Blocks-On-Top-Of-Blocks).

**Names in CAPITALS** that nothing defines, like `MY_LIMIT`, become numbers you can set on the block. They start at 1.

**Only indentation changed?** Nothing happens. Formatters are fine.

## When the app can't use your change

Some edits can't become blocks, for example code outside any `// @block` lines, or a deleted `// @end` line of a built-in block. The app shows a list of problems with the file and line. In the app, fix them and save again. In VS Code, your file is left as it is; fix it and save again.

## Editing block files

The folder has a `blocks/` folder with your block files, one folder per slot: `blocks/pruning/my_block.block.rs`. Change one and save, and the block updates in the app. Put a new `.block.rs` file there and it is added to **My blocks**.
