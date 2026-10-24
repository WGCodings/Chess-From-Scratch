// The Play view: play a branch of your engine on a board, or let two
// branches play each other. The desktop app runs the engines; on the
// website the view explains that.

import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import { branchList, type Workbench } from "@cfs/codegen";
import { buildBranch, ignoresClock } from "./build";
import { Chess, DEFAULT_POSITION, fenProblem, formatScore, gameEnd, isPromotion, lastUci, legalDests, playUci, pvToSan, whiteScore, type GameResult } from "./chessutil";
import { DESKTOP_DOWNLOAD_URL, desktop } from "./platform";
import { UciEngine, type SearchInfo } from "./uci";
import { preserving } from "./ui";

export interface PlayHost {
  workbench(): Workbench;
  sync(): void;
  toast(message: string): void;
  /** The Play view was shown (true) or hidden (false). */
  shown(visible: boolean): void;
}

type Side = "w" | "b";
type TimeControl = { kind: "clock"; minutes: number; increment: number } | { kind: "movetime"; seconds: number } | { kind: "depth"; depth: number };

interface Setup {
  mode: "human" | "engines";
  /** You against this branch. */
  branch: string;
  color: Side | "random";
  /** Two branches against each other. */
  white: string;
  black: string;
  time: TimeControl;
  fen: string;
}

interface Player {
  name: string;
  /** An engine (by branch), or you. */
  branch: string | null;
  engine: UciEngine | null;
  info: (SearchInfo & { fen: string; side: Side }) | null;
}

const SETUP_KEY = "cfs.play.setup";
const CLOCKS: [number, number][] = [
  [1, 0],
  [3, 2],
  [5, 3],
  [10, 5],
  [15, 10],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, title: string, cls = "btn"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.title = title;
  return b;
}

function loadSetup(): Setup {
  const base: Setup = { mode: "human", branch: "", color: "w", white: "", black: "", time: { kind: "clock", minutes: 3, increment: 2 }, fen: "" };
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(SETUP_KEY) ?? "{}") as Partial<Setup>) };
  } catch {
    return base;
  }
}

function storeSetup(s: Setup): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(s));
  } catch {
    /* convenience */
  }
}

/** "4:59.3" / "0:08.1": tenths below 10 seconds. */
export function formatClock(ms: number): string {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  if (t < 10000) return `${m}:${String(s).padStart(2, "0")}.${Math.floor((t % 1000) / 100)}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class PlayView {
  private readonly page: HTMLElement;
  private readonly boardEl: HTMLElement;
  private readonly evalFill: HTMLElement;
  private readonly side: HTMLElement;
  private readonly topBar: HTMLElement;
  private readonly bottomBar: HTMLElement;
  private board: Api | null = null;
  private setup = loadSetup();
  private chess = new Chess();
  private startFen = DEFAULT_POSITION;
  private moves: string[] = [];
  private players: Record<Side, Player> | null = null;
  private clocks: Record<Side, number> = { w: 0, b: 0 };
  private clockHistory: Record<Side, number>[] = [];
  private turnStart = 0;
  private result: { result: GameResult | "*"; reason: string } | null = null;
  private status = "";
  private log: string[] = [];
  private busy = false;
  private orientation: "white" | "black" = "white";
  private tick: number | undefined;
  private promotion: HTMLElement | null = null;
  /** Bumps on every new game, so late answers from an old game are dropped. */
  private gameId = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: PlayHost,
  ) {
    root.classList.add("play-view");
    root.hidden = true;
    this.page = el("div", "pl-page");
    const boardCol = el("div", "pl-boardcol");
    this.topBar = el("div", "pl-player pl-top");
    const boardRow = el("div", "pl-boardrow");
    const evalBar = el("div", "pl-eval");
    evalBar.title = "Evaluation (White's view) from the engine's last search";
    this.evalFill = el("div", "pl-eval-fill");
    evalBar.append(this.evalFill);
    this.boardEl = el("div", "pl-board");
    boardRow.append(evalBar, this.boardEl);
    this.bottomBar = el("div", "pl-player pl-bottom");
    boardCol.append(this.topBar, boardRow, this.bottomBar);
    this.side = el("div", "pl-side");
    this.page.append(boardCol, this.side);
    root.append(this.page);
    window.addEventListener("resize", () => this.board?.redrawAll());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get playing(): boolean {
    return !!this.players && !this.result;
  }

  open(): void {
    this.host.sync();
    if (!this.players) this.setup = loadSetup();
    if (this.root.hidden) {
      this.root.hidden = false;
      this.host.shown(true);
    }
    if (!this.board) {
      this.board = Chessground(this.boardEl, {
        fen: this.chess.fen(),
        orientation: this.orientation,
        coordinates: true,
        animation: { enabled: true, duration: 180 },
        movable: { free: false, color: undefined, showDests: true },
        premovable: { enabled: false },
        draggable: { enabled: true, showGhost: true },
        highlight: { lastMove: true, check: true },
      });
    }
    requestAnimationFrame(() => this.board?.redrawAll());
    this.render();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.host.shown(false);
  }

  refresh(): void {
    if (this.isOpen) this.render();
  }

  // Setup ---------------------------------------------------------------------------------------

  private renderSetup(wb: Workbench): HTMLElement {
    const card = el("section", "ts-card pl-setup");
    card.append(el("h3", undefined, "New game"));
    if (!desktop) {
      const box = el("div", "dock-notice ts-notice");
      box.innerHTML = `<p><b>Playing your engine needs the desktop app.</b> It builds the branch you pick and runs it on your computer. You play on this board, or let two branches play each other.</p>`;
      const a = el("a", "btn primary", "Get the desktop app");
      a.href = DESKTOP_DOWNLOAD_URL;
      a.target = "_blank";
      a.rel = "noopener";
      box.append(a);
      card.append(box);
      return card;
    }
    const branches = branchList(wb);
    const ids = new Set(branches.map((b) => b.id));
    const s = this.setup;
    if (!ids.has(s.branch)) s.branch = wb.current;
    if (!ids.has(s.white)) s.white = wb.current;
    if (!ids.has(s.black)) s.black = wb.main;

    const seg = (options: [string, string][], value: string, set: (v: string) => void, cls = "") => {
      const g = el("div", `pl-seg ${cls}`);
      for (const [v, label] of options) {
        const b = button(label, label, `pl-segbtn${v === value ? " active" : ""}`);
        b.dataset.value = v;
        b.addEventListener("click", () => {
          set(v);
          storeSetup(this.setup);
          this.render();
        });
        g.append(b);
      }
      return g;
    };
    const field = (label: string, input: HTMLElement) => {
      const l = el("label", "ts-field");
      l.append(el("span", undefined, label), input);
      return l;
    };
    const pick = (value: string, set: (v: string) => void, cls: string) => {
      const sel = el("select", cls);
      for (const b of branches) {
        const o = el("option", undefined, b.name);
        o.value = b.id;
        o.selected = b.id === value;
        sel.append(o);
      }
      sel.addEventListener("change", () => {
        set(sel.value);
        storeSetup(this.setup);
        this.render();
      });
      return sel;
    };

    card.append(
      seg(
        [
          ["human", "You vs your engine"],
          ["engines", "Engine vs engine"],
        ],
        s.mode,
        (v) => (s.mode = v as Setup["mode"]),
        "pl-mode",
      ),
    );
    const grid = el("div", "pl-grid");
    if (s.mode === "human") {
      grid.append(field("Engine (branch)", pick(s.branch, (v) => (s.branch = v), "pl-branch")));
      grid.append(
        field(
          "You play",
          seg(
            [
              ["w", "White"],
              ["b", "Black"],
              ["random", "Random"],
            ],
            s.color,
            (v) => (s.color = v as Setup["color"]),
            "pl-color",
          ),
        ),
      );
    } else {
      grid.append(field("White", pick(s.white, (v) => (s.white = v), "pl-white")));
      grid.append(field("Black", pick(s.black, (v) => (s.black = v), "pl-black")));
    }
    card.append(grid);

    // Time control.
    const tc = s.time;
    card.append(
      field(
        "Time",
        seg(
          [
            ["clock", "Clock"],
            ["movetime", "Seconds per move"],
            ["depth", "Depth per move"],
          ],
          tc.kind,
          (v) => (s.time = v === "clock" ? { kind: "clock", minutes: 3, increment: 2 } : v === "movetime" ? { kind: "movetime", seconds: 1 } : { kind: "depth", depth: 5 }),
          "pl-timekind",
        ),
      ),
    );
    const tcRow = el("div", "pl-tcrow");
    const num = (value: number, on: (v: number) => void, step = "1", min = "0") => {
      const i = el("input", "pl-num");
      i.type = "number";
      i.step = step;
      i.min = min;
      i.value = String(value);
      i.addEventListener("change", () => {
        on(Number(i.value));
        storeSetup(this.setup);
      });
      return i;
    };
    if (tc.kind === "clock") {
      for (const [m, inc] of CLOCKS) {
        const b = button(`${m}+${inc}`, `${m} minutes, ${inc} seconds added per move`, `ts-preset${tc.minutes === m && tc.increment === inc ? " active" : ""}`);
        b.addEventListener("click", () => {
          s.time = { kind: "clock", minutes: m, increment: inc };
          storeSetup(s);
          this.render();
        });
        tcRow.append(b);
      }
      tcRow.append(field("Minutes", num(tc.minutes, (v) => (tc.minutes = v), "0.5", "0.1")), field("+ seconds", num(tc.increment, (v) => (tc.increment = v), "0.5")));
    } else if (tc.kind === "movetime") {
      tcRow.append(field("Seconds per move", num(tc.seconds, (v) => (tc.seconds = v), "0.1", "0.05")));
    } else {
      tcRow.append(field("Depth", num(tc.depth, (v) => (tc.depth = v), "1", "1")));
    }
    card.append(tcRow);

    const fen = el("input", "pl-fen");
    fen.placeholder = "Start position: empty for the normal start, or paste a FEN";
    fen.value = s.fen;
    fen.spellcheck = false;
    fen.addEventListener("change", () => {
      s.fen = fen.value.trim();
      storeSetup(s);
      this.render();
    });
    card.append(field("Start position", fen));

    const engines = s.mode === "human" ? [s.branch] : [s.white, s.black];
    const slow = [...new Set(engines)].filter((id) => wb.branches[id] && ignoresClock(wb.branches[id]!.workspace));
    if (slow.length && tc.kind === "clock") {
      card.append(
        el(
          "p",
          "br-warn",
          `${slow.map((id) => `"${wb.branches[id]!.name}"`).join(" and ")} has no Iterative deepening, so it ignores the clock and may lose on time. Use "Depth per move", or add Iterative deepening.`,
        ),
      );
    }
    const problem = s.fen ? fenProblem(s.fen) : null;
    const foot = el("div", "ts-foot");
    if (problem) foot.append(el("span", "ts-problem", `Start position: ${problem}`));
    const start = button("▶ Start game", "Build the engine and start", "btn primary pl-start");
    start.disabled = !!problem || this.busy;
    start.addEventListener("click", () => void this.start());
    foot.append(start);
    card.append(foot);
    return card;
  }

  // Playing -------------------------------------------------------------------------------------

  private positionCommand(): string {
    const pos = this.startFen === DEFAULT_POSITION ? "position startpos" : `position fen ${this.startFen}`;
    return this.moves.length ? `${pos} moves ${this.moves.join(" ")}` : pos;
  }

  private goCommand(): string {
    const t = this.setup.time;
    if (t.kind === "movetime") return `go movetime ${Math.max(10, Math.round(t.seconds * 1000))}`;
    if (t.kind === "depth") return `go depth ${Math.max(1, Math.round(t.depth))}`;
    const inc = Math.round(t.increment * 1000);
    return `go wtime ${Math.max(1, Math.round(this.clocks.w))} btime ${Math.max(1, Math.round(this.clocks.b))} winc ${inc} binc ${inc}`;
  }

  async start(): Promise<void> {
    if (!desktop || this.busy) return;
    const d = desktop;
    this.host.sync();
    const wb = this.host.workbench();
    const s = this.setup;
    await this.stopEngines();
    const game = ++this.gameId;
    this.busy = true;
    this.result = null;
    this.log = [];
    this.startFen = s.fen ? new Chess(s.fen).fen() : DEFAULT_POSITION;
    this.chess = new Chess(this.startFen);
    this.moves = [];
    this.clockHistory = [];
    const you: Side = s.color === "random" ? (Math.random() < 0.5 ? "w" : "b") : s.color;
    const sides: Record<Side, string | null> = s.mode === "human" ? (you === "w" ? { w: null, b: s.branch } : { w: s.branch, b: null }) : { w: s.white, b: s.black };
    this.orientation = s.mode === "human" ? (you === "w" ? "white" : "black") : "white";
    const player = (side: Side): Player => {
      const id = sides[side];
      return { name: id ? (wb.branches[id]?.name ?? id) : "You", branch: id, engine: null, info: null };
    };
    this.players = { w: player("w"), b: player("b") };
    const t = s.time;
    const base = t.kind === "clock" ? t.minutes * 60000 : 0;
    this.clocks = { w: base, b: base };
    this.setBoard();
    this.render();
    try {
      // Build each branch once, start one engine per engine side.
      const built = new Map<string, Awaited<ReturnType<typeof buildBranch>>>();
      for (const side of ["w", "b"] as Side[]) {
        const id = sides[side];
        if (!id) continue;
        const b = wb.branches[id];
        if (!b) throw new Error("That branch is gone.");
        if (!built.has(id)) {
          this.setStatus(`Building "${b.name}"…`);
          built.set(id, await buildBranch(d, wb, id, b.workspace, (l) => this.say(l)));
        }
        if (game !== this.gameId) return;
        const e = new UciEngine(d, side === "w" ? "white" : "black", (l) => this.say(`${side === "w" ? "White" : "Black"}: ${l}`));
        this.setStatus(`Starting "${b.name}"…`);
        const prog = built.get(id)!;
        await e.start(prog.program, prog.dir, prog.hash ? { Hash: 16 } : {});
        this.players[side].engine = e;
      }
    } catch (err) {
      this.busy = false;
      this.players = null;
      this.setStatus(err instanceof Error ? err.message : String(err));
      this.render();
      return;
    }
    if (game !== this.gameId) return;
    this.busy = false;
    window.clearInterval(this.tick);
    this.tick = window.setInterval(() => this.onTick(), 100);
    this.nextTurn();
  }

  private say(line: string): void {
    this.log.push(line);
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }

  private setStatus(text: string): void {
    this.status = text;
    const st = this.side.querySelector(".pl-status");
    if (st) st.textContent = text;
  }

  private setBoard(): void {
    if (!this.board) return;
    const turn = this.chess.turn() === "w" ? "white" : "black";
    const last = lastUci(this.chess);
    const p = this.players?.[this.chess.turn()];
    const human = this.playing && !!p && !p.engine && !p.branch;
    this.board.set({
      fen: this.chess.fen(),
      orientation: this.orientation,
      turnColor: turn,
      check: this.chess.inCheck(),
      lastMove: last ? ([last.slice(0, 2), last.slice(2, 4)] as Key[]) : undefined,
      movable: {
        free: false,
        color: human && !this.busy ? turn : undefined,
        dests: human ? legalDests(this.chess) : new Map(),
        events: { after: (orig, dest) => this.onHumanMove(orig, dest) },
      },
    });
  }

  private nextTurn(): void {
    if (!this.players || this.result) return;
    const end = gameEnd(this.chess);
    if (end) return this.finish(end.result, end.reason);
    const side = this.chess.turn();
    const p = this.players[side];
    this.turnStart = performance.now();
    this.setBoard();
    if (p.engine) {
      this.setStatus(`${p.name} is thinking…`);
      void this.engineMove(side, p);
    } else {
      this.setStatus("Your move");
    }
    this.render();
  }

  private async engineMove(side: Side, p: Player): Promise<void> {
    const game = this.gameId;
    const fen = this.chess.fen();
    let move: string | null;
    try {
      move = await p.engine!.search(this.positionCommand(), this.goCommand(), (info) => {
        p.info = { ...info, fen, side };
        this.renderInfo();
      });
    } catch (err) {
      if (game !== this.gameId || this.result) return;
      return this.finish(side === "w" ? "0-1" : "1-0", `${p.name} stopped (crashed?)`);
    }
    if (game !== this.gameId || this.result || !move) return;
    if (!this.commit(move)) return this.finish(side === "w" ? "0-1" : "1-0", `${p.name} played an illegal move (${move})`);
    this.nextTurn();
  }

  private onHumanMove(orig: Key, dest: Key): void {
    if (!this.playing) return;
    if (isPromotion(this.chess, orig, dest)) return this.askPromotion(orig, dest);
    if (this.commit(`${orig}${dest}`)) this.nextTurn();
    else this.setBoard();
  }

  private askPromotion(orig: Key, dest: Key): void {
    this.promotion?.remove();
    const box = el("div", "pl-promo");
    box.append(el("span", undefined, "Promote to"));
    const color = this.chess.turn() === "w" ? "white" : "black";
    for (const [p, name] of [
      ["q", "queen"],
      ["r", "rook"],
      ["b", "bishop"],
      ["n", "knight"],
    ] as const) {
      const b = button("", name, "pl-promo-btn cg-wrap");
      b.innerHTML = `<piece class="${color} ${name}"></piece>`;
      b.addEventListener("click", () => {
        box.remove();
        this.promotion = null;
        if (this.commit(`${orig}${dest}${p}`)) this.nextTurn();
      });
      box.append(b);
    }
    const cancel = button("✕", "Cancel", "pl-promo-x");
    cancel.addEventListener("click", () => {
      box.remove();
      this.promotion = null;
      this.setBoard();
    });
    box.append(cancel);
    this.boardEl.parentElement!.append(box);
    this.promotion = box;
  }

  /** Plays a move for the side to move, with its clock. */
  private commit(uci: string): boolean {
    const side = this.chess.turn();
    const before = { ...this.clocks };
    if (!playUci(this.chess, uci)) return false;
    this.clockHistory.push(before);
    this.moves.push(uci);
    const t = this.setup.time;
    if (t.kind === "clock") {
      this.clocks[side] -= performance.now() - this.turnStart;
      if (this.clocks[side] <= 0) {
        this.clocks[side] = 0;
        this.setBoard();
        this.finish(side === "w" ? "0-1" : "1-0", `${this.players![side].name} lost on time`);
        return false;
      }
      this.clocks[side] += t.increment * 1000;
    }
    this.setBoard();
    return true;
  }

  private onTick(): void {
    if (!this.playing) return;
    if (this.setup.time.kind === "clock") {
      const side = this.chess.turn();
      const left = this.clocks[side] - (performance.now() - this.turnStart);
      if (left <= 0) {
        this.clocks[side] = 0;
        void this.players![side].engine?.cancel();
        this.finish(side === "w" ? "0-1" : "1-0", `${this.players![side].name} lost on time`);
        return;
      }
    }
    this.renderPlayers();
  }

  private finish(result: GameResult | "*", reason: string): void {
    if (this.result) return;
    this.result = { result, reason };
    window.clearInterval(this.tick);
    const winner = result === "1-0" ? "White wins" : result === "0-1" ? "Black wins" : result === "1/2-1/2" ? "Draw" : "Game stopped";
    this.setStatus(`${winner}: ${reason}`);
    void this.stopEngines();
    this.setBoard();
    this.render();
  }

  private async stopEngines(): Promise<void> {
    window.clearInterval(this.tick);
    if (!this.players) return;
    for (const p of Object.values(this.players)) {
      const e = p.engine;
      p.engine = null;
      if (e) await e.quit();
    }
  }

  private async takeBack(): Promise<void> {
    if (!this.players || this.setup.mode !== "human") return;
    const engineSide = (["w", "b"] as Side[]).find((s) => this.players![s].branch)!;
    const engine = this.players[engineSide].engine;
    // Stop the engine if it is thinking, then go back to your last move.
    if (this.chess.turn() === engineSide) await engine?.cancel();
    const undoOne = () => {
      if (!this.moves.length) return false;
      this.chess.undo();
      this.moves.pop();
      this.clocks = this.clockHistory.pop() ?? this.clocks;
      return true;
    };
    undoOne();
    if (this.chess.turn() === engineSide && this.moves.length) undoOne();
    if (this.chess.turn() === engineSide && !this.moves.length) {
      // The engine moves first: back at the start, let it move again.
    }
    if (this.result) {
      // Taking back after the end continues the game with the engine running again.
      this.result = null;
      const id = this.players[engineSide].branch!;
      const wb = this.host.workbench();
      const b = wb.branches[id];
      if (b && desktop) {
        this.busy = true;
        this.render();
        const built = await buildBranch(desktop, wb, id, b.workspace, (l) => this.say(l));
        const e = new UciEngine(desktop, engineSide === "w" ? "white" : "black", (l) => this.say(l));
        await e.start(built.program, built.dir, built.hash ? { Hash: 16 } : {});
        this.players[engineSide].engine = e;
        this.busy = false;
        this.tick = window.setInterval(() => this.onTick(), 100);
      }
    }
    this.nextTurn();
  }

  private resign(): void {
    if (!this.playing || !this.players) return;
    const you = (["w", "b"] as Side[]).find((s) => !this.players![s].branch);
    if (you) this.finish(you === "w" ? "0-1" : "1-0", "you resigned");
    else this.finish("*", "stopped");
  }

  pgn(): string {
    const c = new Chess(this.startFen);
    for (const m of this.moves) playUci(c, m);
    const p = this.players;
    c.setHeader("Event", "Chess From Scratch game");
    c.setHeader("Date", new Date().toISOString().slice(0, 10).replace(/-/g, "."));
    c.setHeader("White", p?.w.name ?? "?");
    c.setHeader("Black", p?.b.name ?? "?");
    c.setHeader("Result", this.result?.result ?? "*");
    const t = this.setup.time;
    if (t.kind === "clock") c.setHeader("TimeControl", `${Math.round(t.minutes * 60)}+${t.increment}`);
    if (this.startFen !== DEFAULT_POSITION) {
      c.setHeader("SetUp", "1");
      c.setHeader("FEN", this.startFen);
    }
    if (this.result) c.setHeader("Termination", this.result.reason);
    return c.pgn();
  }

  private copy(text: string, what: string): void {
    void navigator.clipboard.writeText(text).then(
      () => this.host.toast(`Copied the ${what}.`),
      () => this.host.toast("Copy is not available here."),
    );
  }

  // Drawing -------------------------------------------------------------------------------------

  private render(): void {
    // Redraws keep the engine output open (and at its end) when it was.
    preserving(this.side, () => this.draw());
  }

  private draw(): void {
    const wb = this.host.workbench();
    this.renderPlayers();
    this.side.replaceChildren();
    if (!this.players) {
      if (this.status && !this.players) this.side.append(el("p", "br-warn pl-status", this.status));
      this.side.append(this.renderSetup(wb));
      this.renderEval();
      return;
    }
    const card = el("section", "ts-card pl-game");
    const head = el("div", "ts-runhead");
    head.append(el("h3", undefined, `${this.players.w.name} vs ${this.players.b.name}`));
    const t = this.setup.time;
    head.append(el("span", "br-meta", t.kind === "clock" ? `${t.minutes}+${t.increment}` : t.kind === "movetime" ? `${t.seconds} s per move` : `depth ${t.depth}`));
    card.append(head);
    card.append(el("p", `pl-status${this.result ? " pl-over" : ""}`, this.status));

    // Moves.
    const list = el("ol", "pl-moves");
    const replay = new Chess(this.startFen);
    let li: HTMLLIElement | null = null;
    const blackFirst = replay.turn() === "b";
    this.moves.forEach((m, i) => {
      const num = replay.moveNumber();
      const white = replay.turn() === "w";
      const san = playUci(replay, m) ?? m;
      if (white || !li || (blackFirst && i === 0)) {
        li = el("li");
        li.value = num;
        if (!white) li.append(el("span", "pl-san", "…"));
        list.append(li);
      }
      li.append(el("span", `pl-san${i === this.moves.length - 1 ? " last" : ""}`, san));
    });
    if (this.result) {
      const r = el("li", "pl-result", this.result.result);
      list.append(r);
    }
    card.append(list);
    requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));

    const info = el("div", "pl-infos");
    card.append(info);

    const actions = el("div", "pl-actions");
    if (this.setup.mode === "human") {
      const back = button("↶ Take back", "Take back your last move", "btn pl-takeback");
      back.disabled = this.busy || !this.moves.length;
      back.addEventListener("click", () => void this.takeBack());
      actions.append(back);
    }
    const flip = button("⇅ Flip", "Turn the board around", "btn pl-flip");
    flip.addEventListener("click", () => {
      this.orientation = this.orientation === "white" ? "black" : "white";
      this.board?.set({ orientation: this.orientation });
      this.renderPlayers();
    });
    actions.append(flip);
    if (this.playing) {
      const resign = button(this.setup.mode === "human" ? "⚑ Resign" : "■ Stop", this.setup.mode === "human" ? "Give up this game" : "Stop this game", "btn pl-resign");
      resign.addEventListener("click", () => this.resign());
      actions.append(resign);
    } else {
      const again = button("New game", "Back to the game settings", "btn primary pl-new");
      again.addEventListener("click", () => {
        this.players = null;
        this.status = "";
        this.render();
      });
      const rematch = button("Rematch", "The same game again", "btn pl-rematch");
      rematch.addEventListener("click", () => void this.start());
      actions.append(again, rematch);
    }
    const pgn = button("Copy PGN", "Copy the game, to paste into Lichess or a chess program", "btn pl-pgn");
    pgn.addEventListener("click", () => this.copy(this.pgn(), "PGN"));
    const fen = button("Copy FEN", "Copy the current position", "btn pl-copyfen");
    fen.addEventListener("click", () => this.copy(this.chess.fen(), "FEN"));
    actions.append(pgn, fen);
    card.append(actions);

    const log = el("details", "ts-log");
    log.dataset.key = "engine-output";
    log.append(el("summary", undefined, "Engine output"));
    const pre = el("pre", "ts-out", this.log.join("\n"));
    pre.dataset.scroll = "engine-output";
    log.append(pre);
    card.append(log);
    this.side.append(card);
    this.renderInfo();
  }

  /** The bars above and below the board: names and clocks, the side at the bottom being the board's orientation. */
  private renderPlayers(): void {
    const p = this.players;
    const bottom: Side = this.orientation === "white" ? "w" : "b";
    const top: Side = bottom === "w" ? "b" : "w";
    const fill = (bar: HTMLElement, side: Side) => {
      const name = p ? p[side].name : side === "w" ? "White" : "Black";
      const running = this.playing && this.chess.turn() === side && !this.busy;
      let ms = this.clocks[side];
      if (running) ms -= performance.now() - this.turnStart;
      const clock = this.setup.time.kind === "clock" && p ? formatClock(ms) : "";
      bar.className = `pl-player ${bar === this.topBar ? "pl-top" : "pl-bottom"}${running ? " to-move" : ""}${clock && ms < 10000 && running ? " low" : ""}`;
      bar.innerHTML = `<span class="pl-dot ${side === "w" ? "white" : "black"}"></span><span class="pl-name"></span><span class="pl-clock"></span>`;
      bar.querySelector(".pl-name")!.textContent = name;
      bar.querySelector(".pl-clock")!.textContent = clock;
    };
    fill(this.topBar, top);
    fill(this.bottomBar, bottom);
  }

  /** Depth, score and line of each engine's last search, and the eval bar. */
  private renderInfo(): void {
    const box = this.side.querySelector(".pl-infos");
    if (box && this.players) {
      box.replaceChildren();
      for (const side of ["w", "b"] as Side[]) {
        const p = this.players[side];
        if (!p.branch) continue;
        const i = p.info;
        const row = el("div", "pl-info");
        row.append(el("strong", undefined, `${p.name} (${side === "w" ? "White" : "Black"})`));
        if (i) {
          row.append(
            el("span", "pl-score", formatScore(i, i.side)),
            el("span", "br-meta", `depth ${i.depth ?? "?"}${i.seldepth ? `/${i.seldepth}` : ""}${i.nodes !== undefined ? ` · ${i.nodes.toLocaleString()} nodes` : ""}${i.nps ? ` · ${Math.round(i.nps / 1000).toLocaleString()} knps` : ""}`),
          );
          if (i.pv.length) row.append(el("div", "pl-pv", pvToSan(i.fen, i.pv)));
        } else row.append(el("span", "br-meta", "no search yet"));
        box.append(row);
      }
    }
    this.renderEval();
  }

  private renderEval(): void {
    const infos = this.players ? (["w", "b"] as Side[]).map((s) => this.players![s].info).filter((x): x is NonNullable<typeof x> => !!x) : [];
    // The newest search counts: the one made in the position with the most moves.
    const i = infos.sort((a, b) => Number(a.fen.split(" ")[5]) * 2 + (a.side === "b" ? 1 : 0) - (Number(b.fen.split(" ")[5]) * 2 + (b.side === "b" ? 1 : 0))).pop();
    const score = i ? whiteScore(i, i.side) : 0;
    const share = score === null ? 0.5 : 1 / (1 + Math.exp(-0.7 * score));
    this.evalFill.style.height = `${(share * 100).toFixed(1)}%`;
    this.evalFill.parentElement!.classList.toggle("flipped", this.orientation === "black");
    this.evalFill.parentElement!.title = i ? `Evaluation (White's view): ${formatScore(i, i.side)}` : "Evaluation (White's view)";
  }
}
