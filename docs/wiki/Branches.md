# Branches: try ideas safely

A branch is a copy of your engine where you try an idea. If the idea works, you **keep** it and it becomes your main version. If it doesn't, you **delete** it. Your main version is never touched while you try.

Click **⑂ main** at the top to open the Branches panel.

## Try an idea

1. Type a name for the idea, for example `+ killers` or `LMR base 0.8`.
2. Click **Clone "main"**. You are now on the new branch: the button at the top shows its name.
3. Change the engine: add a block, change a number, edit code.
4. Open the panel again. Your branch lists every change it made, for example:
   - `+ Killer moves`: a block added
   - `− Null move pruning`: a block removed
   - `Late move reductions: Base 0.75 → 0.8`: a number changed
   - `My LMR: code changed`: your own block's code changed

## Keep it or delete it

- **Keep** makes the branch your main version and closes the branch.
- **Delete** throws the branch away.

Both ask first. If the main version changed after you cloned it, **Keep** tells you what would be replaced.

You can have several branches at once: one idea each. **Open** switches the canvas to another branch. Double-click a branch's name to rename it.

## Is my idea better?

Build and play both versions. In the [desktop app](The-Desktop-App), **▶ Run** builds the open branch in its own folder, so the main version and the branch both stay built. See [Build, test and play](Build-Test-Play) for testing one against the other. Testing branches against each other with one click is coming to the desktop app.

## History

The bottom of the panel shows everything you did: clones, keeps (with what they changed), deletes and renames. It is saved with your project, so weeks later you can still see how your engine grew.

## Saving

All branches and the history are saved with your project: in your browser (or the app) after every change, and in the `.cfs` file when you click **Save**. See [Saving and sharing](Saving-And-Sharing).
