/**
 * Engine tests: two branches of a workbench play many fast games with
 * fastchess until an SPRT says the new one is better (H1) or not (H0).
 * This file builds fastchess's command line, reads its output and keeps the
 * results; running the programs is the desktop app's job.
 */

export interface SprtBounds {
  /** Normalized Elo the new version is NOT better than (H0). */
  elo0: number;
  /** Normalized Elo the new version is better by (H1). */
  elo1: number;
  alpha: number;
  beta: number;
}

export type BookChoice = { kind: "builtin"; id: BuiltinBookId } | { kind: "file"; path: string } | { kind: "none" };

export interface TestOptions {
  /** fastchess time control: seconds per game + increment, e.g. "10+0.1". */
  tc: string;
  hash: number;
  threads: number;
  /** Games played at the same time. */
  concurrency: number;
  book: BookChoice;
  sprt: SprtBounds;
  /** Stop after this many games even without a verdict. */
  maxGames: number;
  /** End lost or drawn games early, as OpenBench does. */
  adjudicate: boolean;
}

export type PresetId = "quick" | "standard" | "careful" | "nonregression";

export const PRESETS: Record<PresetId, { label: string; description: string; options: Partial<TestOptions> }> = {
  quick: {
    label: "Quick test",
    description: "5+0.05 seconds a game, bounds [0, 10]: finds big gains fast. Good for a new block.",
    options: { tc: "5+0.05", sprt: { elo0: 0, elo1: 10, alpha: 0.05, beta: 0.05 } },
  },
  standard: {
    label: "Standard test",
    description: "10+0.1 seconds a game, bounds [0, 5]: like OpenBench's short time control.",
    options: { tc: "10+0.1", sprt: { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 } },
  },
  careful: {
    label: "Careful test",
    description: "60+0.6 seconds a game, bounds [0, 5]: long games, for changes that only help with more time.",
    options: { tc: "60+0.6", sprt: { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 } },
  },
  nonregression: {
    label: "Not worse (simplification)",
    description: "10+0.1 seconds a game, bounds [-5, 0]: passes when the new version is not weaker, e.g. after cleaning up code.",
    options: { tc: "10+0.1", sprt: { elo0: -5, elo1: 0, alpha: 0.05, beta: 0.05 } },
  },
};

export type BuiltinBookId = "UHO_4060_v2" | "8moves_v3";

export const BOOKS: Record<BuiltinBookId, { label: string; file: string; format: "epd" | "pgn"; url: string; size: string }> = {
  UHO_4060_v2: {
    label: "UHO 4060 v2 (unbalanced openings, as OpenBench uses)",
    file: "UHO_4060_v2.epd",
    format: "epd",
    url: "https://raw.githubusercontent.com/official-stockfish/books/master/UHO_4060_v2.epd.zip",
    size: "3.8 MB",
  },
  "8moves_v3": {
    label: "8 moves v3 (balanced openings)",
    file: "8moves_v3.pgn",
    format: "pgn",
    url: "https://raw.githubusercontent.com/official-stockfish/books/master/8moves_v3.pgn.zip",
    size: "0.8 MB",
  },
};

export function defaultTestOptions(cores = 2): TestOptions {
  return {
    tc: "5+0.05",
    hash: 16,
    threads: 1,
    // Logical cores count hyperthreads twice; half of them are real cores.
    concurrency: Math.max(1, Math.floor(cores / 2)),
    book: { kind: "builtin", id: "UHO_4060_v2" },
    sprt: { elo0: 0, elo1: 10, alpha: 0.05, beta: 0.05 },
    maxGames: 20000,
    adjudicate: true,
  };
}

/** The LLR bounds of an SPRT: H0 is accepted below `lower`, H1 above `upper`. */
export function sprtLimits(s: Pick<SprtBounds, "alpha" | "beta">): { lower: number; upper: number } {
  return { lower: Math.log(s.beta / (1 - s.alpha)), upper: Math.log((1 - s.beta) / s.alpha) };
}

/** Why these options can't run, or null. */
export function checkTestOptions(o: TestOptions): string | null {
  if (!/^(\d+(\.\d+)?\/)?\d+(\.\d+)?(\+\d+(\.\d+)?)?$/.test(o.tc.trim())) return `"${o.tc}" is not a time control. Write seconds + increment, e.g. 10+0.1.`;
  if (!(o.concurrency >= 1)) return "Play at least one game at a time.";
  if (!(o.hash >= 1)) return "Hash must be at least 1 MB.";
  if (!(o.threads >= 1)) return "Threads must be at least 1.";
  if (!(o.sprt.elo1 > o.sprt.elo0)) return "elo1 must be bigger than elo0.";
  if (!(o.sprt.alpha > 0 && o.sprt.alpha < 0.5 && o.sprt.beta > 0 && o.sprt.beta < 0.5)) return "alpha and beta must be between 0 and 0.5.";
  if (!(o.maxGames >= 2)) return "Play at least 2 games.";
  if (o.book.kind === "file" && !o.book.path) return "Pick an opening book file.";
  return null;
}

export interface TestEngine {
  name: string;
  program: string;
  /** The engine has a Hash option (a transposition table). */
  hash: boolean;
}

/** fastchess's arguments for a test of `next` against `base`. */
export function fastchessArgs(o: TestOptions, next: TestEngine, base: TestEngine, book: { path: string; format: "epd" | "pgn" } | null): string[] {
  const engine = (e: TestEngine) => [
    "-engine",
    `cmd=${e.program}`,
    `name=${e.name}`,
    ...(e.hash ? [`option.Hash=${o.hash}`] : []),
    `option.Threads=${o.threads}`,
  ];
  const args = [
    ...engine(next),
    ...engine(base),
    "-each",
    `tc=${o.tc.trim()}`,
    "-rounds",
    String(Math.ceil(o.maxGames / 2)),
    "-repeat",
    "-concurrency",
    String(o.concurrency),
    "-sprt",
    `elo0=${o.sprt.elo0}`,
    `elo1=${o.sprt.elo1}`,
    `alpha=${o.sprt.alpha}`,
    `beta=${o.sprt.beta}`,
    "-ratinginterval",
    "10",
    "-recover",
  ];
  if (book) args.push("-openings", `file=${book.path}`, `format=${book.format}`, "order=random");
  if (o.adjudicate) args.push("-draw", "movenumber=40", "movecount=8", "score=10", "-resign", "movecount=3", "score=600", "twosided=true");
  return args;
}

// Reading fastchess's output --------------------------------------------------------------------

export interface TestProgress {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Elo of the new version against the base, and its 95% error margin. */
  elo: number | null;
  eloError: number | null;
  nElo: number | null;
  nEloError: number | null;
  /** Pentanomial counts [0, 0.5, 1, 1.5, 2] points per game pair. */
  penta: number[] | null;
  llr: number | null;
  lower: number;
  upper: number;
  /** Set when the SPRT finished. */
  verdict: "H0" | "H1" | null;
  /** Games lost on time, by crash or illegal move: a sign something is wrong. */
  problems: number;
  /** The last finished games, newest last. */
  recent: string[];
}

export function emptyProgress(s: SprtBounds): TestProgress {
  const { lower, upper } = sprtLimits(s);
  return { games: 0, wins: 0, losses: 0, draws: 0, elo: null, eloError: null, nElo: null, nEloError: null, penta: null, llr: null, lower, upper, verdict: null, problems: 0, recent: [] };
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s));

/**
 * Updates `p` with one line of fastchess output; returns true when it
 * changed. Lines it doesn't know are ignored.
 */
export function readFastchessLine(p: TestProgress, line: string, newName: string): boolean {
  let m: RegExpMatchArray | null;
  const N = "(-?(?:[\\d.]+|inf|nan))";
  if ((m = line.match(new RegExp(`^Elo: ${N} \\+\\/- ${N}, nElo: ${N} \\+\\/- ${N}`)))) {
    const f = (x: string) => (Number.isFinite(Number(x)) ? Number(x) : null);
    p.elo = f(m[1]!);
    p.eloError = f(m[2]!);
    p.nElo = f(m[3]!);
    p.nEloError = f(m[4]!);
    return true;
  }
  if ((m = line.match(/^Games: (\d+), Wins: (\d+), Losses: (\d+), Draws: (\d+)/))) {
    p.games = Number(m[1]);
    p.wins = Number(m[2]);
    p.losses = Number(m[3]);
    p.draws = Number(m[4]);
    return true;
  }
  if ((m = line.match(/^Ptnml\(0-2\): \[([\d, ]+)\]/))) {
    p.penta = m[1]!.split(",").map((x) => Number(x.trim()));
    return true;
  }
  if ((m = line.match(/^LLR: (-?[\d.]+) \([^)]*\) \((-?[\d.]+), (-?[\d.]+)\)/))) {
    p.llr = num(m[1]);
    p.lower = Number(m[2]);
    p.upper = Number(m[3]);
    return true;
  }
  if ((m = line.match(/SPRT \(.*\) completed - (H0|H1) was accepted/))) {
    p.verdict = m[1] as "H0" | "H1";
    return true;
  }
  if ((m = line.match(/^Finished game (\d+) \((.+) vs (.+)\): (1-0|0-1|1\/2-1\/2|\*) \{(.*)\}/))) {
    const [, , white, black, result, reason] = m;
    const winner = result === "1-0" ? white : result === "0-1" ? black : null;
    const who = winner === undefined || winner === null ? "draw" : winner === newName ? "new wins" : "base wins";
    p.recent.push(`${white} vs ${black}: ${result} (${who}, ${reason})`);
    if (p.recent.length > 8) p.recent.shift();
    if (/time|disconnect|illegal|crash|stall/i.test(reason!)) p.problems++;
    return true;
  }
  return false;
}

// Results in the workbench ----------------------------------------------------------------------

export type TestStatus = "running" | "passed" | "failed" | "stopped" | "error";

export interface TestRecord {
  id: string;
  started: string;
  finished?: string;
  status: TestStatus;
  newBranch: { id: string; name: string };
  baseBranch: { id: string; name: string };
  /** What the new branch changed compared to the base, one line each. */
  changes: string[];
  options: TestOptions;
  bench?: { new: number | null; base: number | null };
  result: TestProgress;
  /** Why it ended early, for status "error". */
  message?: string;
  /** What the user did afterwards. */
  decision?: "kept" | "deleted";
}

/** The status a finished fastchess run means. */
export function statusOf(p: TestProgress): TestStatus {
  if (p.verdict === "H1") return "passed";
  if (p.verdict === "H0") return "failed";
  return "stopped";
}

/** "+12.3 ± 8.1" (or "—" before the first result). */
export function formatElo(elo: number | null, error: number | null): string {
  if (elo === null) return "—";
  const e = `${elo >= 0 ? "+" : "−"}${Math.abs(elo).toFixed(1)}`;
  return error === null ? e : `${e} ± ${error.toFixed(1)}`;
}

/** One line for the timeline and the history. */
export function describeResult(t: TestRecord): string {
  const r = t.result;
  const verdict = t.status === "passed" ? "passed" : t.status === "failed" ? "failed" : t.status;
  return `${verdict}, ${formatElo(r.elo, r.eloError)} Elo after ${r.games} games (W ${r.wins} / D ${r.draws} / L ${r.losses})`;
}

/**
 * The main version's strength over time: every test whose new branch was
 * kept adds its Elo. Points start at 0 with the first test.
 */
export function eloTimeline(tests: TestRecord[]): { at: string; elo: number; label: string }[] {
  const points: { at: string; elo: number; label: string }[] = [];
  let total = 0;
  for (const t of [...tests].sort((a, b) => a.started.localeCompare(b.started))) {
    if (t.decision !== "kept" || t.result.elo === null) continue;
    if (!points.length) points.push({ at: t.started, elo: 0, label: "start" });
    total += t.result.elo;
    points.push({ at: t.finished ?? t.started, elo: total, label: t.newBranch.name });
  }
  return points;
}
