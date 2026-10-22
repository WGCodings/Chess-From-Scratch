// Generates projects for many block combinations and checks that each one
// is rustfmt-clean, compiles without warnings, passes clippy and runs bench.
// The reference workspace must reproduce the reference engine's bench.
//
//   npm run check:generated -w @cfs/codegen
//
// Needs cargo on PATH. Uses one shared target directory so cozy-chess is
// only compiled once.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  emptyWorkspace,
  generateProject,
  referenceWorkspace,
  starterWorkspace,
  toCrateName,
  type EvalTermType,
  type SearchBlockType,
  type Workspace,
} from "../src/index";

/** Must match `cfs-reference bench` (default depth). */
const REFERENCE_BENCH = 945_193;

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

const cases: { ws: Workspace; bench?: number }[] = [
  { ws: referenceWorkspace(), bench: REFERENCE_BENCH },
  { ws: starterWorkspace() },
  { ws: emptyWorkspace("bare skeleton") },
  { ws: without("transposition_table") },
  ...(Object.keys(SEARCH_BLOCKS) as SearchBlockType[]).map((t) => ({ ws: without(t) })),
  ...(Object.keys(EVAL_TERMS) as EvalTermType[]).map((t) => ({ ws: without(t) })),
];

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
    const out = run(join(targetDir, "release", name), ["bench", "5"], dir);
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
