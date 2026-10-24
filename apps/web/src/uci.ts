// Talking UCI to an engine the desktop app runs: start it, give it a
// position, and get its move back together with what it was thinking.

import type { Desktop } from "./platform";

export interface SearchInfo {
  depth?: number;
  seldepth?: number;
  /** Centipawns from the side to move's point of view. */
  cp?: number;
  /** Moves to mate (negative: getting mated), from the side to move's point of view. */
  mate?: number;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  /** The principal variation, in UCI notation. */
  pv: string[];
}

/** Reads one `info ...` line (lines without a score or depth give null). */
export function parseInfo(line: string): SearchInfo | null {
  if (!line.startsWith("info ")) return null;
  const t = line.split(/\s+/);
  const info: SearchInfo = { pv: [] };
  let seen = false;
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    const v = Number(t[i + 1]);
    switch (k) {
      case "depth":
        info.depth = v;
        seen = true;
        i++;
        break;
      case "seldepth":
        info.seldepth = v;
        i++;
        break;
      case "nodes":
        info.nodes = v;
        i++;
        break;
      case "nps":
        info.nps = v;
        i++;
        break;
      case "time":
        info.timeMs = v;
        i++;
        break;
      case "score":
        if (t[i + 1] === "cp") info.cp = Number(t[i + 2]);
        else if (t[i + 1] === "mate") info.mate = Number(t[i + 2]);
        seen = true;
        i += 2;
        break;
      case "pv":
        info.pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
    }
  }
  return seen ? info : null;
}

/** One engine process, started under an id ("white", "black"). */
export class UciEngine {
  private waiters: { test: (line: string) => boolean; resolve: (line: string) => void; reject: (e: Error) => void }[] = [];
  /** Increases on every search; a bestmove from an older search is ignored. */
  private searchId = 0;
  private alive = false;
  private current: { id: number; onInfo: (i: SearchInfo) => void; resolve: (m: string | null) => void; reject: (e: Error) => void } | null = null;
  /** Bestmoves still to come from cancelled searches. */
  private stale = 0;
  name = "";

  constructor(
    private readonly d: Desktop,
    readonly id: string,
    /** Every line the engine prints (for a log). */
    private readonly onLine: (line: string) => void = () => {},
  ) {}

  get running(): boolean {
    return this.alive;
  }

  private handle(line: string): void {
    this.onLine(line);
    if (line.startsWith("id name ")) this.name = line.slice(8).trim();
    if (line.startsWith("bestmove")) {
      if (this.stale > 0) {
        this.stale--;
        return;
      }
      const c = this.current;
      if (c) {
        this.current = null;
        const move = line.split(/\s+/)[1];
        c.resolve(move && move !== "(none)" && move !== "0000" ? move : null);
      }
      return;
    }
    if (this.current) {
      const info = parseInfo(line);
      if (info) this.current.onInfo(info);
    }
    const i = this.waiters.findIndex((w) => w.test(line));
    if (i >= 0) this.waiters.splice(i, 1)[0]!.resolve(line);
  }

  private wait(test: (line: string) => boolean, ms: number, what: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const w = { test, resolve, reject };
      this.waiters.push(w);
      if (ms > 0) {
        window.setTimeout(() => {
          const i = this.waiters.indexOf(w);
          if (i >= 0) {
            this.waiters.splice(i, 1);
            reject(new Error(`The engine did not answer ${what} in time.`));
          }
        }, ms);
      }
    });
  }

  /** Starts the program and gets it ready for a new game. */
  async start(program: string, dir: string, options: Record<string, string | number> = {}): Promise<void> {
    await this.d.startEngine(this.id, program, dir, (e) => {
      if (e.kind === "line") this.handle(e.text);
      else {
        this.alive = false;
        for (const w of this.waiters.splice(0)) w.reject(new Error("The engine stopped."));
        this.current?.reject(new Error("The engine stopped."));
        this.current = null;
      }
    });
    this.alive = true;
    const ok = this.wait((l) => l === "uciok", 10000, "uci");
    await this.d.sendEngine(this.id, "uci");
    await ok;
    for (const [k, v] of Object.entries(options)) await this.d.sendEngine(this.id, `setoption name ${k} value ${v}`);
    await this.newGame();
  }

  async newGame(): Promise<void> {
    await this.d.sendEngine(this.id, "ucinewgame");
    const ready = this.wait((l) => l === "readyok", 10000, "isready");
    await this.d.sendEngine(this.id, "isready");
    await ready;
  }

  /**
   * Searches `position` with `go`; resolves with the best move (UCI), or
   * null when the search was cancelled. `onInfo` gets every search update.
   */
  async search(position: string, go: string, onInfo: (info: SearchInfo) => void): Promise<string | null> {
    const id = ++this.searchId;
    const done = new Promise<string | null>((resolve, reject) => {
      this.current = { id, onInfo, resolve, reject };
    });
    await this.d.sendEngine(this.id, position);
    await this.d.sendEngine(this.id, go);
    return done;
  }

  /** Ends the current search without using its move. */
  async cancel(): Promise<void> {
    const c = this.current;
    if (!c) return;
    this.current = null;
    // The engine still answers the cancelled search; that bestmove is skipped.
    this.stale++;
    c.resolve(null);
    if (this.alive) await this.d.sendEngine(this.id, "stop").catch(() => undefined);
  }

  async quit(): Promise<void> {
    this.searchId++;
    this.alive = false;
    this.current?.resolve(null);
    this.current = null;
    this.stale = 0;
    for (const w of this.waiters.splice(0)) w.reject(new Error("The engine stopped."));
    await this.d.stopEngine(this.id).catch(() => undefined);
  }
}
