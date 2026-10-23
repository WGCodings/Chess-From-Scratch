/**
 * The workspace: the JSON document the editor saves and the generator reads.
 */

import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  SEARCH_SLOTS,
  TIME_BLOCKS,
  NEGAMAX_PARAMS,
  TRANSPOSITION_TABLE,
  defaultParams,
  evalSpec,
  searchSpec,
  skeletonSpec,
  type SkeletonType,
  type EvalTermType,
  type ParamSpec,
  type ParamValue,
  type SearchBlockType,
  type SearchSlot,
  type TimeBlockType,
} from "./blocks";
import { parseBlockFile, regionOf, type BlockFile, type Diagnostic } from "./blockfile";
import { customRegions, traceTemplate } from "./custom";
import { TEMPLATES } from "./embedded.generated";

export const WORKSPACE_FORMAT_VERSION = 2;

/** Low on purpose: a bench without pruning blocks must still finish in seconds. */
export const DEFAULT_BENCH_DEPTH = 5;
export const MAX_BENCH_DEPTH = 30;

export type Params = Record<string, ParamValue>;

export interface BlockInstance<T extends string> {
  type: T;
  params: Params;
}

/** The kinds of search that plug into the engine; "none" while the slot is empty. */
export type SearchKind = "negamax" | "random_mover" | "none";

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
    kind: SearchKind;
    /** Negamax's own parameters (its fixed depth). */
    params: Params;
    /** Built-in block types or ids of custom blocks. */
    slots: Record<SearchSlot, BlockInstance<string>[]>;
  };
  eval: {
    kind: "hce" | "none";
    /** The Tapered evaluation block is placed: blend middlegame and endgame by phase. */
    taper: boolean;
    /** Built-in eval terms or ids of custom blocks. */
    terms: BlockInstance<string>[];
  };
  /**
   * Your own versions of skeleton blocks: skeleton type (engine, negamax,
   * hce, taper, transposition_table, basic_time, ...) → custom block id.
   */
  versions?: Partial<Record<SkeletonType, string>>;
  /**
   * Parameters of your versions of the Engine, Random mover, Hand-crafted
   * evaluation and Tapered evaluation (the built-in ones have none; the
   * others keep theirs in `search.params`, `timeManagement` and `transpositionTable`).
   */
  versionParams?: Partial<Record<SkeletonType, Params>>;
  /** This project's custom blocks: id → block file text (`<id>.block.rs`). */
  customBlocks?: Record<string, string>;
}

/**
 * Fills in parts older saved workspaces lack, and upgrades format 1: back
 * then iterative deepening, draw detection and tapering were always on, so
 * they become blocks.
 */
export function normalizeWorkspace(ws: Workspace): Workspace {
  const w = ws as unknown as { format: number };
  for (const slot of SEARCH_SLOTS) ws.search.slots[slot] ??= [];
  ws.customBlocks ??= {};
  ws.versions ??= {};
  ws.search.params ??= defaultParams(NEGAMAX_PARAMS);
  if (w.format === 1) {
    w.format = WORKSPACE_FORMAT_VERSION;
    const has = (t: string) => SEARCH_SLOTS.some((s) => ws.search.slots[s].some((b) => b.type === t));
    if (!has("iterative_deepening")) ws.search.slots.root.unshift({ type: "iterative_deepening", params: {} });
    if (!has("draw_detection")) ws.search.slots.pruning.unshift({ type: "draw_detection", params: {} });
    ws.eval.taper = true;
    // Format 1 always had negamax and the hand-crafted evaluation.
    ws.search.kind = "negamax";
    ws.eval.kind = "hce";
  }
  ws.versionParams ??= {};
  ws.eval.taper ??= false;
  return ws;
}

/**
 * A skeleton's stored parameters as your version's parameters: values kept
 * under the built-in keys (from before the version existed) move to the
 * version's parameter with the same Rust name; missing ones get defaults.
 */
export function asVersionParams(builtin: ParamSpec[], version: ParamSpec[], params: Params): Params {
  const out: Params = defaultParams(version);
  for (const p of builtin) {
    const q = version.find((v) => v.rust === p.rust && v.type === p.type);
    if (q && params[p.key] !== undefined) out[q.key] = params[p.key]!;
  }
  for (const v of version) if (params[v.key] !== undefined) out[v.key] = params[v.key]!;
  return out;
}

const parsed = new Map<string, { block: BlockFile | null; diagnostics: Diagnostic[] }>();

/** Parses a block file, cached by its text. */
export function parseBlock(source: string): { block: BlockFile | null; diagnostics: Diagnostic[] } {
  let r = parsed.get(source);
  if (!r) {
    r = parseBlockFile(source);
    if (parsed.size > 500) parsed.clear();
    parsed.set(source, r);
  }
  return r;
}

/** The custom block with this id in the workspace, if it parses. */
export function customBlock(ws: Workspace, id: string): BlockFile | null {
  const src = ws.customBlocks?.[id];
  return src === undefined ? null : parseBlock(src).block;
}

/** Placed custom blocks in placement order: search slots, then eval terms. */
export function placedCustomBlocks(ws: Workspace): BlockFile[] {
  const out: BlockFile[] = [];
  const add = (type: string) => {
    if (searchSpec(type) || evalSpec(type)) return;
    const b = customBlock(ws, type);
    if (b && !out.includes(b)) out.push(b);
  };
  // Versions of skeleton blocks first: they hold everything else.
  for (const id of Object.values(ws.versions ?? {})) if (id) add(id);
  for (const slot of SEARCH_SLOTS) for (const b of ws.search.slots[slot] ?? []) add(b.type);
  for (const t of ws.eval.terms) add(t.type);
  return out;
}

function searchBlock(type: SearchBlockType): BlockInstance<string> {
  return { type, params: defaultParams(SEARCH_BLOCKS[type].params) };
}

function evalTerm(type: EvalTermType): BlockInstance<string> {
  return { type, params: defaultParams(EVAL_TERMS[type].params) };
}

/** Just the Engine block: nothing plugged in yet. */
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
      kind: "none",
      params: defaultParams(NEGAMAX_PARAMS),
      slots: { root: [], pruning: [], ordering: [], extensions: [], move_loop: [], reductions: [], leaf: [] },
    },
    eval: { kind: "none", taper: false, terms: [] },
    versions: {},
    versionParams: {},
    customBlocks: {},
  };
}

export function timeBlock(type: TimeBlockType): BlockInstance<TimeBlockType> {
  return { type, params: defaultParams(TIME_BLOCKS[type].params) };
}

/** Every MVP block with default parameters: generates the reference engine. */
export function referenceWorkspace(): Workspace {
  const ws = emptyWorkspace("CFS Reference", "WG");
  ws.search.kind = "negamax";
  ws.eval.kind = "hce";
  ws.eval.taper = true;
  ws.engine.timeManagement = timeBlock("time_management");
  ws.engine.transpositionTable = defaultParams(TRANSPOSITION_TABLE.params);
  for (const type of Object.keys(SEARCH_BLOCKS) as SearchBlockType[]) {
    ws.search.slots[SEARCH_BLOCKS[type].slot].push(searchBlock(type));
  }
  // Material and the empty piece-square tables are the simple alternative to PeSTO.
  ws.eval.terms = (Object.keys(EVAL_TERMS) as EvalTermType[]).filter((t) => t !== "material" && t !== "psqt").map(evalTerm);
  return ws;
}

/** Bench depth that keeps plain negamax (no alpha-beta) quick. */
export const BARE_BENCH_DEPTH = 3;

/**
 * The starting point for beginners: an engine with plain fixed-depth negamax
 * and an evaluation without terms. Every improvement is a block you add
 * yourself, starting with Material.
 */
export function starterWorkspace(): Workspace {
  const ws = emptyWorkspace();
  ws.engine.benchDepth = BARE_BENCH_DEPTH;
  ws.search.kind = "negamax";
  ws.eval.kind = "hce";
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
  normalizeWorkspace(ws);
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
  const versions = ws.versions ?? {};
  if (tm && !TIME_BLOCKS[tm.type]) issues.push({ level: "error", message: `Unknown time block "${tm.type}".` });

  // Custom blocks: their files must parse; the ones placed are checked like built-ins.
  const custom = new Map<string, BlockFile>();
  for (const [id, src] of Object.entries(ws.customBlocks ?? {})) {
    const { block, diagnostics } = parseBlock(src);
    const errors = diagnostics.filter((d) => d.level === "error");
    if (!block || errors.length) {
      const first = errors[0];
      issues.push({
        level: "error",
        message: `Block file ${id}.block.rs: ${first ? `${first.line ? `line ${first.line}: ` : ""}${first.message}` : "cannot be read."}`,
      });
      continue;
    }
    if (block.id !== id) {
      issues.push({ level: "error", message: `Block file ${id}.block.rs has id "${block.id}"; they must match.` });
      continue;
    }
    custom.set(id, block);
  }

  const seen = new Set<string>();
  const forkOf = new Map<string, string>();
  const paramOwner = new Map<string, string>();
  const claimParams = (label: string, specs: ParamSpec[]) => {
    for (const p of specs) {
      const other = paramOwner.get(p.rust);
      if (other && other !== label) {
        issues.push({ level: "error", message: `Parameter ${p.rust} is used by both ${other} and ${label}; rename one.` });
      }
      paramOwner.set(p.rust, label);
    }
  };
  for (const name of ["ENGINE_NAME", "ENGINE_AUTHOR", "ENGINE_BENCH_DEPTH"]) paramOwner.set(name, "Engine");

  // Skeleton blocks, built in or your own version: their parameters live in the workspace.
  const skeletonParams: [SkeletonType, Params | null][] = [
    ["negamax", ws.search.kind === "negamax" ? ws.search.params : null],
    ["transposition_table", ws.engine.transpositionTable],
    [tm?.type ?? "basic_time", tm ? tm.params : null],
    ["engine", ws.versionParams?.engine ?? {}],
    ["random_mover", ws.search.kind === "random_mover" ? (ws.versionParams?.random_mover ?? {}) : null],
    ["hce", ws.eval.kind === "hce" ? (ws.versionParams?.hce ?? {}) : null],
    ["taper", ws.eval.kind === "hce" && ws.eval.taper ? (ws.versionParams?.taper ?? {}) : null],
  ];
  for (const [type, params] of skeletonParams) {
    const vid = versions[type];
    const version = vid ? custom.get(vid) : undefined;
    const spec = skeletonSpec(type);
    const isPlaced = params !== null || (type === "basic_time" && !tm);
    if (!isPlaced || !spec) continue;
    if (version) {
      claimParams(version.label, version.params);
      if (params) checkParams(version.label, version.params, asVersionParams(spec.params, version.params, params), issues);
    } else {
      claimParams(spec.label, spec.params);
      if (params) checkParams(spec.label, spec.params, params, issues);
    }
  }
  for (const [type, id] of Object.entries(versions) as [SkeletonType, string][]) {
    if (!id) continue;
    const b = custom.get(id);
    if (!b) {
      if (!ws.customBlocks?.[id]) {
        issues.push({ level: "error", message: `Unknown block "${id}" (your version of ${skeletonSpec(type)?.label ?? type}).` });
      }
      continue;
    }
    if (b.base !== type) issues.push({ level: "error", message: `${b.label} is not a version of ${skeletonSpec(type)?.label ?? type}.` });
  }

  // What plugs into the engine.
  if (ws.search.kind === "none") {
    issues.push({ level: "error", message: "Plug a search into the engine: Negamax search or Random mover." });
  } else if (ws.search.kind === "negamax" && ws.eval.kind === "none") {
    issues.push({ level: "error", message: "Negamax needs an evaluation: plug Hand-crafted evaluation into the engine." });
  }
  if (ws.search.kind !== "negamax" && SEARCH_SLOTS.some((s) => ws.search.slots[s].length)) {
    issues.push({ level: "error", message: "Search blocks go into the slots of Negamax search." });
  }

  const checkCustom = (block: BlockInstance<string>, where: string): BlockFile | null => {
    const b = custom.get(block.type);
    if (!b) {
      if (!ws.customBlocks?.[block.type]) issues.push({ level: "error", message: `Unknown ${where} "${block.type}".` });
      return null;
    }
    if (seen.has(b.id)) issues.push({ level: "error", message: `${b.label} is placed more than once.` });
    seen.add(b.id);
    if (b.base) {
      const other = forkOf.get(b.base);
      if (other) issues.push({ level: "error", message: `${b.label} and ${other} are both versions of the same block; keep one.` });
      forkOf.set(b.base, b.label);
    }
    claimParams(b.label, b.params);
    checkParams(b.label, b.params, { ...defaultParams(b.params), ...block.params }, issues);
    return b;
  };

  for (const slot of SEARCH_SLOTS) {
    for (const block of ws.search.slots[slot] ?? []) {
      const spec = searchSpec(block.type);
      if (!spec) {
        const b = checkCustom(block, "search block");
        if (b && b.slot !== slot) issues.push({ level: "error", message: `${b.label} cannot go in the ${slot} slot.` });
        continue;
      }
      if (spec.slot !== slot) {
        issues.push({ level: "error", message: `${spec.label} cannot go in the ${slot} slot.` });
      }
      if (seen.has(block.type)) {
        issues.push({ level: "error", message: `${spec.label} is placed more than once.` });
      }
      seen.add(block.type);
      claimParams(spec.label, spec.params);
      checkParams(spec.label, spec.params, block.params, issues);
    }
  }

  const seenTerms = new Set<string>();
  for (const term of ws.eval.terms) {
    const spec = evalSpec(term.type);
    if (!spec) {
      const b = checkCustom(term, "eval term");
      if (b && b.slot !== "eval") issues.push({ level: "error", message: `${b.label} is not an eval term.` });
      if (b?.base) seenTerms.add(b.base);
      continue;
    }
    if (seenTerms.has(term.type)) {
      issues.push({ level: "error", message: `${spec.label} is placed more than once.` });
    }
    seenTerms.add(term.type);
    claimParams(spec.label, spec.params);
    checkParams(spec.label, spec.params, term.params, issues);
  }

  // A version of a block counts as that block for requirements; base and version can't mix.
  const placed = new Set(seen);
  for (const [base, label] of forkOf) {
    if (seen.has(base) || (evalSpec(base) && ws.eval.terms.some((t) => t.type === base))) {
      const spec = searchSpec(base) ?? evalSpec(base)!;
      issues.push({ level: "error", message: `${label} replaces ${spec.label}; remove one of them.` });
    }
    placed.add(base);
  }
  if (ws.engine.transpositionTable) placed.add("transposition_table");
  for (const t of seenTerms) placed.add(t);
  if (ws.search.kind !== "none") placed.add(ws.search.kind);
  if (ws.eval.kind === "hce") placed.add("hce");
  if (ws.eval.kind === "hce" && ws.eval.taper) placed.add("taper");
  for (const id of Object.values(versions)) if (id) placed.add(id);
  const labelOf = (need: string) =>
    need === "transposition_table"
      ? TRANSPOSITION_TABLE.label
      : (searchSpec(need)?.label ?? evalSpec(need)?.label ?? custom.get(need)?.label ?? need);
  for (const type of seen) {
    const spec = searchSpec(type);
    const label = spec?.label ?? custom.get(type)?.label ?? type;
    const requires = spec?.requires ?? custom.get(type)?.requires ?? [];
    for (const need of requires) {
      if (!placed.has(need) && !(custom.has(need) && seen.has(need))) {
        issues.push({ level: "error", message: `${label} needs ${labelOf(need)}.` });
      }
    }
  }
  // Inserts and replacements must find their line in the generated code.
  const blocks = placedCustomBlocks(ws);
  const files = new Set(
    blocks.flatMap((b) => b.sections.flatMap((s) => ((s.kind === "insert" || s.kind === "replace") && s.file.replace(/\.rs$/, "") in TEMPLATES ? [s.file] : []))),
  );
  for (const file of files) {
    const traced = traceTemplate(TEMPLATES[file.replace(/\.rs$/, "") as keyof typeof TEMPLATES], file, blocks, enabledRegions(ws));
    for (const m of traced.missed ?? []) {
      const b = blocks.find((x) => x.id === m.block);
      issues.push({ level: "error", message: `${b?.label ?? m.block}: ${m.why}.` });
    }
  }
  if (ws.engine.transpositionTable && !placed.has("alpha_beta")) {
    issues.push({ level: "error", message: "Transposition table needs Alpha-beta pruning." });
  }

  if (ws.eval.kind === "hce") {
    if (ws.eval.terms.length === 0) {
      issues.push({
        level: "warning",
        message: "The evaluation has no terms, so every position scores 0. Add Material to start.",
      });
    } else if (!seenTerms.has("pesto") && !seenTerms.has("material")) {
      issues.push({
        level: "warning",
        message: "Without Material (or PeSTO tables) the engine does not know piece values.",
      });
    }
  }
  if (tm && !placed.has("iterative_deepening")) {
    issues.push({
      level: "warning",
      message: "Time management only matters with Iterative deepening; without it the engine searches a fixed depth.",
    });
  }
  if (ws.search.kind !== "negamax") return issues;
  if (!placed.has("iterative_deepening")) {
    const depth = ws.search.params.depth ?? NEGAMAX_PARAMS[0]!.default;
    issues.push({
      level: "warning",
      message: `Without Iterative deepening the engine searches depth ${String(depth)} on every move and ignores the clock.`,
    });
  }
  if (!placed.has("alpha_beta")) {
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
  } else if (!placed.has("quiescence")) {
    issues.push({
      level: "warning",
      message: "Without quiescence search the engine evaluates in the middle of captures.",
    });
  }
  return issues;
}

/** Names of every block region enabled in the Rust templates. */
export function enabledRegions(ws: Workspace, includeTests = false): Set<string> {
  const regions = new Set<string>(["engine"]);
  if (includeTests) regions.add("tests");
  if (ws.search.kind !== "none") regions.add(ws.search.kind);
  if (ws.eval.kind === "hce") regions.add("hce");
  if (ws.eval.kind === "hce" && ws.eval.taper) regions.add("taper");
  if (ws.engine.transpositionTable) regions.add("transposition_table");
  // Without a time block the engine uses basic time management.
  regions.add(ws.engine.timeManagement?.type ?? "basic_time");
  for (const slot of SEARCH_SLOTS) {
    for (const block of ws.search.slots[slot] ?? []) if (searchSpec(block.type)) regions.add(block.type);
  }
  for (const term of ws.eval.terms) if (evalSpec(term.type)) regions.add(regionOf(term.type));
  for (const r of customRegions(placedCustomBlocks(ws))) regions.add(r);
  // Which files exist, for the lines that mention them (main.rs).
  if (regions.has("hce")) regions.add("file_eval");
  if (regions.has("eval_psqt")) regions.add("file_psqt");
  if (regions.has("transposition_table")) regions.add("file_tt");
  return regions;
}

/** Every region name a template may use. */
export const KNOWN_REGIONS: ReadonlySet<string> = new Set([
  "tests",
  "engine",
  "negamax",
  "random_mover",
  "hce",
  "taper",
  "basic_time",
  "time_management",
  "transposition_table",
  ...Object.keys(SEARCH_BLOCKS),
  ...Object.keys(EVAL_TERMS).map((t) => `eval_${t}`),
]);
