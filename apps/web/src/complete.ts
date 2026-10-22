/**
 * Autocompletion for the code editors: cozy-chess (Board, BitBoard, Square,
 * Piece, ...), the engine's own types (Position, MoveList, S, the Searcher's
 * fields), the values the skeleton offers at hooks, and parameters.
 */

import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { SKELETON_VALUES, TEMPLATES } from "@cfs/codegen";
import { COZY_API, type ApiItem } from "./cozy-api.generated";

/** The engine's own types, read from the Rust templates. */
function engineApi(): Record<string, ApiItem[]> {
  const api: Record<string, ApiItem[]> = {};
  for (const src of Object.values(TEMPLATES)) {
    const lines = src.split("\n");
    let impl: string | null = null;
    let struct: string | null = null;
    let depth = 0;
    let implDepth = -1;
    let doc: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const full = lines[i]!.trim();
      // A trailing comment documents the line (struct fields).
      const trailing = /^(.*?\S)\s+\/\/\s?(.*)$/.exec(full);
      const line = trailing && !full.startsWith("//") ? trailing[1]! : full;
      if (trailing && !full.startsWith("//")) doc.push(trailing[2]!);
      if (line.startsWith("///") || line.startsWith("//")) {
        if (line.startsWith("///")) doc.push(line.slice(3).trim());
        else if (!line.startsWith("// @")) doc.push(line.slice(2).trim());
        continue;
      }
      const im = /^impl(?:<[^>]*>)?\s+([A-Z]\w*)\s*\{/.exec(line);
      if (im && implDepth < 0) {
        impl = im[1]!;
        implDepth = depth;
      }
      const sm = /^(?:pub )?struct ([A-Z]\w*)\s*\{/.exec(line);
      if (sm) struct = sm[1]!;
      else if (struct && /^(?:pub )?(\w+):\s*(.+?),$/.test(line)) {
        const [, name, type] = /^(?:pub )?(\w+):\s*(.+?),$/.exec(line)!;
        if (!api[struct]?.some((x) => x.name === name)) {
          (api[struct] ??= []).push({ name: name!, kind: "field", sig: type!, doc: doc.join(" ").slice(0, 160) });
        }
      }
      if (struct && line.startsWith("}")) struct = null;
      const fm = /^(?:pub )?(?:const )?fn (\w+)/.exec(line);
      if (fm && impl && implDepth >= 0) {
        let sig = line;
        let k = i;
        while (!/\{\s*$/.test(sig) && k + 1 < lines.length) sig += ` ${lines[++k]!.trim()}`;
        sig = sig.replace(/\s*\{\s*$/, "").replace(/^pub /, "");
        const ret = /->\s*(.+)$/.exec(sig)?.[1]?.trim();
        const self = /\(\s*(&\s*(mut\s+)?)?self\b/.test(sig);
        if (!api[impl]?.some((x) => x.name === fm[1])) {
          (api[impl] ??= []).push({ name: fm[1]!, kind: self ? "method" : "assoc", sig, doc: doc.join(" ").slice(0, 160), ...(ret ? { ret } : {}) });
        }
      }
      // Braces in strings and chars don't count.
      const code = lines[i]!.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^'\\]'/g, "''").replace(/\/\/.*$/, "");
      for (const c of code) {
        if (c === "{") depth++;
        else if (c === "}" && --depth === implDepth) {
          impl = null;
          implDepth = -1;
        }
      }
      doc = [];
    }
  }
  return api;
}

const ENGINE = engineApi();
const TYPES: Record<string, ApiItem[]> = { ...ENGINE, ...COZY_API };

/** What the skeleton's names are, where blocks run. */
const VARIABLES: Record<string, { type: string; doc: string }> = {
  pos: { type: "Position", doc: "The position being searched (board plus history)." },
  board: { type: "Board", doc: "The board at this node (before the move, inside the move loop)." },
  mv: { type: "Move", doc: "The move being scored or searched." },
  stm: { type: "Color", doc: "The side to move." },
  moves: { type: "MoveList", doc: "The moves of this node." },
  depth: { type: "i32", doc: "Remaining depth in plies." },
  ply: { type: "usize", doc: "Distance from the root in plies." },
  alpha: { type: "i32", doc: "Lower bound of the window." },
  beta: { type: "i32", doc: "Upper bound of the window." },
  in_check: { type: "bool", doc: "The side to move is in check." },
  static_eval: { type: "i32", doc: "Static evaluation of this node (pruning hooks)." },
  pv_node: { type: "bool", doc: "The window is open: an exact score matters here." },
  quiet: { type: "bool", doc: "The move is not a capture or promotion." },
  tt_move: { type: "Option<Move>", doc: "Best move from the transposition table." },
  order: { type: "i32", doc: "Ordering score of `mv` (ordering hook): higher is tried first." },
  extension: { type: "i32", doc: "Plies to add to (or subtract from) this move's depth." },
  score: { type: "i32 / S", doc: "The move's score (move loop), or the evaluation sum (eval hook)." },
  best_score: { type: "i32", doc: "Best score found at this node so far." },
  i: { type: "usize", doc: "Number of the move in the loop, from 0." },
};
// `self` is the Searcher.
const SELF = "Searcher";

const FUNCTIONS: ApiItem[] = [
  ...(COZY_API[""] ?? []),
  { name: "evaluate", kind: "function", sig: "fn evaluate(board: &Board) -> i32", doc: "Static evaluation from the side to move's point of view." },
  { name: "is_capture", kind: "function", sig: "fn is_capture(board: &Board, mv: Move) -> bool", doc: "The move captures a piece." },
  { name: "is_quiet", kind: "function", sig: "fn is_quiet(board: &Board, mv: Move) -> bool", doc: "Not a capture or promotion." },
  { name: "S", kind: "function", sig: "S(mg: i32, eg: i32)", doc: "A middlegame/endgame score pair." },
];

const KEYWORDS = "if else let mut for in while loop match return break continue fn pub const use as true false Some None".split(" ");

/** The type a dotted expression evaluates to, as far as we know it. */
function typeOf(expr: string): string | null {
  const parts = expr.split(".").map((p) => p.replace(/\(.*\)$/s, "").trim());
  let type: string | null = parts[0] === "self" ? SELF : (VARIABLES[parts[0]!]?.type ?? null);
  for (const p of parts.slice(1)) {
    if (!type) return null;
    const item = TYPES[type]?.find((i) => i.name === p);
    if (!item) return null;
    const t = item.kind === "field" ? item.sig : (item.ret ?? null);
    type = t ? clean(t, type) : null;
  }
  return type;
}

function clean(t: string, self: string): string {
  const s = t.replace(/^&\s*(mut\s+)?/, "").replace(/^'\w+\s+/, "").trim();
  if (s === "Self") return self;
  const box = /^Box<(.+)>$/.exec(s);
  return box ? box[1]! : s;
}

const option = (i: ApiItem, type: string): Completion => {
  const call = i.kind === "method" || i.kind === "assoc" || i.kind === "function";
  const noArgs = /\(\s*(&\s*(mut\s+)?self\s*)?\)/.test(i.sig);
  return {
    label: i.name,
    type: i.kind === "field" ? "property" : i.kind === "variant" || i.kind === "const" ? "constant" : call ? (i.kind === "method" ? "method" : "function") : "variable",
    detail: i.kind === "field" ? `: ${i.sig}` : i.kind === "variant" ? type : i.sig.replace(/^fn \w+/, ""),
    info: i.doc || undefined,
    apply: call && noArgs ? `${i.name}()` : undefined,
    boost: i.kind === "variant" ? 1 : 0,
  };
};

/** The completion source. `params` lists the parameter constants in scope. */
export function cfsCompletions(params: () => { name: string; type: string }[]): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    if (/^\s*\/\//.test(before) && !/^\s*\/\/ @/.test(before)) return null;

    const path = /([A-Za-z_][\w]*)::(\w*)$/.exec(before);
    if (path) {
      const items = TYPES[path[1]!]?.filter((i) => i.kind !== "method" && i.kind !== "field");
      if (!items?.length) return null;
      return { from: ctx.pos - path[2]!.length, options: items.map((i) => option(i, path[1]!)), validFor: /^\w*$/ };
    }

    const member = /((?:[A-Za-z_]\w*(?:\([^()]*\))?\.)*[A-Za-z_]\w*(?:\([^()]*\))?)\.(\w*)$/.exec(before);
    if (member) {
      const type = typeOf(member[1]!);
      const items = type ? TYPES[type]?.filter((i) => i.kind === "method" || i.kind === "field") : undefined;
      if (!items?.length) return null;
      return { from: ctx.pos - member[2]!.length, options: items.map((i) => option(i, type!)), validFor: /^\w*$/ };
    }

    const word = ctx.matchBefore(/[A-Za-z_]\w*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const options: Completion[] = [
      ...Object.entries(VARIABLES).map(([name, v]) => ({ label: name, type: "variable", detail: v.type, info: v.doc })),
      { label: "self", type: "variable", detail: "Searcher", info: "The searcher: its fields and helper tables." },
      ...params().map((p) => ({ label: p.name, type: "constant", detail: p.type, info: "Parameter (params.rs)", boost: 2 })),
      ...FUNCTIONS.map((f) => option(f, "")),
      ...Object.keys(TYPES).filter((t) => t && /^[A-Z]/.test(t)).map((t) => ({ label: t, type: "class" })),
      ...KEYWORDS.map((k) => ({ label: k, type: "keyword" })),
      ...Object.keys(SKELETON_VALUES).filter((n) => !VARIABLES[n]).map((n) => ({ label: n, type: "variable" })),
    ];
    return { from: word.from, options, validFor: /^\w*$/ };
  };
}
