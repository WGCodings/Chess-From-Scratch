// Watching a test's games live: fastchess's engine log says which position
// it sends to which engine (one game per fastchess thread) and what the
// engines answer. This turns those lines into boards.

import { Chessground } from "chessground";
import type { Api } from "chessground/api";
import type { Key } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import { Chess, lastUci, playUci, positionToChess } from "./chessutil";

export interface LiveGame {
  /** fastchess's thread id: one game at a time per thread. */
  thread: string;
  white: string;
  black: string;
  fen: string;
  lastMove: string | null;
  plies: number;
  /** Clocks in milliseconds, from the last `go`. */
  wtime: number | null;
  btime: number | null;
  /** Games this slot has started. */
  games: number;
}

const LINE = /<\s*(\S+)>\s+(\S+)\s+(<---|--->)\s+(.*)$/;

/** The games being played, from fastchess engine-log lines. */
export class LiveGamesModel {
  readonly games = new Map<string, LiveGame & { chess: Chess; start: string }>();

  /** Reads lines; returns the threads whose game changed. */
  feed(lines: string[]): Set<string> {
    const changed = new Set<string>();
    for (const line of lines) {
      const m = line.match(LINE);
      if (!m) continue;
      const [, thread, name, dir, msg] = m as unknown as [string, string, string, string, string];
      let g = this.games.get(thread);
      if (dir === "<---" && msg.startsWith("position ")) {
        const chess = positionToChess(msg);
        if (!chess) continue;
        const start = msg.split(" moves ")[0]!;
        const plies = chess.history().length;
        // A new game: another start position, or fewer moves than before.
        if (!g || g.start !== start || plies < g.plies) {
          g = { thread, white: "", black: "", fen: "", lastMove: null, plies: 0, wtime: null, btime: null, games: (g?.games ?? 0) + 1, chess, start };
          this.games.set(thread, g);
        }
        g.chess = chess;
        g.fen = chess.fen();
        g.plies = plies;
        g.lastMove = lastUci(chess);
        // The engine that gets the position is the one to move.
        if (chess.turn() === "w") g.white = name;
        else g.black = name;
        changed.add(thread);
      } else if (g && dir === "<---" && msg.startsWith("go ")) {
        const w = msg.match(/wtime (\d+)/);
        const b = msg.match(/btime (\d+)/);
        g.wtime = w ? Number(w[1]) : null;
        g.btime = b ? Number(b[1]) : null;
        changed.add(thread);
      } else if (g && dir === "--->" && msg.startsWith("bestmove ")) {
        const move = msg.split(/\s+/)[1];
        if (move && playUci(g.chess, move)) {
          g.fen = g.chess.fen();
          g.plies++;
          g.lastMove = move;
          changed.add(thread);
        }
      }
    }
    return changed;
  }
}

const clock = (ms: number | null) => {
  if (ms === null) return "";
  const s = Math.max(0, ms) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/** A grid of small boards, one per game, kept up to date a few times a second. */
export class LiveGamesView {
  readonly el: HTMLElement;
  private readonly model = new LiveGamesModel();
  private readonly boards = new Map<string, { card: HTMLElement; api: Api; head: HTMLElement; foot: HTMLElement }>();
  private dirty = new Set<string>();
  private frame: number | null = null;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "lg-grid";
  }

  feed(lines: string[]): void {
    for (const t of this.model.feed(lines)) this.dirty.add(t);
    // Draw at most once a frame, however fast the games go.
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
    });
  }

  clear(): void {
    this.model.games.clear();
    for (const b of this.boards.values()) b.api.destroy();
    this.boards.clear();
    this.el.replaceChildren();
  }

  get count(): number {
    return this.model.games.size;
  }

  private draw(): void {
    for (const t of this.dirty) {
      const g = this.model.games.get(t);
      if (!g) continue;
      let b = this.boards.get(t);
      if (!b) {
        const card = document.createElement("div");
        card.className = "lg-card";
        const head = document.createElement("div");
        head.className = "lg-head";
        const boardEl = document.createElement("div");
        boardEl.className = "lg-board";
        const foot = document.createElement("div");
        foot.className = "lg-foot";
        card.append(head, boardEl, foot);
        this.el.append(card);
        const api = Chessground(boardEl, { viewOnly: true, coordinates: false, animation: { enabled: true, duration: 120 }, fen: g.fen });
        b = { card, api, head, foot };
        this.boards.set(t, b);
      }
      b.api.set({ fen: g.fen, lastMove: g.lastMove ? ([g.lastMove.slice(0, 2), g.lastMove.slice(2, 4)] as Key[]) : undefined, turnColor: g.chess.turn() === "w" ? "white" : "black", check: g.chess.inCheck() });
      const toMove = g.chess.turn();
      b.head.innerHTML = `<span class="lg-side ${toMove === "b" ? "to-move" : ""}">● <b></b> <span class="lg-clock">${clock(g.btime)}</span></span>`;
      b.head.querySelector("b")!.textContent = g.black || "…";
      b.foot.innerHTML = `<span class="lg-side ${toMove === "w" ? "to-move" : ""}">○ <b></b> <span class="lg-clock">${clock(g.wtime)}</span></span><span class="lg-move">move ${Math.floor(g.plies / 2) + 1}</span>`;
      b.foot.querySelector("b")!.textContent = g.white || "…";
    }
    this.dirty.clear();
  }
}
