# Saving and sharing

## Where your work is kept

| What | Where |
|---|---|
| Your current canvas | saved in your browser after every change. Close the tab and it's still there. |
| Your blocks | in **My blocks**, also in your browser, for every project. |
| A project | **Save** downloads a `.cfs` file. |
| The Rust code | **Export Rust project** downloads a zip. |

Your browser's storage is not a backup. Clearing your browser data removes it. Save a `.cfs` file of anything you want to keep.

## .cfs files

**Save** gives you one `.cfs` file with your canvas and all your own blocks inside. **Open** reads it back, on this computer or another one. Blocks you don't have yet are added to **My blocks**.

A `.cfs` file is a zip. Inside are `workspace.json` and your blocks as files in `blocks/<slot>/`.

## My blocks

Every block you make or change is kept in **My blocks**, sorted in folders per slot (and **Skeleton versions** for your own Engine, Negamax and so on). Each folder shows three groups:

- **In this project**: blocks on your canvas now.
- **Saved in your browser**: your other blocks.
- **Examples**: blocks that come with the app.

To use a block in another project, open **My blocks** and drag it in.

## Sharing one block

- **Send a block**: right-click it and pick **Export block file**. You get one `.block.rs` file.
- **Get a block**: **My blocks > New or import > Import block file…**, or **Open** at the top.
- **Copy a block**: open it in the editor and change its `id` (and `label`). Saving under a new id makes a new block.
- **Clean up**: right-click a block and pick **Remove from My blocks**. Projects that use it keep their own copy.

## In the exported project

The exported Rust project also has `workspace.json` and a `blocks/` folder. Open `workspace.json` in the app to keep working on it.
