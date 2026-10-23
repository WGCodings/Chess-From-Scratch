// Generates projects for many block combinations and checks that each one
// is rustfmt-clean, compiles without warnings, passes clippy and runs bench.
// The reference workspace must reproduce the reference engine's bench.
//
//   npm run check:generated -w @cfs/codegen
//
// Needs cargo on PATH. Uses one shared target directory so cozy-chess is
// only compiled once.

import { MY_LMR, MY_PVS, layeredEngine } from "../src/layerexample";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EVAL_TERMS,
  EXAMPLE_BLOCKS,
  defaultParams,
  timeBlock,
  SEARCH_BLOCKS,
  codeToBlocks,
  viewOf,
  SKELETON_TYPES,
  forkBlock,
  newBlockSource,
  generateProject,
  referenceWorkspace,
  starterWorkspace,
  toCrateName,
  validate,
  type EvalTermType,
  type SearchBlockType,
  type Workspace,
} from "../src/index";
import { runScenario, scenarios } from "../src/scenarios";

/** Must match `cfs-reference bench` (default depth). */
const REFERENCE_BENCH = 150_455;

function without(type: SearchBlockType | EvalTermType | "transposition_table"): Workspace {
  const ws = referenceWorkspace();
  ws.engine.name = `no ${type}`;
  if (type === "transposition_table") {
    ws.engine.transpositionTable = null;
    ws.search.slots.ordering = ws.search.slots.ordering.filter((b) => b.type !== "tt_move_ordering");
  } else if (type in SEARCH_BLOCKS) {
    for (const slot of Object.keys(ws.search.slots) as (keyof typeof ws.search.slots)[]) {
      ws.search.slots[slot] = ws.search.slots[slot].filter((b) => b.type !== type);
    }
  } else {
    ws.eval.terms = ws.eval.terms.filter((t) => t.type !== type);
  }
  return ws;
}

/** The bare-bones starter plus the given search blocks, in the order a beginner adds them. */
function bareWith(name: string, types: SearchBlockType[]): Workspace {
  const ws = starterWorkspace();
  ws.engine.name = name;
  ws.engine.benchDepth = 4;
  for (const type of types) {
    ws.search.slots[SEARCH_BLOCKS[type].slot].push({ type, params: referenceWorkspace().search.slots[SEARCH_BLOCKS[type].slot].find((b) => b.type === type)!.params });
  }
  return ws;
}

const removals: (SearchBlockType | EvalTermType | "transposition_table")[] = [
  "transposition_table",
  ...(Object.keys(SEARCH_BLOCKS) as SearchBlockType[]),
  ...(Object.keys(EVAL_TERMS) as EvalTermType[]),
];

/** Replaces each listed built-in block with an unedited fork of it ("Edit this block"). */
function forked(name: string, types: string[], ws = referenceWorkspace()): Workspace {
  ws.engine.name = name;
  ws.customBlocks ??= {};
  for (const type of types) {
    const id = `my_${type}`;
    ws.customBlocks[id] = forkBlock(type, id);
    if ((SKELETON_TYPES as string[]).includes(type)) {
      ws.versions = { ...ws.versions, [type]: id };
      continue;
    }
    for (const list of [...Object.values(ws.search.slots), ws.eval.terms]) {
      const at = list.findIndex((b) => b.type === type);
      if (at >= 0) list[at] = { type: id, params: list[at]!.params };
    }
  }
  return ws;
}

/** Adds custom blocks (id → source) to a workspace in the given slots. */
function withBlocks(ws: Workspace, name: string, blocks: [string, string, string][]): Workspace {
  ws.engine.name = name;
  ws.customBlocks ??= {};
  for (const [id, slot, src] of blocks) {
    ws.customBlocks[id] = src;
    if (slot === "eval") ws.eval.terms.push({ type: id, params: {} });
    else ws.search.slots[slot as keyof typeof ws.search.slots].push({ type: id, params: {} });
  }
  return ws;
}

function deeper(ws: Workspace, depth: number): Workspace {
  ws.engine.benchDepth = depth;
  return ws;
}

const editedNmp = forkBlock("null_move_pruning", "my_nmp")
  .replace('"Depth divisor"', '"Depth divisor"\n//!   NMP_SCALED_REDUCTION: i32 = 4 (1..10) "Scaled reduction"')
  .replace("let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR;", "let r = NMP_BASE_REDUCTION + depth / NMP_DEPTH_DIVISOR + depth / NMP_SCALED_REDUCTION;");
if (!editedNmp.includes("NMP_SCALED_REDUCTION / ") && !editedNmp.includes("/ NMP_SCALED_REDUCTION")) {
  throw new Error("could not edit the NMP fork");
}

/** A block written in the code view: a check extension typed under the extensions hook. */
function fromCode(): Workspace {
  const ws = bareWith("from code", ["alpha_beta", "quiescence"]);
  ws.engine.benchDepth = 3;
  const files = generateProject(ws);
  const lines = viewOf(files.find((f) => f.path === "src/search.rs")!).lines;
  const k = lines.findIndex((l) => l.trim() === "// @hook extensions");
  lines.splice(k + 1, 0, "            // @block checkextension", "            if !pos.board().checkers().is_empty() {", "                extension += MY_EXTENSION;", "            }", "            // @end checkextension");
  const r = codeToBlocks(ws, files, [{ path: "src/search.rs", text: lines.join("\n") }]);
  if (r.errors.length) throw new Error(r.errors.map((e) => e.message).join("; "));
  return withBlocks(ws, "from code", r.created.map((c) => [c.id, c.slot, r.sources[c.id]!]));
}

/** A starter engine with some blocks, for the step-by-step path a beginner takes. */
function step(name: string, f: (ws: Workspace) => void): Workspace {
  const ws = starterWorkspace();
  ws.engine.name = name;
  f(ws);
  return ws;
}
const term = (type: string) => ({ type, params: defaultParams(EVAL_TERMS[type as keyof typeof EVAL_TERMS].params) });
const block = (type: string) => ({ type, params: defaultParams(SEARCH_BLOCKS[type as keyof typeof SEARCH_BLOCKS].params) });

const stepCases: { ws: Workspace; bench?: number }[] = [
  { ws: step("random mover", (ws) => ((ws.search.kind = "random_mover"), (ws.eval.kind = "none"))) },
  { ws: step("random mover with eval", (ws) => ((ws.search.kind = "random_mover"), ws.eval.terms.push(term("material")))) },
  { ws: step("step material", (ws) => ws.eval.terms.push(term("material"))) },
  { ws: step("step psqt", (ws) => ws.eval.terms.push(term("material"), term("psqt"))) },
  { ws: step("step taper", (ws) => ((ws.eval.taper = true), ws.eval.terms.push(term("material"), term("psqt")))) },
  {
    ws: step("step id draw", (ws) => {
      ws.eval.terms.push(term("material"));
      ws.search.slots.root.push(block("iterative_deepening"));
      ws.search.slots.pruning.push(block("draw_detection"));
    }),
  },
  {
    ws: step("step id ab tm", (ws) => {
      ws.eval.terms.push(term("material"));
      ws.search.slots.root.push(block("iterative_deepening"));
      ws.search.slots.move_loop.push(block("alpha_beta"));
      ws.engine.timeManagement = timeBlock("time_management");
    }),
  },
  { ws: step("step fixed depth ab", (ws) => (ws.eval.terms.push(term("material")), ws.search.slots.move_loop.push(block("alpha_beta")), (ws.engine.benchDepth = 5))) },
  {
    ws: forked("fork skeletons", ["engine", "negamax", "hce", "taper", "transposition_table", "time_management"]),
    bench: REFERENCE_BENCH,
  },
  { ws: forked("fork random mover", ["random_mover", "engine"], step("x", (ws) => ((ws.search.kind = "random_mover"), (ws.eval.kind = "none")))) },
  { ws: forked("fork psqt", ["psqt", "material", "hce"], step("x", (ws) => ws.eval.terms.push(term("material"), term("psqt")))) },
];

/** Blocks that build on each other: your alpha-beta, PVS replacing its line, LMR changing PVS. */
const layered = (name: string, ...blocks: [string, string][]) => {
  const ws = layeredEngine(...blocks);
  ws.engine.name = name;
  ws.eval.terms.push(term("material"));
  ws.search.slots.root.push(block("iterative_deepening"));
  return ws;
};
const customCases: { ws: Workspace; bench?: number }[] = [
  ...stepCases,
  { ws: layered("layer pvs", ["my_pvs", MY_PVS]) },
  { ws: layered("layer pvs lmr", ["my_pvs", MY_PVS], ["my_lmr", MY_LMR]) },
  { ws: fromCode() },
  { ws: forked("fork nmp", ["null_move_pruning"]), bench: REFERENCE_BENCH },
  {
    ws: forked("fork everything", [...Object.keys(SEARCH_BLOCKS), ...Object.keys(EVAL_TERMS)]),
    bench: REFERENCE_BENCH,
  },
  // Depth 8: at the default depth the extra reduction happens to leave the node count unchanged.
  { ws: deeper(withBlocks(without("null_move_pruning"), "edited nmp", [["my_nmp", "pruning", editedNmp]]), 8) },
  {
    ws: withBlocks(bareWith("new pruning block", ["alpha_beta"]), "new pruning block", [
      ["my_pruning", "pruning", newBlockSource("my_pruning", "My pruning", "pruning")],
    ]),
  },
  {
    ws: withBlocks(starterWorkspace(), "new ordering block", [
      ["my_ordering", "ordering", newBlockSource("my_ordering", "My ordering", "ordering")],
    ]),
  },
  {
    ws: withBlocks(starterWorkspace(), "new eval block", [["my_term", "eval", newBlockSource("my_term", "My term", "eval")]]),
  },
  {
    ws: deeper(withBlocks(bareWith("examples", ["alpha_beta", "quiescence"]), "examples", [
      ["check_extension", "extensions", EXAMPLE_BLOCKS.check_extension!],
      ["cutoff_table", "ordering", EXAMPLE_BLOCKS.cutoff_table!],
      ["tempo", "eval", EXAMPLE_BLOCKS.tempo!],
    ]), 3),
  },
  {
    ws: withBlocks(referenceWorkspace(), "reference plus examples", [
      ["check_extension", "extensions", EXAMPLE_BLOCKS.check_extension!],
      ["cutoff_table", "ordering", EXAMPLE_BLOCKS.cutoff_table!],
      ["tempo", "eval", EXAMPLE_BLOCKS.tempo!],
    ]),
  },
];

// Every user scenario that should succeed must also compile, pass clippy and run.
const scenarioCases: { ws: Workspace; bench?: number }[] = scenarios()
  .filter((sc) => !sc.errors)
  .map((sc) => {
    const { result, ws } = runScenario(sc);
    if (result.errors.length) throw new Error(`${sc.name}: ${result.errors.map((e) => e.message).join("; ")}`);
    ws.engine.name = `scenario ${sc.name}`.replace(/[^a-z0-9]+/gi, " ").slice(0, 60);
    ws.engine.benchDepth = Math.min(ws.engine.benchDepth, 4);
    return { ws };
  });

const allCases: { ws: Workspace; bench?: number }[] = [
  { ws: referenceWorkspace(), bench: REFERENCE_BENCH },
  { ws: starterWorkspace() },
  // The empty template has no search yet, so it is not a project to build.
  { ws: bareWith("bare plus mvv lva", ["mvv_lva"]) },
  { ws: bareWith("bare plus alpha beta", ["alpha_beta"]) },
  { ws: bareWith("bare plus ab qs", ["alpha_beta", "quiescence"]) },
  { ws: bareWith("bare plus ab pvs", ["alpha_beta", "principal_variation_search"]) },
  { ws: bareWith("bare plus ab lmr", ["alpha_beta", "late_move_reductions"]) },
  // Removing a block others depend on is not a valid workspace; those are skipped.
  ...removals.map((t) => ({ ws: without(t) })).filter(({ ws }) => !validate(ws).some((i) => i.level === "error")),
  ...customCases,
  ...scenarioCases,
];
for (const { ws } of customCases) {
  const errors = validate(ws).filter((i) => i.level === "error");
  if (errors.length) throw new Error(`${ws.engine.name}: ${errors.map((e) => e.message).join("; ")}`);
}

// `npm run check:generated -- <filter>` runs only the cases whose name matches the regex.
const filter = process.argv[2];
const cases = filter ? allCases.filter(({ ws }) => new RegExp(filter).test(ws.engine.name)) : allCases;

const root = mkdtempSync(join(tmpdir(), "cfs-gen-"));
const targetDir = join(root, "target");
const env = {
  ...process.env,
  CARGO_TARGET_DIR: targetDir,
  // Faster test builds; the node count does not depend on these.
  CARGO_PROFILE_RELEASE_LTO: "false",
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
  RUSTFLAGS: "-D warnings",
};
const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let failures = 0;
for (const { ws, bench } of cases) {
  const name = toCrateName(ws.engine.name);
  const dir = join(root, name);
  for (const file of generateProject(ws)) {
    const path = join(dir, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);
  }
  try {
    run("cargo", ["fmt", "--check"], dir);
    run("cargo", ["clippy", "--release", "--quiet", "--", "-D", "warnings"], dir);
    run("cargo", ["build", "--release", "--quiet"], dir);
    const out = run(join(targetDir, "release", name), ["bench"], dir);
    let note = out.trim();
    if (bench !== undefined) {
      const full = run(join(targetDir, "release", name), ["bench"], dir);
      const nodes = Number(/^(\d+) nodes/m.exec(full)?.[1]);
      if (nodes !== bench) throw new Error(`bench ${nodes}, expected ${bench}`);
      note = `${full.trim()} (matches reference)`;
    }
    console.log(`ok   ${name.padEnd(32)} ${note}`);
  } catch (err) {
    failures++;
    const e = err as { stdout?: string; stderr?: string; message: string };
    console.log(`FAIL ${name}\n${e.stdout ?? ""}${e.stderr ?? e.message}`);
  }
}

rmSync(root, { recursive: true, force: true });
console.log(`\n${cases.length - failures}/${cases.length} generated projects passed`);
process.exit(failures ? 1 : 0);
