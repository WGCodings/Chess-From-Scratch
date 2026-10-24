# The canvas

The canvas is the big area in the middle where you put blocks together. On the left is the **drawer** with all blocks. On the right you see the **code** your blocks make, and **Status** below it.

## The drawer

Click a category, like **Pruning**, and its blocks slide out. Drag a block onto the canvas. The drawer stays open, so you can drag several blocks. Click the category again, or press **Esc**, to close it.

To delete a block, drag it back onto the drawer, or select it and press **Delete**.

At the top of the drawer is a search box. Type a word like *check* or *pruning* and it shows the blocks that match.

A grey, faded block in the drawer can't be used yet: it needs another block first. Hover over it to see which one. For example, most pruning blocks need **Alpha-beta pruning**.

## The main blocks

| Block | What it is |
|---|---|
| **Engine** | The root. Your engine's name, author and bench depth. Everything else plugs into it. |
| **Random mover** | A search that picks a random legal move. Good for a first engine. |
| **Negamax search** | A real search. It looks a fixed number of moves ahead (the *Depth* on the block). It has slots for search blocks. |
| **Hand-crafted evaluation** | Judges a position by adding up *terms*, like material. |
| **Tapered evaluation** | Plug into *blend by phase*. Without it only the middlegame values count; with it, values slide from middlegame to endgame as pieces come off. |
| **Basic time** / **Soft/hard time management** | How long to think. Without a time block the engine uses its time left divided by 40. Time only matters once you add **Iterative deepening**. |
| **Transposition table** | Remembers positions it has already searched. Needs Alpha-beta pruning. |

## Slots

Negamax search has a slot for each moment in the search:

| Slot on the block | When its blocks run |
|---|---|
| at the root | once, at the start of a search |
| before the move loop | before trying any move in a position (pruning) |
| order moves by | when deciding which move to try first |
| extend moves | after a move is made: search it deeper? |
| move loop | after a move was searched |
| reduce late moves | after a move is made: search it less deep? |
| at depth 0 | when the search reaches the end of its depth |

Blocks only fit where they belong. If a block doesn't click into a slot, it belongs somewhere else.

Some blocks must sit **below** another block in the same slot. For example, **Principal variation search** only fits under **Alpha-beta pruning**, because it builds on it.

## Status

Status tells you if your engine is ready.

- **Red** means something is missing, like a search. There is no code to show until you fix it.
- **Yellow** is a tip, like "add Material".
- **Green** means the engine is complete and ready to export.

## Templates

**☰ > New from template…** (top left) gives you a start:

- **Empty**: just the Engine block. Nothing else.
- **Starter engine**: Negamax search and an empty evaluation. Add blocks yourself.
- **Every block**: everything at once, the strongest engine the app can make.

## Learning what a block does

Right-click a block and pick **Explain this block**. You get a short explanation and a walk through every line of code it adds. Click a block to see its code light up on the right.

When you add a block, a short tour shows what changed in the code. Use **Next** and **Back**, or **Skip**.
