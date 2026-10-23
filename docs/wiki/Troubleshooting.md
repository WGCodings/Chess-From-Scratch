# Problems and fixes

## In the app

**The code view says "No code yet".**
Your engine isn't complete. Look at Status: the red line says what's missing. Usually it's a search block (Random mover or Negamax search), or an evaluation for Negamax.

**A block won't click into a slot.**
It belongs in a different slot, or it must go below another block. For example, Principal variation search only fits under Alpha-beta pruning.

**A block in the drawer is faded.**
It needs another block first. Hover over it to see which one.

**A block on the canvas is faded.**
It isn't connected to the Engine block, so it is ignored. Drag it into a slot.

**I don't see the Tutorial offer.**
It is only offered once. Click **Tutorial** at the top any time.

**My canvas is gone.**
Your work is stored in this browser only. A different browser, a private window, or cleared browser data starts empty. Keep `.cfs` files of your projects.

**"Link folder" is missing.**
It only works in Chrome and Edge. Use **Export Rust project** instead.

**My edit in VS Code doesn't come back.**
Check the top bar says *Linked*. After a reload, click **Reconnect**. If the app shows a problem list, fix the file and save again.

## Building

**`cargo` is not found.**
Install Rust from [rustup.rs](https://rustup.rs), then open a **new** terminal.

**The first build is slow.**
It downloads and builds the chess library once. Later builds are quick.

**The program doesn't start on another computer.**
The project is built for your computer's processor. Delete `.cargo/config.toml` and build again.

**Windows says the program is unsafe.**
Windows warns about any new program it hasn't seen. Click *More info > Run anyway*, or add the engine through your chess GUI.

**A build error mentions my block.**
The error shows a file and line. Find the `// @block your_block` markers around it, then fix the code in your block (double-click the line in the app to open it).

## Playing

**The engine makes random moves.**
That's the Random mover. Swap it for Negamax search with an evaluation.

**The engine doesn't use its time.**
Add **Iterative deepening**. Without it, Negamax searches a fixed depth on every move.

**The engine is very slow.**
Build with `--release`. Without Alpha-beta pruning, searches deeper than 4 or 5 moves take a long time.

## Still stuck?

Open an issue and tell us what happened: see [Feedback and contributing](Feedback-And-Contributing).
