/**
 * Block files: one readable text file per block, `<id>.block.rs`.
 *
 *     //! ---
 *     //! id: my_null_move_pruning
 *     //! label: My null move pruning
 *     //! slot: pruning
 *     //! base: null_move_pruning
 *     //! requires: alpha_beta
 *     //! description: One line, shown as the tooltip.
 *     //! info: A short explanation, shown in the tour.
 *     //! params:
 *     //!   NMP_MIN_DEPTH: i32 = 3 (1..32) "From depth"
 *     //! ---
 *
 *     // @region search.rs 1
 *     ...replaces the first region of the base block in search.rs...
 *     // @hook on_cutoff
 *     ...inserted at a hook in the skeleton...
 *     // @insert position.rs after "pub struct Position {"
 *     ...inserted after an exact line of a file...
 *     // @file src/see.rs
 *     ...a whole new file...
 *
 * Built-in blocks are forked into this format ("Edit this block"); new blocks
 * are written in it from scratch. The code itself is the author's
 * responsibility: we check the file's structure, not whether it compiles.
 */

import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  SEARCH_SLOTS,
  evalSpec,
  searchSpec,
  type ParamSpec,
  type ParamValue,
  type RustType,
  type Score,
  type SearchSlot,
} from "./blocks";
import { EXAMPLE_BLOCKS, TEMPLATES } from "./embedded.generated";

export { EXAMPLE_BLOCKS, TEMPLATES };
import { isPseudo } from "./template";

/** Where a custom block can be placed: a search slot or the evaluation. */
export type CustomSlot = SearchSlot | "eval";

export const CUSTOM_SLOTS: readonly CustomSlot[] = [...SEARCH_SLOTS, "eval"];

export type Section =
  | { kind: "region"; file: string; index: number; body: string; line: number }
  | { kind: "hook"; hook: string; body: string; line: number }
  | { kind: "insert"; file: string; anchor: string; nth?: number; body: string; line: number }
  | { kind: "file"; path: string; body: string; line: number };

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type SectionHead = DistOmit<Section, "body">;

export interface BlockFile {
  id: string;
  label: string;
  slot: CustomSlot;
  /** The built-in block this one is a version of (forks only). */
  base?: string;
  requires: string[];
  description: string;
  info: string;
  cpw?: string;
  /** Parameters; `key` and `rust` are both the plain name the author chose. */
  params: ParamSpec[];
  sections: Section[];
}

export interface Diagnostic {
  level: "error" | "warning";
  /** 1-based line in the block file (0 = the file as a whole). */
  line: number;
  message: string;
}

/**
 * Hooks: named places in the skeleton where blocks add code. There is one per
 * slot, named like the slot, at the place blocks of that slot work; the
 * others are support hooks for fields, setup and helper functions.
 */
export const HOOKS: Record<string, { file: string; description: string; slot?: CustomSlot }> = {
  root: { file: "search.rs", slot: "root", description: "Runs once at the start of every search." },
  pruning: {
    file: "search.rs",
    slot: "pruning",
    description:
      "Before the move loop; `return` a score to prune. Available: pos, board, depth, ply, alpha, beta, in_check, static_eval, pv_node, stm.",
  },
  ordering: {
    file: "search.rs",
    slot: "ordering",
    description:
      "Scores one move for ordering: set `order` (higher is tried first; 0 = not scored yet). Available: mv, board, ply, stm, tt_move.",
  },
  extensions: {
    file: "search.rs",
    slot: "extensions",
    description:
      "After a move is made: add to `extension` to search it deeper. Available: mv, pos (after the move), board (before), depth, ply, quiet, in_check, i (move number).",
  },
  move_loop: {
    file: "search.rs",
    slot: "move_loop",
    description: "After each move is searched and taken back. Available: mv, score, best_score, depth, ply, i (move number), quiet.",
  },
  reductions: {
    file: "search.rs",
    slot: "reductions",
    description:
      "After a move is made: subtract from `extension` to search it shallower. Available: mv, pos, board, depth, ply, quiet, in_check, i (move number).",
  },
  leaf: { file: "search.rs", slot: "leaf", description: "At depth 0, before the leaf is scored; `return` a score to use it. Available: pos, ply, alpha, beta." },
  eval: {
    file: "eval.rs",
    slot: "eval",
    description: "Adds to the evaluation: `score += S(mg, eg);` from White's point of view. Available: board, score.",
  },
  search_imports: { file: "search.rs", description: "Support: `use` lines at the top of search.rs." },
  searcher_fields: { file: "search.rs", description: "Support: fields of the Searcher struct, e.g. `counters: [i32; 64],`." },
  searcher_init: { file: "search.rs", description: "Support: initial values for your Searcher fields, e.g. `counters: [0; 64],`." },
  new_game: { file: "search.rs", description: "Support: runs on `ucinewgame`; clear tables here." },
  node_start: {
    file: "search.rs",
    description: "Support: start of every node, after the TT probe. Available: pos, board, depth, ply, alpha, beta, in_check, pv_node, stm, tt_move.",
  },
  on_cutoff: {
    file: "search.rs",
    description: "Support: a move caused a beta cutoff (needs Alpha-beta pruning). Available: mv, depth, ply, quiet, stm.",
  },
  search_helpers: { file: "search.rs", description: "Support: functions and types at the end of search.rs." },
  eval_helpers: { file: "eval.rs", description: "Support: functions at the end of eval.rs." },
};

/** Old hook names, still accepted in block files. */
export const HOOK_ALIASES: Record<string, string> = { search_start: "root", move_order: "ordering", eval_terms: "eval" };

/** The hook a slot's blocks normally use. */
export const SLOT_HOOK: Record<CustomSlot, string> = Object.fromEntries(
  Object.entries(HOOKS).flatMap(([name, h]) => (h.slot ? [[h.slot, name]] : [])),
) as Record<CustomSlot, string>;

/** Skeleton values a custom block can use; mentioning one generates it. */
export const SKELETON_VALUES: Record<string, string> = {
  pv_node: "use_pv_node",
  static_eval: "use_static_eval",
  stm: "use_stm",
  quiet: "use_quiet",
  tt_move: "use_tt_move",
  is_capture: "use_is_capture",
  is_quiet: "use_quiet",
};

const RUST_TYPES: readonly RustType[] = ["i32", "u64", "usize", "f64", "S", "[S; 4]", "[S; 8]"];

/** Files a block may write into besides the templates. */
export const GENERATED_RS = ["main.rs", "params.rs"];

/** The region name a built-in block uses in the templates. */
export function regionOf(type: string): string {
  return evalSpec(type) ? `eval_${type}` : type;
}

export function templateNames(): string[] {
  return Object.keys(TEMPLATES).map((n) => `${n}.rs`);
}

// --- Regions in templates ------------------------------------------------------------------

const BLOCK = /^(\s*)\/\/ @block ([\w|]+)\s*$/;
const ELSE = /^\s*\/\/ @else\s*$/;
const END = /^\s*\/\/ @end ([\w|]+)\s*$/;

export interface RegionSpan {
  /** Line index of `// @block`. */
  start: number;
  /** Line index of `// @else`, if any. */
  else?: number;
  /** Line index of `// @end`. */
  end: number;
  indent: string;
}

/** Every region that belongs to `name` alone (pseudo names ignored), in order. */
export function findRegions(source: string, name: string): RegionSpan[] {
  const lines = source.split("\n");
  const out: RegionSpan[] = [];
  const stack: { mine: boolean; span: RegionSpan }[] = [];
  lines.forEach((line, i) => {
    const b = BLOCK.exec(line);
    if (b) {
      const real = b[2]!.split("|").filter((n) => !isPseudo(n));
      stack.push({ mine: real.length === 1 && real[0] === name, span: { start: i, end: i, indent: b[1]! } });
    } else if (ELSE.test(line)) {
      const top = stack.at(-1);
      if (top && top.span.else === undefined) top.span.else = i;
    } else if (END.test(line)) {
      const top = stack.pop();
      if (top?.mine) {
        top.span.end = i;
        out.push(top.span);
      }
    }
  });
  return out.sort((a, b) => a.start - b.start);
}

// --- Text helpers ----------------------------------------------------------------------------

/** Removes the common indentation and the blank lines around a body. */
export function dedent(lines: string[]): string[] {
  let ls = [...lines];
  while (ls.length && ls[0]!.trim() === "") ls.shift();
  while (ls.length && ls.at(-1)!.trim() === "") ls.pop();
  const indents = ls.filter((l) => l.trim() !== "").map((l) => /^\s*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  ls = ls.map((l) => (l.trim() === "" ? "" : l.slice(cut)));
  return ls;
}

export function indentLines(body: string, indent: string): string[] {
  if (body === "") return [];
  return body.split("\n").map((l) => (l.trim() === "" ? "" : indent + l));
}

function formatScore([mg, eg]: Score): string {
  return `S(${mg}, ${eg})`;
}

export function formatValue(type: RustType, value: ParamValue): string {
  switch (type) {
    case "S":
      return formatScore(value as Score);
    case "[S; 4]":
    case "[S; 8]":
      return `[${(value as Score[]).map(formatScore).join(", ")}]`;
    case "f64": {
      const n = value as number;
      return Number.isInteger(n) ? n.toFixed(1) : String(n);
    }
    default:
      return String(value);
  }
}

function parseScore(text: string): Score | null {
  const m = /^S\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function parseValue(type: RustType, text: string): ParamValue | null {
  const t = text.trim();
  switch (type) {
    case "S":
      return parseScore(t);
    case "[S; 4]":
    case "[S; 8]": {
      const len = type === "[S; 4]" ? 4 : 8;
      if (!t.startsWith("[") || !t.endsWith("]")) return null;
      const items = t.slice(1, -1).match(/S\([^)]*\)/g) ?? [];
      const scores = items.map(parseScore);
      if (scores.length !== len || scores.some((s) => !s)) return null;
      return scores as Score[];
    }
    case "f64":
      return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
    default: {
      if (!/^-?\d[\d_]*$/.test(t)) return null;
      const n = Number(t.replace(/_/g, ""));
      if (type !== "i32" && n < 0) return null;
      return n;
    }
  }
}

export function formatParam(p: ParamSpec): string {
  const range = p.min !== undefined && p.max !== undefined ? ` (${p.min}..${p.max})` : "";
  const label = p.label && p.label !== p.rust ? ` "${p.label.replace(/"/g, "'")}"` : "";
  return `${p.rust}: ${p.type} = ${formatValue(p.type, p.default)}${range}${label}`;
}

const PARAM = /^([A-Za-z_]\w*)\s*:\s*(\[S;\s*\d+\]|\w+)\s*=\s*(.+?)(?:\s*\(\s*(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)\s*\))?(?:\s*"([^"]*)")?\s*$/;

// --- Parsing ---------------------------------------------------------------------------------

const HEADER_LINE = /^\/\/!\s?(.*)$/;
/** Section lines start at the beginning of a line; indented ones are code (e.g. a hook inside a fork). */
const SECTION = /^\/\/ @(region|hook|insert|file)\b\s*(.*?)\s*$/;

/** Parses a block file. `block` is null when the file cannot be understood at all. */
export function parseBlockFile(source: string): { block: BlockFile | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const error = (line: number, message: string) => diagnostics.push({ level: "error", line, message });
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  // Header between the two `//! ---` lines.
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() !== "//! ---") {
    error(i + 1, "A block file starts with a header between two `//! ---` lines.");
    return { block: null, diagnostics };
  }
  const fields = new Map<string, { value: string; line: number }>();
  const params: { text: string; line: number }[] = [];
  let lastKey: string | null = null;
  let closed = false;
  for (i++; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "//! ---") {
      closed = true;
      i++;
      break;
    }
    const m = HEADER_LINE.exec(raw.trim());
    if (!m) {
      error(i + 1, "Header lines start with `//!`.");
      continue;
    }
    const text = m[1]!;
    if (text.trim() === "") continue;
    const continued = /^\s{2,}/.test(text) || /^\s*-\s/.test(text);
    if (continued && lastKey === "params") {
      params.push({ text: text.trim().replace(/^-\s*/, ""), line: i + 1 });
      continue;
    }
    if (continued && lastKey) {
      const f = fields.get(lastKey)!;
      f.value = `${f.value} ${text.trim()}`.trim();
      continue;
    }
    const kv = /^([a-z_]+)\s*:\s*(.*)$/.exec(text.trim());
    if (!kv) {
      error(i + 1, `Expected \`key: value\` in the header, got "${text.trim()}".`);
      continue;
    }
    const key = kv[1]!;
    if (fields.has(key)) error(i + 1, `"${key}" appears twice in the header.`);
    fields.set(key, { value: kv[2]!.trim(), line: i + 1 });
    lastKey = key;
  }
  if (!closed) {
    error(lines.length, "The header is never closed with `//! ---`.");
    return { block: null, diagnostics };
  }

  const field = (k: string) => fields.get(k)?.value ?? "";
  const lineOf = (k: string) => fields.get(k)?.line ?? 1;
  const known = new Set(["id", "label", "slot", "base", "requires", "description", "info", "cpw", "params"]);
  for (const [k, f] of fields) if (!known.has(k)) error(f.line, `Unknown header field "${k}".`);

  const id = field("id");
  if (!id) error(1, "The header needs an `id`.");
  else if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    error(lineOf("id"), "The id uses lowercase letters, digits and underscores, starting with a letter.");
  }
  const label = field("label") || id;
  const slotText = field("slot");
  const slot = slotText as CustomSlot;
  if (!CUSTOM_SLOTS.includes(slot)) {
    error(lineOf("slot"), `The slot must be one of: ${CUSTOM_SLOTS.join(", ")}.`);
  }
  const base = field("base") || undefined;

  const parsedParams: ParamSpec[] = [];
  if (fields.has("params") && field("params") !== "") {
    error(lineOf("params"), "Put each parameter on its own indented line below `params:`.");
  }
  for (const p of params) {
    const m = PARAM.exec(p.text);
    if (!m) {
      error(p.line, 'A parameter looks like `NAME: i32 = 4 (1..10) "Label"`.');
      continue;
    }
    const [, name, typeText, valueText, min, max, plabel] = m;
    const type = typeText!.replace(/;\s*/, "; ") as RustType;
    if (!RUST_TYPES.includes(type)) {
      error(p.line, `Parameter types: ${RUST_TYPES.join(", ")}.`);
      continue;
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(name!)) {
      error(p.line, `Parameter names are UPPER_SNAKE_CASE, like Rust constants: ${name}.`);
    }
    const value = parseValue(type, valueText!);
    if (value === null) {
      error(p.line, `"${valueText}" is not a valid ${type} value.`);
      continue;
    }
    const spec: ParamSpec = { key: name!, rust: name!, label: plabel ?? name!, type, default: value };
    if (min !== undefined && max !== undefined) {
      spec.min = Number(min);
      spec.max = Number(max);
      if (spec.min > spec.max) error(p.line, "The range minimum is above the maximum.");
      if (typeof value === "number" && (value < spec.min || value > spec.max)) {
        error(p.line, `The default ${value} is outside ${spec.min}..${spec.max}.`);
      }
    }
    if (parsedParams.some((q) => q.rust === spec.rust)) error(p.line, `Parameter ${spec.rust} is declared twice.`);
    parsedParams.push(spec);
  }

  // Sections.
  const sections: Section[] = [];
  let current: { head: SectionHead | null; body: string[] } = { head: null, body: [] };
  const flush = () => {
    if (current.head) sections.push({ ...current.head, body: dedent(current.body).join("\n") } as Section);
  };
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const m = SECTION.exec(line);
    if (!m) {
      if (current.head) current.body.push(line);
      else if (line.trim() !== "" && !line.trim().startsWith("//")) {
        error(i + 1, "Code must follow a section line such as `// @hook pruning`.");
      }
      continue;
    }
    flush();
    current = { head: null, body: [] };
    const [, kind, rest] = m;
    const n = i + 1;
    if (kind === "region") {
      const r = /^(\S+)\s+(\d+)$/.exec(rest!);
      if (!r) error(n, "Write `// @region <file> <n>`, for example `// @region search.rs 1`.");
      else current.head = { kind: "region", file: r[1]!, index: Number(r[2]), line: n };
    } else if (kind === "hook") {
      if (!/^\w+$/.test(rest!)) error(n, "Write `// @hook <name>`, for example `// @hook pruning`.");
      else current.head = { kind: "hook", hook: HOOK_ALIASES[rest!] ?? rest!, line: n };
    } else if (kind === "insert") {
      const r = /^(\S+)\s+after\s+"(.*)"(?:\s+#(\d+))?$/.exec(rest!);
      if (!r) error(n, 'Write `// @insert <file> after "<exact line>"`, optionally followed by `#2` for its 2nd occurrence.');
      else current.head = { kind: "insert", file: r[1]!, anchor: r[2]!, ...(r[3] ? { nth: Number(r[3]) } : {}), line: n };
    } else {
      if (!rest) error(n, "Write `// @file <path>`, for example `// @file src/see.rs`.");
      else current.head = { kind: "file", path: rest, line: n };
    }
  }
  flush();

  const block: BlockFile = {
    id,
    label,
    slot,
    base,
    requires: field("requires")
      .split(/[\s,]+/)
      .filter(Boolean),
    description: field("description"),
    info: field("info"),
    cpw: field("cpw") || undefined,
    params: parsedParams,
    sections,
  };
  checkBlock(block, diagnostics, lineOf);
  return { block, diagnostics };
}

/** Structural checks that need the templates: base, regions, hooks, anchors, files. */
function checkBlock(b: BlockFile, d: Diagnostic[], lineOf: (k: string) => number): void {
  const error = (line: number, message: string) => d.push({ level: "error", line, message });
  const warn = (line: number, message: string) => d.push({ level: "warning", line, message });

  if (b.id && (searchSpec(b.id) || evalSpec(b.id) || reservedId(b.id))) {
    error(lineOf("id"), `"${b.id}" is already used by a built-in block; pick another id.`);
  }
  if (b.base) {
    const s = searchSpec(b.base);
    const e = evalSpec(b.base);
    if (!s && !e) error(lineOf("base"), `Unknown base block "${b.base}".`);
    else if (s && s.slot !== b.slot) error(lineOf("slot"), `A version of ${s.label} goes in the ${s.slot} slot.`);
    else if (e && b.slot !== "eval") error(lineOf("slot"), `A version of ${e.label} goes in the eval slot.`);
  }
  for (const r of b.requires) {
    if (r !== "transposition_table" && !searchSpec(r) && !/^[a-z][a-z0-9_]*$/.test(r)) {
      error(lineOf("requires"), `Unknown requirement "${r}".`);
    }
  }
  if (b.sections.length === 0) warn(0, "This block has no code sections yet, so it adds nothing.");

  const files = new Set(templateNames());
  for (const s of b.sections) {
    const unbalanced = bracketProblem(s.body);
    // A region may open a brace the skeleton closes (a function signature); compare with the original.
    if (unbalanced && !(s.kind === "region" && b.base && originalProblem(b.base, s.file, s.index) === unbalanced)) {
      warn(s.line, unbalanced);
    }
    switch (s.kind) {
      case "region": {
        if (!b.base) {
          error(s.line, "`@region` replaces code of a base block; this block has no `base`.");
          break;
        }
        if (!files.has(s.file)) {
          error(s.line, `Unknown file "${s.file}". Files: ${[...files].join(", ")}.`);
          break;
        }
        const count = findRegions(TEMPLATES[s.file.slice(0, -3) as keyof typeof TEMPLATES], regionOf(b.base)).length;
        if (s.index < 1 || s.index > count) {
          error(
            s.line,
            count === 0
              ? `${b.base} has no regions in ${s.file}.`
              : `${s.file} has ${count} region${count > 1 ? "s" : ""} of ${b.base}; use 1 to ${count}.`,
          );
        }
        if (b.sections.some((o) => o !== s && o.kind === "region" && o.file === s.file && o.index === s.index)) {
          error(s.line, `Region ${s.file} ${s.index} is replaced twice.`);
        }
        break;
      }
      case "hook":
        if (!HOOKS[s.hook]) error(s.line, `Unknown hook "${s.hook}". Hooks: ${Object.keys(HOOKS).join(", ")}.`);
        break;
      case "insert": {
        if (files.has(s.file)) {
          const src = TEMPLATES[s.file.slice(0, -3) as keyof typeof TEMPLATES];
          const hits = src.split("\n").filter((l) => l.trim() === s.anchor.trim()).length;
          if (hits === 0) error(s.line, `"${s.anchor}" is not a line of ${s.file}.`);
          else if (s.nth !== undefined && (s.nth < 1 || s.nth > hits)) {
            error(s.line, `"${s.anchor}" appears ${hits} time${hits > 1 ? "s" : ""} in ${s.file}; #${s.nth} does not exist.`);
          } else if (hits > 1 && s.nth === undefined) error(s.line, `"${s.anchor}" appears ${hits} times in ${s.file}; add #1 to #${hits} after the quotes to pick one, or pick a line that appears once.`);
        } else if (!GENERATED_RS.includes(s.file) && s.file !== "Cargo.toml") {
          error(s.line, `Unknown file "${s.file}".`);
        }
        if (s.anchor.trim() === "") error(s.line, "The line to insert after is empty.");
        break;
      }
      case "file": {
        if (!/^(src\/)?[\w./-]+$/.test(s.path) || s.path.includes("..") || s.path.startsWith("/")) {
          error(s.line, "A new file path is relative, like `src/see.rs`.");
        } else if (files.has(s.path.replace(/^src\//, "")) || GENERATED_RS.includes(s.path.replace(/^src\//, ""))) {
          error(s.line, `${s.path} already exists; use @insert to add to it.`);
        }
        break;
      }
    }
  }
}

/** Unbalanced (), [] or {} in a piece of code, ignoring comments, strings and chars. */
export function bracketProblem(code: string): string | null {
  const clean = code
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)'/g, "''");
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const c of clean) {
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c in pairs) {
      if (stack.pop() !== pairs[c]) return `This section has a "${c}" without a matching "${pairs[c]}".`;
    }
  }
  if (stack.length) return `This section has ${stack.length} unclosed "${stack.at(-1)}"; every bracket must close within its section.`;
  return null;
}

/** The bracket problem of a built-in block's original region, if any. */
function originalProblem(base: string, file: string, index: number): string | null {
  const name = file.replace(/\.rs$/, "") as keyof typeof TEMPLATES;
  const src = TEMPLATES[name];
  if (!src) return null;
  const r = findRegions(src, regionOf(base))[index - 1];
  if (!r) return null;
  return bracketProblem(src.split("\n").slice(r.start + 1, r.else ?? r.end).join("\n"));
}

/** Names the generator uses itself. */
function reservedId(id: string): boolean {
  return (
    isPseudo(id) ||
    id.startsWith("eval_") ||
    ["tests", "engine", "basic_time", "time_management", "transposition_table"].includes(id)
  );
}

// --- Writing ---------------------------------------------------------------------------------

/**
 * Body text as written in a block file: a code line that looks like a section
 * line (say a `// @hook` the block adds) gets one space in front, so it stays
 * code. Bodies are dedented when read, so the space does not change the code.
 */
export function escapeBody(body: string): string {
  return body
    .split("\n")
    .map((l) => (/^\/\/ @(region|hook|insert|file)\b/.test(l) ? ` ${l}` : l))
    .join("\n");
}

/** Turns a block back into its file text. */
export function serializeBlock(b: BlockFile, intro?: string): string {
  const head = [
    "//! ---",
    `//! id: ${b.id}`,
    `//! label: ${b.label}`,
    `//! slot: ${b.slot}`,
    ...(b.base ? [`//! base: ${b.base}`] : []),
    ...(b.requires.length ? [`//! requires: ${b.requires.join(", ")}`] : []),
    ...(b.description ? [`//! description: ${b.description}`] : []),
    ...(b.info ? [`//! info: ${b.info}`] : []),
    ...(b.cpw ? [`//! cpw: ${b.cpw}`] : []),
    ...(b.params.length ? ["//! params:", ...b.params.map((p) => `//!   ${formatParam(p)}`)] : []),
    "//! ---",
  ];
  const body = b.sections.map((s) => {
    const line =
      s.kind === "region"
        ? `// @region ${s.file} ${s.index}`
        : s.kind === "hook"
          ? `// @hook ${s.hook}`
          : s.kind === "insert"
            ? `// @insert ${s.file} after "${s.anchor}"${s.nth ? ` #${s.nth}` : ""}`
            : `// @file ${s.path}`;
    return s.body ? `${line}\n${escapeBody(s.body)}` : line;
  });
  return [...head, "", ...(intro ? [intro, ""] : []), body.join("\n\n"), ""].join("\n");
}

/** A free id based on `wanted`. */
export function freeId(wanted: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const clean = wanted.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "my_block";
  const base = /^[a-z]/.test(clean) ? clean : `my_${clean}`;
  let id = base;
  for (let n = 2; used.has(id) || searchSpec(id) || evalSpec(id) || reservedId(id); n++) id = `${base}_${n}`;
  return id;
}

/**
 * A fork of a built-in block: the same parameters and every region of its
 * code, ready to edit. Unedited, it generates exactly the same engine.
 */
export function forkBlock(base: string, id: string, label?: string): string {
  const s = searchSpec(base);
  const e = evalSpec(base);
  const spec = s ?? e;
  if (!spec) throw new Error(`Unknown block ${base}`);
  const region = regionOf(base);
  const sections: Section[] = [];
  // The block's main code first: search.rs or eval.rs, then the supporting files.
  const order = (n: string) => (n === "search" || n === "eval" ? 0 : 1);
  const names = (Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).sort((a, b) => order(a) - order(b));
  for (const name of names) {
    const src = TEMPLATES[name];
    const lines = src.split("\n");
    findRegions(src, region).forEach((r, k) => {
      const body = dedent(lines.slice(r.start + 1, r.else ?? r.end)).join("\n");
      sections.push({ kind: "region", file: `${name}.rs`, index: k + 1, body, line: 0 });
    });
  }
  const block: BlockFile = {
    id,
    label: label ?? `My ${spec.label.charAt(0).toLowerCase()}${spec.label.slice(1)}`,
    slot: s ? s.slot : "eval",
    base,
    requires: [...(s?.requires ?? [])],
    description: spec.description,
    info: spec.info,
    cpw: spec.cpw,
    params: spec.params.map((p) => ({ ...p, key: p.rust, doc: undefined })),
    sections,
  };
  const intro = [
    `// Your own version of ${spec.label}. Each @region section replaces one piece of the`,
    "// original code; change conditions, add parameters in the header and use them by name.",
    "// Lines like `// @block x` inside a region belong to other blocks; leave them in place.",
  ].join("\n");
  return serializeBlock(block, intro);
}

/** Starter code for a new block in each slot. */
export function newBlockSource(id: string, label: string, slot: CustomSlot): string {
  const STARTERS: Record<CustomSlot, { requires?: string; params: string[]; sections: string }> = {
    pruning: {
      requires: "alpha_beta",
      params: ['MY_MAX_DEPTH: i32 = 4 (1..32) "Up to depth"', 'MY_MARGIN: i32 = 200 (1..2000) "Margin (cp)"'],
      sections: [
        "// @hook pruning",
        "// Explain your idea here: this comment is shown in the tour.",
        "if !pv_node && !in_check && depth <= MY_MAX_DEPTH && static_eval - MY_MARGIN >= beta {",
        "    return static_eval;",
        "}",
      ].join("\n"),
    },
    ordering: {
      params: ['MY_BONUS: i32 = 500 (0..100000) "Bonus"'],
      sections: [
        "// @hook ordering",
        "// Explain your idea here. Moves with a higher `order` are tried first.",
        "if order == 0 && mv.promotion.is_some() {",
        "    order = MY_BONUS;",
        "}",
      ].join("\n"),
    },
    extensions: {
      params: ['MY_EXTENSION: i32 = 1 (0..2) "Plies"'],
      sections: [
        "// @hook extensions",
        "// Check extension: a move that gives check is searched one ply deeper.",
        "if !pos.board().checkers().is_empty() {",
        "    extension += MY_EXTENSION;",
        "}",
      ].join("\n"),
    },
    eval: {
      params: ['MY_BONUS: S = S(10, 5) "Bonus"'],
      sections: [
        "// @hook eval",
        "// Explain your term here. Scores are from White's point of view.",
        "let white_queens = (board.pieces(Piece::Queen) & board.colors(Color::White)).len() as i32;",
        "let black_queens = (board.pieces(Piece::Queen) & board.colors(Color::Black)).len() as i32;",
        "score += MY_BONUS * (white_queens - black_queens);",
      ].join("\n"),
    },
    root: {
      params: [],
      sections: "// @hook root\n// Runs once at the start of every search: reset your own counters here.",
    },
    move_loop: {
      requires: "alpha_beta",
      params: ['MY_LMP_DEPTH: i32 = 3 (1..8) "Up to depth"', 'MY_LMP_MOVES: usize = 16 (1..64) "After move #"'],
      sections: [
        "// @hook move_loop",
        "// Late move pruning: near the leaves, stop trying quiet moves after many of them.",
        "if !pv_node",
        "    && depth <= MY_LMP_DEPTH",
        "    && quiet",
        "    && i >= MY_LMP_MOVES",
        "    && best_score > -MATE_BOUND",
        "{",
        "    break;",
        "}",
      ].join("\n"),
    },
    reductions: {
      params: ['MY_LATE_MOVE: usize = 12 (1..64) "From move #"'],
      sections: [
        "// @hook reductions",
        "// Very late quiet moves are searched one ply shallower.",
        "if depth >= 3 && i >= MY_LATE_MOVE && quiet && !in_check {",
        "    extension -= 1;",
        "}",
      ].join("\n"),
    },
    leaf: {
      params: [],
      sections: [
        "// @hook leaf",
        "// Runs at depth 0, before the position is scored. Return a score here to use your own.",
        "if pos.is_draw() {",
        "    return 0;",
        "}",
      ].join("\n"),
    },
  };
  const st = STARTERS[slot];
  return [
    "//! ---",
    `//! id: ${id}`,
    `//! label: ${label}`,
    `//! slot: ${slot}`,
    ...(st.requires ? [`//! requires: ${st.requires}`] : []),
    "//! description: One line about what this block does.",
    "//! info: A short explanation of the idea, shown when the block is added.",
    ...(st.params.length ? ["//! params:", ...st.params.map((p) => `//!   ${p}`)] : []),
    "//! ---",
    "",
    "// Sections: `// @hook <name>` adds code at a hook in the skeleton,",
    '// `// @insert <file> after "<exact line>"` adds code anywhere, `// @file src/<name>.rs` adds a file.',
    "",
    st.sections,
    "",
  ].join("\n");
}

/** Which built-in blocks could be forked, by region name (for the web editor). */
export const FORKABLE: string[] = [...Object.keys(SEARCH_BLOCKS), ...Object.keys(EVAL_TERMS)];
