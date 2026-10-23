# The desktop app

Chess From Scratch comes in two versions:

- **The website** is the demo. You build engines with blocks and export them as Rust projects. Nothing to install.
- **The desktop app** is the full program. It does everything the website does, and it also builds, runs and tests your engine for you. It works offline.

Both use the same editor, so everything in this guide works in both.

## Install it

1. Download the installer for your computer from the [Releases page](https://github.com/WGCodings/Chess-From-Scratch/releases/latest):
   - Windows: the `.msi` or `-setup.exe` file.
   - macOS: the `.dmg` file.
   - Linux: the `.AppImage`, `.deb` or `.rpm` file.
2. Install Rust once from [rustup.rs](https://rustup.rs). The app uses it to build your engine.

**Windows says "Windows protected your PC".** The app is new and not signed yet. Click *More info > Run anyway*.

**macOS says the app "can't be opened".** Right-click the app, choose *Open*, then *Open* again. You only do this once.

## Run your engine

Click **▶ Run** in the top bar (or right-click the Engine block and pick *Run this engine*, or press **Ctrl+Enter**).

The panel at the bottom opens. The app:

1. writes your engine's project to a folder,
2. builds it with `cargo build --release` (the first build takes a minute; later builds are quick),
3. starts it, and sends `uci`.

Now talk to it. Click a button, or type a command and press **Enter**:

| Button | What it sends |
|---|---|
| uci | the engine says its name and `uciok` |
| isready | the engine says `readyok` |
| ucinewgame | a new game: forget the last one |
| position startpos | the starting position |
| d | draw the board |
| go depth 6 | search 6 moves deep (change the number next to it) |
| go movetime 1000 | think for 1000 milliseconds |
| stop | stop thinking |
| bench | the fingerprint and speed (see [Build, test and play](Build-Test-Play)) |

To try a position, paste a FEN in the long box and click **Set position**.

Press **↑** in the command box to get earlier commands back.

Changed some blocks? Click **↻ Rebuild**: the app builds the new version and restarts it. **■ Stop** stops the engine.

## The terminal

Click **Terminal** in the top bar (or press **Ctrl+`**). It opens a terminal in your engine's folder, so you can run any command there, for example `cargo build --release` or `git init`.

**Folder** in the panel shows the folder in your file manager. Open it in VS Code to work on the code (see [Coding in VS Code](Coding-In-VS-Code)).

## Where your engine is kept

Each engine gets its own folder, named after the engine:

- Windows: `C:\Users\<you>\AppData\Local\com.wgcodings.chessfromscratch\engines\`
- macOS: `~/Library/Application Support/com.wgcodings.chessfromscratch/engines/`
- Linux: `~/.local/share/com.wgcodings.chessfromscratch/engines/`

The built program is in `target/release/` inside that folder. Add it to a chess GUI to play against it.

Your blocks and projects are saved inside the app, like on the website. Use **Save** to keep a `.cfs` file of a project.

## Coming next

Testing two versions of your engine against each other (SPRT, with fastchess) is coming to the desktop app.
