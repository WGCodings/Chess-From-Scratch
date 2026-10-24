# Testing your changes

Did your change make the engine stronger? A few games can't tell you: the stronger engine loses often enough by luck. Engine developers play thousands of fast games and stop as soon as the result is clear. That is an **SPRT** test. The [desktop app](The-Desktop-App) runs one for you with [fastchess](https://github.com/Disservin/fastchess), the tool most engine developers use.

## Run a test

1. Make a [branch](Branches) and change it, for example add **Killer moves**.
2. Click **Tests** at the top, next to **Engine**. Tests is its own view; click **Engine** to go back to your blocks.
3. Pick the **New version** (your branch) and the **Base version** (usually *main*). Under *What is tested* you see exactly what differs.
4. Pick a preset:
   - **VSTC** (very short time control): 5+0.05 seconds a game, bounds [0, 10]. Finds big gains fast; good for a new block.
   - **STC** (short time control): 10+0.1, bounds [0, 5], like OpenBench's STC.
   - **LTC** (long time control): 60+0.6, bounds [0, 5], for changes that only help with more time.
   - **STC Regression**: 10+0.1, bounds [−5, 0]. Passes when the new version is not weaker, for code you cleaned up.
5. Click **▶ Start test**.

The first time, the app downloads fastchess and an opening book (a few MB). Then it builds both versions, runs `bench` on both, and starts playing.

## Read the result

- **Elo**: how much stronger the new version is, with its error margin. `+25.0 ± 8.0` means probably between +17 and +33.
- **Games** and **wins / draws / losses** of the new version.
- **The bar** is the test's progress (the LLR). At the right end the test **passes**: the new version is better. At the left end it **fails**: it isn't, or not by enough.
- **bench new / base**: the two node counts. The same number means the change didn't change the search at all.

**■ Stop** ends a test early. The result so far is kept, without a verdict.

Below the numbers are three graphs:

- **Elo of the new version** as the games went by, with its error margin as a band. It wobbles at first and settles as games are added.
- **LLR**: the test's progress, between the *fails* and *passes* lines.
- **Game pairs (pentanomial)**: each opening is played twice, once with each color. The bars count how many pairs the new version scored 0, ½, 1, 1½ or 2 points in. More on the right is better.

## Watch the games

Tick **Watch the games live** before you start, and every game being played gets its own small board, with the players and their clocks. With 10 games at once you see 10 boards.

Watching costs speed: fastchess writes every message between it and the engines to a log for the boards, and drawing many boards keeps your computer busy. The result is still valid, but the test runs slower, and at very short time controls with many games at once engines may lose on time. Leave it off for serious tests.

## Then

- **Passed**: click **Keep**. You see every change in the code first, then the branch becomes your main version.
- **Failed**: click **Delete**, or keep working on the branch and test again.

## The timeline

Every test is listed under **Timeline**, newest first: what was tested, the result, and what you did with it. Click a test to see it again: its result and graphs, its settings (time control, book, SPRT bounds and so on), what was tested, and the code diff of the two versions as they were then.

When you keep branches that passed, a chart shows how much Elo your main version gained over time, with error bars. Click its title to show or hide it.

The timeline is saved in your project, so it's also there on the website. Running tests needs the desktop app.

## Settings

| Setting | What it does |
|---|---|
| Time control | Seconds per game + seconds added per move, e.g. `10+0.1` |
| Games at once | Games played at the same time. At most one per processor core. |
| Hash | Transposition table size, for engines with a **Transposition table** block |
| Threads | Threads per engine (1 for engines made here) |
| Max games | Stop here even without a verdict |
| Opening book | Each game pair starts from a random opening, once with each color. **UHO 4060 v2** (as OpenBench uses) or **8 moves v3**, or your own `.epd` or `.pgn` file |
| SPRT bounds | `elo0` / `elo1`: the test passes when the new version is likely better by `elo1`, and fails when it is likely not better than `elo0` (normalized Elo) |
| alpha / beta | The chance of a wrong pass / a wrong fail (0.05 each) |
| Adjudicate | Ends clearly won games and dead draws early, as OpenBench does |

## Good to know

**Add Iterative deepening first.** Without it, Negamax searches a fixed depth, ignores the clock and loses games on time. The app warns you.

**Lost on time, crashed or illegal moves?** The result shows how many games ended that way. Check the engine with **▶ Run**.

**Big gains first.** A beginner engine gains a lot from each new block, so quick tests finish fast. Small tweaks need many more games.
