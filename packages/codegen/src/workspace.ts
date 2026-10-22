/**
 * The workspace: the JSON document the editor saves and the generator reads.
 */

import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  SEARCH_SLOTS,
  TIME_BLOCKS,
  TRANSPOSITION_TABLE,
  defaultParams,
  type EvalTermType,
  type ParamSpec,
  type ParamValue,
  type SearchBlockType,
  type SearchSlot,
  type TimeBlockType,
} from "./blocks";

export const WORKSPACE_FORMAT_VERSION = 1;

/** Low on purpose: a bench without pruning blocks must still finish in seconds. */
export const DEFAULT_BENCH_DEPTH = 5;
export const MAX_BENCH_DEPTH = 30;

export type Params = Record<string, ParamValue>;

export interface BlockInstance<T extends string> {
  type: T;
  params: Params;
}

export interface Workspace {
  format: typeof WORKSPACE_FORMAT_VERSION;
  engine: {
    name: string;
    author: string;
    /** Depth `bench` searches when run without an argument. */
    benchDepth: number;
    /** `null` when no time block is placed: then basic time left / 40 is used. */
    timeManagement: BlockInstance<TimeBlockType> | null;
    /** `null` when the transposition table block is not placed. */
    transpositionTable: Params | null;
  };
  search: {
    kind: "negamax";
    slots: Record<SearchSlot, BlockInstance<SearchBlockType>[]>;
  };
  eval: {
    kind: "hce";
    terms: BlockInstance<EvalTermType>[];
  };
}

function searchBlock(type: SearchBlockType): BlockInstance<SearchBlockType> {
  return { type, params: defaultParams(SEARCH_BLOCKS[type].params) };
}

function evalTerm(type: EvalTermType): BlockInstance<EvalTermType> {
  return { type, params: defaultParams(EVAL_TERMS[type].params) };
}

/** A workspace with no search or eval blocks: the bare skeleton. */
export function emptyWorkspace(name = "My Engine", author = "me"): Workspace {
  return {
    format: WORKSPACE_FORMAT_VERSION,
    engine: {
      name,
      author,
      benchDepth: DEFAULT_BENCH_DEPTH,
      timeManagement: null,
      transpositionTable: null,
    },
    search: {
      kind: "negamax",
      slots: { root: [], pruning: [], ordering: [], move_loop: [], reductions: [], leaf: [] },
    },
    eval: { kind: "hce", terms: [] },
  };
}

export function timeBlock(type: TimeBlockType): BlockInstance<TimeBlockType> {
  return { type, params: defaultParams(TIME_BLOCKS[type].params) };
}

/** Every MVP block with default parameters: generates the reference engine. */
export function referenceWorkspace(): Workspace {
  const ws = emptyWorkspace("CFS Reference", "WG");
  ws.engine.timeManagement = timeBlock("time_management");
  ws.engine.transpositionTable = defaultParams(TRANSPOSITION_TABLE.params);
  for (const type of Object.keys(SEARCH_BLOCKS) as SearchBlockType[]) {
    ws.search.slots[SEARCH_BLOCKS[type].slot].push(searchBlock(type));
  }
  ws.eval.terms = (Object.keys(EVAL_TERMS) as EvalTermType[]).map(evalTerm);
  return ws;
}

/** Bench depth that keeps plain negamax (no alpha-beta) quick. */
export const BARE_BENCH_DEPTH = 3;

/**
 * The starting point for beginners: bare bones. Plain negamax, basic time
 * management and PeSTO tables, so the engine plays legal, sensible chess and
 * every improvement is a block you add yourself.
 */
export function starterWorkspace(): Workspace {
  const ws = emptyWorkspace();
  ws.engine.benchDepth = BARE_BENCH_DEPTH;
  ws.engine.timeManagement = timeBlock("basic_time");
  ws.eval.terms = [evalTerm("pesto")];
  return ws;
}

export interface Issue {
  level: "error" | "warning";
  message: string;
}

function checkParams(where: string, specs: ParamSpec[], params: Params, issues: Issue[]): void {
  for (const spec of specs) {
    const value = params[spec.key];
    const label = `${where}: ${spec.label}`;
    const inRange = (n: unknown) =>
      typeof n === "number" &&
      Number.isFinite(n) &&
      (spec.min === undefined || n >= spec.min) &&
      (spec.max === undefined || n <= spec.max);
    const isInt = (n: unknown) => typeof n === "number" && Number.isInteger(n);
    const isScore = (s: unknown) =>
      Array.isArray(s) && s.length === 2 && s.every((n) => inRange(n) && isInt(n));

    let ok: boolean;
    switch (spec.type) {
      case "i32":
      case "u64":
      case "usize":
        ok = inRange(value) && isInt(value);
        break;
      case "f64":
        ok = inRange(value);
        break;
      case "S":
        ok = isScore(value);
        break;
      case "[S; 4]":
      case "[S; 8]": {
        const len = spec.type === "[S; 4]" ? 4 : 8;
        ok = Array.isArray(value) && value.length === len && value.every(isScore);
        break;
      }
    }
    if (!ok) {
      const range =
        spec.min !== undefined && spec.max !== undefined ? ` (${spec.min} to ${spec.max})` : "";
      issues.push({ level: "error", message: `${label} has an invalid value${range}.` });
    }
  }
}

/** Checks a workspace. Errors block code generation; warnings do not. */
export function validate(ws: Workspace): Issue[] {
  const issues: Issue[] = [];
  if (ws.format !== WORKSPACE_FORMAT_VERSION) {
    issues.push({ level: "error", message: `Unsupported workspace format ${String(ws.format)}.` });
    return issues;
  }
  if (!ws.engine.name.trim()) issues.push({ level: "error", message: "The engine needs a name." });
  const bd = ws.engine.benchDepth;
  if (!Number.isInteger(bd) || bd < 1 || bd > MAX_BENCH_DEPTH) {
    issues.push({ level: "error", message: `Bench depth must be a whole number from 1 to ${MAX_BENCH_DEPTH}.` });
  }

  const tm = ws.engine.timeManagement;
  if (tm) {
    const spec = TIME_BLOCKS[tm.type];
    if (!spec) issues.push({ level: "error", message: `Unknown time block "${tm.type}".` });
    else checkParams(spec.label, spec.params, tm.params, issues);
  }
  if (ws.engine.transpositionTable) {
    checkParams("Transposition table", TRANSPOSITION_TABLE.params, ws.engine.transpositionTable, issues);
  }

  const seen = new Set<string>();
  for (const slot of SEARCH_SLOTS) {
    for (const block of ws.search.slots[slot] ?? []) {
      const spec = SEARCH_BLOCKS[block.type];
      if (!spec) {
        issues.push({ level: "error", message: `Unknown search block "${block.type}".` });
        continue;
      }
      if (spec.slot !== slot) {
        issues.push({ level: "error", message: `${spec.label} cannot go in the ${slot} slot.` });
      }
      if (seen.has(block.type)) {
        issues.push({ level: "error", message: `${spec.label} is placed more than once.` });
      }
      seen.add(block.type);
      checkParams(spec.label, spec.params, block.params, issues);
    }
  }
  const placed = new Set(seen);
  if (ws.engine.transpositionTable) placed.add("transposition_table");
  for (const type of seen) {
    const spec = SEARCH_BLOCKS[type as SearchBlockType];
    for (const need of spec?.requires ?? []) {
      if (!placed.has(need)) {
        const label = need === "transposition_table" ? TRANSPOSITION_TABLE.label : SEARCH_BLOCKS[need].label;
        issues.push({ level: "error", message: `${spec!.label} needs ${label}.` });
      }
    }
  }
  if (ws.engine.transpositionTable && !seen.has("alpha_beta")) {
    issues.push({ level: "error", message: "Transposition table needs Alpha-beta pruning." });
  }

  const seenTerms = new Set<string>();
  for (const term of ws.eval.terms) {
    const spec = EVAL_TERMS[term.type];
    if (!spec) {
      issues.push({ level: "error", message: `Unknown eval term "${term.type}".` });
      continue;
    }
    if (seenTerms.has(term.type)) {
      issues.push({ level: "error", message: `${spec.label} is placed more than once.` });
    }
    seenTerms.add(term.type);
    checkParams(spec.label, spec.params, term.params, issues);
  }

  if (ws.eval.terms.length === 0) {
    issues.push({
      level: "warning",
      message: "The evaluation has no terms, so every position scores 0. Add PeSTO tables to start.",
    });
  } else if (!seenTerms.has("pesto")) {
    issues.push({
      level: "warning",
      message: "Without PeSTO tables the engine does not know piece values.",
    });
  }
  if (!seen.has("alpha_beta")) {
    issues.push({
      level: "warning",
      message: "Plain negamax searches every move. Add Alpha-beta pruning to search much deeper in the same time.",
    });
    if (ws.engine.benchDepth > BARE_BENCH_DEPTH) {
      issues.push({
        level: "warning",
        message: `Without alpha-beta pruning, bench depth above ${BARE_BENCH_DEPTH} can take minutes.`,
      });
    }
  } else if (!seen.has("quiescence")) {
    issues.push({
      level: "warning",
      message: "Without quiescence search the engine evaluates in the middle of captures.",
    });
  }
  return issues;
}

/** Names of every block region enabled in the Rust templates. */
export function enabledRegions(ws: Workspace, includeTests = false): Set<string> {
  const regions = new Set<string>();
  if (includeTests) regions.add("tests");
  if (ws.engine.transpositionTable) regions.add("transposition_table");
  // Without a time block the engine uses basic time management.
  regions.add(ws.engine.timeManagement?.type ?? "basic_time");
  for (const slot of SEARCH_SLOTS) {
    for (const block of ws.search.slots[slot]) regions.add(block.type);
  }
  for (const term of ws.eval.terms) regions.add(`eval_${term.type}`);
  return regions;
}

/** Every region name a template may use. */
export const KNOWN_REGIONS: ReadonlySet<string> = new Set([
  "tests",
  "basic_time",
  "time_management",
  "transposition_table",
  ...Object.keys(SEARCH_BLOCKS),
  ...Object.keys(EVAL_TERMS).map((t) => `eval_${t}`),
]);
