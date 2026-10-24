# Playing your engine

Click **Play** at the top, next to **Engine** and **Tests**. You play a branch of your engine on the board, or let two branches play each other. This needs the [desktop app](The-Desktop-App): it builds the branch and runs it on your computer.

## Start a game

1. Pick **You vs your engine** or **Engine vs engine**.
2. Pick the branch to play against (or a branch for White and one for Black). Each [branch](Branches) is a version of your engine, so you can play the old and the new one.
3. Pick your color: White, Black or Random.
4. Pick the time:
   - **Clock**: minutes for the whole game plus seconds added per move, like `3+2`. The engine manages its own time; this needs **Iterative deepening** in the engine.
   - **Seconds per move**: the engine thinks this long each move.
   - **Depth per move**: the engine searches this many moves deep. Good for engines without Iterative deepening.
5. Leave **Start position** empty for a normal game, or paste a FEN to start from any position.
6. Click **▶ Start game**.

Move by dragging a piece, or click it and then the square. A pawn that reaches the end asks which piece it becomes.

## During the game

- The **clocks** run above and below the board. The side to move is green; under 10 seconds it turns red.
- **What the engine thinks** is shown on the right: its score (from White's view: `+1.50` means White is a pawn and a half better, `#3` mate in 3), how deep it searched, how many positions it looked at, and the line it expects.
- The **bar** left of the board shows the score: more white means better for White.
- **↶ Take back** undoes your last move (and the engine's reply).
- **⇅ Flip** turns the board around.
- **⚑ Resign** gives up. In an engine game, **■ Stop** ends it.

The game ends by checkmate, stalemate, threefold repetition, the 50-move rule, too little material to mate, or a flag (time runs out).

## After the game

- **Rematch** plays the same game again. **New game** goes back to the settings.
- **Copy PGN** copies the game. Paste it into [Lichess](https://lichess.org/paste) to look at it with a strong engine.
- **Copy FEN** copies the position on the board, for example to start a new game from it.
- **Engine output** shows everything the engines said.

## Good to know

**The engine plays the same moves every time.** Most engines here are deterministic. Start from different positions (a FEN) to see more variety.

**It plays fast but badly?** A beginner engine has no opening book and a small search. That is the fun part: add a block in a branch, play it again, and [test](Testing-Changes) it.

**Running and playing at once is fine.** **▶ Run**, Play and tests each run their own engines.
