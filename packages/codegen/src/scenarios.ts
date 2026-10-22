/**
 * User workflows as data, shared by the unit tests (scenarios.test.ts) and
 * the compile check (scripts/check-generated.ts): new blocks, edits to your
 * own and built-in blocks, hooks, inserts, several files, mistakes.
 *
 * Each scenario starts from a workspace, edits generated files the way a
 * user would in the code view (or adds block files), and says what should
 * come out.
 */

import { EVAL_TERMS, SEARCH_BLOCKS, defaultParams, evalSpec, searchSpec } from "./blocks";
import { EXAMPLE_BLOCKS, HOOKS, forkBlock, newBlockSource, type CustomSlot } from "./blockfile";
import { codeToBlocks, viewOf, type CodeResult } from "./fromcode";
import { generateProject } from "./generate";
import { referenceWorkspace, starterWorkspace, type Workspace } from "./workspace";

export interface Scenario {
  name: string;
  /** The workspace the user starts from. */
  start: () => Workspace;
  /** Edits per file, made on the code view's lines (hook lines included). */
  edits?: Record<string, (lines: string[]) => void>;
  /** Block files to add and place directly (id, slot, source). */
  blocks?: [string, CustomSlot, string][];
  /** Ids taken in My blocks. */
  taken?: string[];
  /** Expected errors (regexes, in order); none = must succeed. */
  errors?: RegExp[];
  /** Checks on the result. */
  expect?: (r: CodeResult, ws: Workspace) => void;
}

/** Alpha-beta and quiescence on top of the bare starter: where most blocks are added. */
export function bareAb(): Workspace {
  const ws = starterWorkspace();
  ws.engine.benchDepth = 4;
  ws.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
  ws.search.slots.leaf.push({ type: "quiescence", params: {} });
  return ws;
}

export function withBlock(ws: Workspace, id: string, slot: CustomSlot, src: string): Workspace {
  ws.customBlocks = { ...ws.customBlocks, [id]: src };
  if (slot === "eval") ws.eval.terms.push({ type: id, params: {} });
  else ws.search.slots[slot].push({ type: id, params: {} });
  return ws;
}

/** Index of the n-th line whose trimmed text is `text`. */
export function lineOf(lines: string[], text: string, nth = 1): number {
  let seen = 0;
  const i = lines.findIndex((l) => l.trim() === text && ++seen === nth);
  if (i < 0) throw new Error(`line not found: ${text}`);
  return i;
}

const after = (text: string, add: string[], nth = 1) => (lines: string[]) => {
  lines.splice(lineOf(lines, text, nth) + 1, 0, ...add);
};
const replace = (text: string, by: string, nth = 1) => (lines: string[]) => {
  const k = lineOf(lines, text, nth);
  lines[k] = lines[k]!.replace(text, by);
};
/** Replaces text inside the first line that contains `text` (the n-th such line). */
const change = (text: string, by: string, nth = 1) => (lines: string[]) => {
  let seen = 0;
  const k = lines.findIndex((l) => l.includes(text) && ++seen === nth);
  if (k < 0) throw new Error(`text not found: ${text}`);
  lines[k] = lines[k]!.replace(text, by);
};
const block = (id: string, indent: string, code: string[]) => [
  `${indent}// @block ${id}`,
  ...code.map((c) => indent + c),
  `${indent}// @end ${id}`,
];

/** Code that compiles at each slot hook, as a user would write it. */
export const HOOK_SNIPPETS: Record<string, { indent: string; code: string[] }> = {
  root: { indent: "        ", code: ["// Reset nothing yet.", "let _ = self.nodes;"] },
  pruning: { indent: "        ", code: ["// Silly but valid: never prunes.", "if depth > 1000 {", "    return static_eval;", "}"] },
  ordering: { indent: "            ", code: ["// Promotions first.", "if order == 0 && mv.promotion == Some(Piece::Queen) {", "    order = MY_PROMO_BONUS;", "}"] },
  extensions: { indent: "            ", code: ["// Check extension.", "if !pos.board().checkers().is_empty() {", "    extension += 1;", "}"] },
  move_loop: { indent: "            ", code: ["// Stop early when a mate was found deep down.", "if score >= MATE_BOUND && depth > 100 {", "    break;", "}"] },
  reductions: { indent: "            ", code: ["// Very late quiet moves one ply less.", "if depth >= 3 && i >= 24 && quiet && !in_check {", "    extension -= 1;", "}"] },
  leaf: { indent: "            ", code: ["// Stop at the horizon when far too deep.", "if ply >= 120 {", "    return 0;", "}"] },
  eval: { indent: "    ", code: ["// A tiny bonus for everyone.", "score += S(MY_TINY, 0);"] },
};

export function scenarios(): Scenario[] {
  const list: Scenario[] = [];

  // --- New blocks in the code view, one per slot hook --------------------------------------
  for (const [hook, s] of Object.entries(HOOK_SNIPPETS)) {
    const file = HOOKS[hook]!.file;
    list.push({
      name: `code: new block at hook ${hook}`,
      start: bareAb,
      edits: { [`src/${file}`]: after(`// @hook ${hook}`, block(`my_${hook}`, s.indent, s.code)) },
      expect: (r) => {
        if (r.created.length !== 1 || r.created[0]!.id !== `my_${hook}`) throw new Error(`created ${JSON.stringify(r.created)}`);
        if (r.created[0]!.slot !== HOOKS[hook]!.slot) throw new Error(`slot ${r.created[0]!.slot}`);
      },
    });
  }

  // --- New blocks from block files, one per slot (the starters) ----------------------------
  for (const slot of ["root", "pruning", "ordering", "extensions", "move_loop", "reductions", "leaf", "eval"] as CustomSlot[]) {
    list.push({ name: `file: starter block in ${slot}`, start: bareAb, blocks: [[`my_${slot}`, slot, newBlockSource(`my_${slot}`, `My ${slot}`, slot)]] });
  }

  // --- Inserts --------------------------------------------------------------------------------
  list.push({
    name: "code: insert after a unique skeleton line",
    start: bareAb,
    edits: { "src/search.rs": after("// Repetitions and the fifty-move rule are draws.", block("my_insert", "        ", ["let _ = ply;"])) },
    expect: (r) => {
      if (!r.sources.my_insert!.includes('// @insert search.rs after "// Repetitions and the fifty-move rule are draws."')) throw new Error(r.sources.my_insert);
    },
  });
  list.push({
    name: "code: insert after a repeated line picks its occurrence",
    start: bareAb,
    edits: { "src/search.rs": after("self.seldepth = self.seldepth.max(ply);", block("seldepth_note", "        ", ["let _ = self.seldepth;"]), 2) },
    expect: (r) => {
      if (!/after "self\.seldepth = self\.seldepth\.max\(ply\);" #\d/.test(r.sources.seldepth_note!)) throw new Error(r.sources.seldepth_note);
    },
  });
  list.push({
    name: "code: insert inside a built-in block requires that block",
    start: () => {
      const ws = bareAb();
      ws.search.slots.pruning.push({ type: "reverse_futility_pruning", params: defaultParams(SEARCH_BLOCKS.reverse_futility_pruning.params) });
      return ws;
    },
    edits: { "src/search.rs": after("// Static eval is far above beta even after a safety margin: assume the node fails high.", block("rfp_note", "        ", ["let _ = depth;"])) },
    expect: (r) => {
      if (!r.sources.rfp_note!.includes("//! requires: reverse_futility_pruning")) throw new Error(r.sources.rfp_note);
    },
  });
  list.push({
    name: "code: one block, code in search.rs and eval.rs",
    start: bareAb,
    edits: {
      "src/search.rs": after("// @hook pruning", block("both_files", "        ", ["if depth > 1000 && crate::eval::both_files_bonus() > 0 {", "    return 0;", "}"])),
      "src/eval.rs": after("// @hook eval_helpers", block("both_files", "", ["pub fn both_files_bonus() -> i32 {", "    1", "}"])),
    },
    expect: (r) => {
      if (r.created.length !== 1) throw new Error(JSON.stringify(r.created));
    },
  });
  list.push({
    name: "code: two new blocks in one save",
    start: bareAb,
    edits: {
      "src/search.rs": (lines) => {
        after("// @hook extensions", block("ext_a", "            ", HOOK_SNIPPETS.extensions!.code))(lines);
        after("// @hook pruning", block("prune_b", "        ", HOOK_SNIPPETS.pruning!.code))(lines);
      },
    },
    expect: (r) => {
      if (r.created.map((c) => c.id).sort().join() !== "ext_a,prune_b") throw new Error(JSON.stringify(r.created));
    },
  });
  list.push({
    name: "code: new block right after another custom block at the same hook",
    start: () => withBlock(bareAb(), "check_extension", "extensions", EXAMPLE_BLOCKS.check_extension!),
    edits: { "src/search.rs": after("// @end check_extension", block("second_ext", "            ", ["if i > 1000 {", "    extension += 1;", "}"])) },
    expect: (r) => {
      if (!r.sources.second_ext!.includes("// @hook extensions")) throw new Error(r.sources.second_ext);
    },
  });

  // --- Editing your own blocks ----------------------------------------------------------------
  list.push({
    name: "code: edit a line of your block, a new name becomes a parameter",
    start: () => withBlock(bareAb(), "check_extension", "extensions", EXAMPLE_BLOCKS.check_extension!),
    edits: { "src/search.rs": replace("extension += CHECK_EXTENSION;", "extension += CHECK_EXTENSION * CHECK_SCALE;") },
    expect: (r) => {
      const s = r.sources.check_extension!;
      if (!s.includes("CHECK_SCALE: i32 = 1") || !s.includes("//! info: A move that gives check")) throw new Error(s);
    },
  });
  list.push({
    name: "code: add lines to the top and bottom of your block",
    start: () => withBlock(bareAb(), "check_extension", "extensions", EXAMPLE_BLOCKS.check_extension!),
    edits: {
      "src/search.rs": (lines) => {
        after("// @block check_extension", ["            let gives_check = !pos.board().checkers().is_empty();"])(lines);
        const end = lineOf(lines, "// @end check_extension");
        lines.splice(end, 0, "            let _ = gives_check;");
      },
    },
    expect: (r) => {
      const s = r.sources.check_extension!;
      if (!/\/\/ @hook extensions\nlet gives_check[\s\S]*let _ = gives_check;\n?$/.test(s.trimEnd() + "\n")) throw new Error(s);
    },
  });
  list.push({
    name: "code: delete one section of a block with several",
    start: () => withBlock(bareAb(), "cutoff_table", "ordering", EXAMPLE_BLOCKS.cutoff_table!),
    edits: {
      "src/search.rs": (lines) => {
        // The new_game section (third region of the block in the file).
        const s = lineOf(lines, "// @block cutoff_table", 3);
        const e = lineOf(lines, "// @end cutoff_table", 3);
        lines.splice(s, e - s + 1);
      },
    },
    expect: (r) => {
      if (r.sources.cutoff_table!.includes("@hook new_game")) throw new Error(r.sources.cutoff_table);
    },
  });
  list.push({
    name: "code: edit a block's own file (tempo.rs)",
    start: () => withBlock(bareAb(), "tempo", "eval", EXAMPLE_BLOCKS.tempo!),
    edits: { "src/tempo.rs": change("        TEMPO", "        TEMPO + TEMPO") },
    expect: (r) => {
      if (!r.sources.tempo!.includes("TEMPO + TEMPO")) throw new Error(r.sources.tempo);
    },
  });
  list.push({
    name: "code: edit an example block's ordering section",
    start: () => withBlock(bareAb(), "cutoff_table", "ordering", EXAMPLE_BLOCKS.cutoff_table!),
    edits: { "src/search.rs": change(".min(CUTOFF_TABLE_MAX);", ".min(70_000);") },
    expect: (r) => {
      if (!r.sources.cutoff_table!.includes(".min(70_000);")) throw new Error(r.sources.cutoff_table);
    },
  });

  // --- Editing built-in blocks: your own version ------------------------------------------------
  list.push({
    name: "code: change a line of Null move pruning",
    start: referenceWorkspace,
    edits: { "src/search.rs": replace("let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;", "let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + depth / NMP_SCALED;") },
    expect: (r) => {
      if (r.forks[0]?.base !== "null_move_pruning" || !r.sources.my_null_move_pruning!.includes("NMP_SCALED: i32 = 1")) throw new Error(JSON.stringify(r));
    },
  });
  list.push({
    name: "code: add a line inside Reverse futility pruning",
    start: referenceWorkspace,
    edits: { "src/search.rs": after("// Static eval is far above beta even after a safety margin: assume the node fails high.", ["        let _rfp_seen = depth;"]) },
    expect: (r) => {
      if (r.forks[0]?.base !== "reverse_futility_pruning") throw new Error(JSON.stringify(r.forks));
    },
  });
  list.push({
    name: "code: change an eval term's line",
    start: referenceWorkspace,
    edits: { "src/eval.rs": replace("score += bishop_pair(board, BISHOP_PAIR);", "score += bishop_pair(board, BISHOP_PAIR) + bishop_pair(board, BISHOP_PAIR);") },
    expect: (r) => {
      if (r.forks[0]?.base !== "bishop_pair") throw new Error(JSON.stringify(r.forks));
    },
  });
  list.push({
    name: "file: unedited version of every built-in block",
    start: referenceWorkspace,
    blocks: [...Object.keys(SEARCH_BLOCKS), ...Object.keys(EVAL_TERMS)].map((t): [string, CustomSlot, string] => [
      `my_${t}`,
      searchSpec(t)?.slot ?? (evalSpec(t) ? "eval" : "root"),
      forkBlock(t, `my_${t}`),
    ]),
  });

  // --- Formatting only ------------------------------------------------------------------------
  list.push({
    name: "code: re-indenting the whole file changes nothing",
    start: referenceWorkspace,
    edits: { "src/search.rs": (lines) => lines.forEach((l, i) => (lines[i] = l.trim() ? `  ${l}` : l)) },
    expect: (r) => {
      if (Object.keys(r.sources).length) throw new Error(Object.keys(r.sources).join());
    },
  });

  // --- Mistakes the app must explain ----------------------------------------------------------
  const mistakes: [string, Record<string, (l: string[]) => void>, RegExp, string[]?][] = [
    ["code: changing skeleton code", { "src/search.rs": replace("let in_check = !board.checkers().is_empty();", "let in_check = false;") }, /Skeleton code/],
    ["code: loose code without markers", { "src/search.rs": after("// @hook pruning", ["        let x = 1;"]) }, /Wrap new code/],
    ["code: a block name with capitals", { "src/search.rs": after("// @hook pruning", block("MyBlock", "        ", ["let _ = 1;"])) }, /lowercase/],
    ["code: a built-in block's name", { "src/search.rs": after("// @hook pruning", block("killers", "        ", ["let _ = 1;"])) }, /built-in block/],
    ["code: a missing end marker", { "src/search.rs": after("// @hook pruning", ["        // @block oops", "        let _ = 1;"]) }, /matching/],
    ["code: a new hook line", { "src/search.rs": after("// @hook pruning", ["        // @hook my_hook"]) }, /Hooks are fixed/],
    ["code: a name taken in My blocks", { "src/search.rs": after("// @hook pruning", block("tempo", "        ", ["let _ = 1;"])) }, /already a block/, ["tempo"]],
    ["code: editing a built-in block's marker", { "src/search.rs": replace("// @end null_move_pruning", "// @end null_move") }, /Keep the `\/\/ @block`|Skeleton code/],
  ];
  for (const [name, edits, error, taken] of mistakes) {
    list.push({ name, start: name.includes("marker") ? referenceWorkspace : bareAb, edits, errors: [error], taken });
  }
  return list;
}

export interface Outcome {
  result: CodeResult;
  /** The workspace with the result applied (blocks placed, versions swapped in). */
  ws: Workspace;
}

/** Runs a scenario: edits through codeToBlocks, block files placed directly. */
export function runScenario(s: Scenario): Outcome {
  let ws = s.start();
  ws.engine.name = s.name.replace(/[^a-z0-9]+/gi, " ").trim().slice(0, 40);
  for (const [id, slot, src] of s.blocks ?? []) {
    const base = /^my_(.+)$/.exec(id)?.[1];
    // A version of a built-in block replaces it.
    const list = slot === "eval" ? ws.eval.terms : ws.search.slots[slot];
    const at = base ? list.findIndex((b) => b.type === base) : -1;
    if (at >= 0 && src.includes(`//! base: ${base}`)) {
      ws.customBlocks = { ...ws.customBlocks, [id]: src };
      list[at] = { type: id, params: list[at]!.params };
    } else ws = withBlock(ws, id, slot, src);
  }
  const empty: CodeResult = { sources: {}, created: [], forks: [], errors: [] };
  if (!s.edits) return { result: empty, ws };
  const files = generateProject(ws);
  const edits = Object.entries(s.edits).map(([path, fn]) => {
    const lines = viewOf(files.find((f) => f.path === path)!).lines;
    fn(lines);
    return { path, text: lines.join("\n") };
  });
  const result = codeToBlocks(ws, files, edits, s.taken ?? []);
  return { result, ws: result.errors.length ? ws : applyResult(ws, result) };
}

/** Applies a code-to-blocks result to a workspace, as the editor does on the canvas. */
export function applyResult(ws0: Workspace, r: CodeResult): Workspace {
  const ws = structuredClone(ws0);
  ws.customBlocks = { ...ws.customBlocks, ...r.sources };
  for (const f of r.forks) {
    for (const list of [...Object.values(ws.search.slots), ws.eval.terms]) {
      const at = list.findIndex((b) => b.type === f.base);
      if (at >= 0) list[at] = { type: f.id, params: {} };
    }
  }
  for (const c of r.created) {
    if (c.slot === "eval") ws.eval.terms.push({ type: c.id, params: {} });
    else ws.search.slots[c.slot].push({ type: c.id, params: {} });
  }
  return ws;
}
