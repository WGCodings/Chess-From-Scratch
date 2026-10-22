/**
 * Turns a workspace into a complete, standalone Cargo project.
 */

import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  TIME_MANAGEMENT,
  TRANSPOSITION_TABLE,
  type ParamSpec,
  type ParamValue,
  type Score,
} from "./blocks";
import { TEMPLATES } from "./embedded.generated";
import { renderTemplate } from "./template";
import {
  KNOWN_REGIONS,
  enabledRegions,
  validate,
  type Issue,
  type Params,
  type Workspace,
} from "./workspace";

export interface GeneratedFile {
  path: string;
  contents: string;
}

export class GenerateError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(issues.map((i) => i.message).join("\n"));
  }
}

/** Turns a display name into a valid Cargo package name. */
export function toCrateName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) return "my-engine";
  return /^[0-9]/.test(slug) ? `engine-${slug}` : slug;
}

/** A Rust string literal. */
function rustString(s: string): string {
  // Control characters are dropped; quotes and backslashes are escaped.
  const clean = [...s].filter((c) => c >= " " && c !== "\u007f").join("");
  return `"${clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function rustScore([mg, eg]: Score): string {
  return `S(${mg}, ${eg})`;
}

function rustFloat(n: number): string {
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

const MAX_WIDTH = 100;

function rustConst(spec: ParamSpec, value: ParamValue): string {
  const head = `pub const ${spec.rust}: ${spec.type} = `;
  const doc = spec.doc ? `/// ${spec.doc}\n` : "";
  let body: string;
  switch (spec.type) {
    case "f64":
      body = rustFloat(value as number);
      break;
    case "S":
      body = rustScore(value as Score);
      break;
    case "[S; 4]":
    case "[S; 8]": {
      const items = (value as Score[]).map(rustScore);
      const oneLine = `${head}[${items.join(", ")}];`;
      if (oneLine.length <= MAX_WIDTH) return doc + oneLine;
      return `${doc}${head}[\n${items.map((i) => `    ${i},`).join("\n")}\n];`;
    }
    default:
      body = String(value);
  }
  return `${doc}${head}${body};`;
}

function paramSection(region: string, specs: ParamSpec[], params: Params): string | null {
  if (specs.length === 0) return null;
  const consts = specs.map((s) => rustConst(s, params[s.key]!));
  return [`// @block ${region}`, ...consts, `// @end ${region}`].join("\n");
}

/** `params.rs`: every block parameter as a constant. */
export function generateParams(ws: Workspace): string {
  const sections: string[] = [
    [
      "// @block engine",
      `pub const ENGINE_NAME: &str = ${rustString(ws.engine.name)};`,
      `pub const ENGINE_AUTHOR: &str = ${rustString(ws.engine.author)};`,
      `pub const ENGINE_BENCH_DEPTH: i32 = ${ws.engine.benchDepth};`,
      "// @end engine",
    ].join("\n"),
  ];
  const push = (s: string | null) => s && sections.push(s);

  push(paramSection("time_management", TIME_MANAGEMENT.params, ws.engine.timeManagement));
  if (ws.engine.transpositionTable) {
    push(paramSection("transposition_table", TRANSPOSITION_TABLE.params, ws.engine.transpositionTable));
  }
  // Catalogue order keeps the file stable however blocks are arranged.
  const placed = new Map(
    Object.values(ws.search.slots)
      .flat()
      .map((b) => [b.type, b.params]),
  );
  for (const [type, spec] of Object.entries(SEARCH_BLOCKS)) {
    const params = placed.get(type as keyof typeof SEARCH_BLOCKS);
    if (params) push(paramSection(type, spec.params, params));
  }
  const terms = new Map(ws.eval.terms.map((t) => [t.type, t.params]));
  for (const [type, spec] of Object.entries(EVAL_TERMS)) {
    const params = terms.get(type as keyof typeof EVAL_TERMS);
    if (params) push(paramSection(`eval_${type}`, spec.params, params));
  }

  return [
    "//! Every block parameter as a constant. Edit these to tune the engine.",
    "",
    "#![allow(dead_code, unused_imports)]",
    "",
    "use crate::eval::S;",
    "",
    sections.join("\n\n"),
    "",
  ].join("\n");
}

/** Which template files a project needs; tt.rs only with a transposition table. */
function templateFiles(ws: Workspace): (keyof typeof TEMPLATES)[] {
  const files: (keyof typeof TEMPLATES)[] = ["search", "eval", "uci", "position", "time", "moves", "score", "bench"];
  if (ws.engine.transpositionTable) files.push("tt");
  return files;
}

export function generateMain(ws: Workspace): string {
  const modules = ["params", ...templateFiles(ws)].sort();
  return [
    `// ${ws.engine.name.replace(/[\r\n]+/g, " ")}: built with Chess From Scratch.`,
    "//",
    "// Your engine:",
    "//   search.rs    the negamax skeleton and the search blocks you placed",
    "//   eval.rs      the evaluation terms you placed",
    "//   params.rs    every block parameter, ready to tune",
    "//",
    "// The machinery around it (yours to change too):",
    "//   uci.rs       talks to chess GUIs (UCI protocol)",
    "//   position.rs  the board plus history for repetition detection",
    "//   time.rs      decides how long to think",
    "//   moves.rs     move lists and the principal variation",
    "//   score.rs     score constants and info output",
    "//   bench.rs     the `bench` command",
    ...(ws.engine.transpositionTable ? ["//   tt.rs        the transposition table"] : []),
    "",
    ...modules.map((m) => `mod ${m};`),
    "",
    "fn main() {",
    "    let args: Vec<String> = std::env::args().skip(1).collect();",
    '    if args.first().map(String::as_str) == Some("bench") {',
    "        let depth = args.get(1).and_then(|d| d.parse().ok());",
    "        bench::run::<search::Searcher>(depth);",
    "    } else {",
    "        uci::run::<search::Searcher>();",
    "    }",
    "}",
    "",
  ].join("\n");
}

/** The exported project's Cargo.toml. */
export function generateCargoToml(ws: Workspace): string {
  return [
    "[package]",
    `name = "${toCrateName(ws.engine.name)}"`,
    'version = "0.1.0"',
    'edition = "2021"',
    `authors = [${rustString(ws.engine.author)}]`,
    "",
    "# A standalone project, even when unpacked inside another Cargo workspace.",
    "[workspace]",
    "",
    "[dependencies]",
    'cozy-chess = "0.3.4"',
    "",
    "[profile.release]",
    "opt-level = 3",
    'lto = "fat"',
    "codegen-units = 1",
    'panic = "abort"',
    "",
  ].join("\n");
}

function generateReadme(ws: Workspace): string {
  const bin = toCrateName(ws.engine.name);
  return `# ${ws.engine.name}

A UCI chess engine built with Chess From Scratch. You own this code: change
it, ship it, enter it in tournaments.

## Build

Install Rust from https://rustup.rs, then in this folder run:

\`\`\`sh
cargo build --release
\`\`\`

The engine is \`target/release/${bin}\` (\`${bin}.exe\` on Windows). Load it
into any UCI chess GUI, such as Cute Chess, Arena or En Croissant.

The build is tuned for your own CPU (\`.cargo/config.toml\` sets
\`target-cpu=native\`). To make a binary that runs on other machines, delete
that file before building.

## Bench

\`\`\`sh
./target/release/${bin} bench
\`\`\`

prints \`<nodes> nodes <nps> nps\`. The node count is the engine's fingerprint:
it only changes when the search or evaluation changes.

## Testing changes

Play the new build against the old one with
[fastchess](https://github.com/Disservin/fastchess) and an SPRT, for example:

\`\`\`sh
fastchess -engine cmd=./new name=new -engine cmd=./old name=old \\
  -each tc=8+0.08 -rounds 10000 -repeat -concurrency 4 \\
  -openings file=book.epd format=epd order=random \\
  -sprt elo0=0 elo1=5 alpha=0.05 beta=0.05
\`\`\`

or submit it to an [OpenBench](https://github.com/AndyGrant/OpenBench)
instance, which uses the \`bench\` command above.

## Files

- \`src/search.rs\`, \`src/eval.rs\`, \`src/params.rs\`: your engine. Each block
  sits between \`// @block\` and \`// @end\` markers.
- The other files in \`src/\` (UCI, board, time management, ...) are the
  machinery around it. They only contain what your blocks need, and you are
  free to change them too.
- \`workspace.json\`: your blocks; open it in Chess From Scratch to keep editing.
`;
}

const GITIGNORE = "/target/\n";

const CARGO_CONFIG = `# Build for the CPU of the machine that compiles the engine (fastest).
# Delete this file to build a binary that runs on any x86-64 machine.
[build]
rustflags = ["-C", "target-cpu=native"]
`;

export interface GenerateOptions {
  /** Keep the unit tests (used for the reference crate in the CFS repo). */
  includeTests?: boolean;
}

/** Generates every file of the exported project. Throws on validation errors. */
export function generateProject(ws: Workspace, options: GenerateOptions = {}): GeneratedFile[] {
  const errors = validate(ws).filter((i) => i.level === "error");
  if (errors.length > 0) throw new GenerateError(errors);

  const enabled = enabledRegions(ws, options.includeTests);
  const render = (name: keyof typeof TEMPLATES) =>
    renderTemplate(TEMPLATES[name], enabled, KNOWN_REGIONS, `${name}.rs`);

  return [
    { path: "Cargo.toml", contents: generateCargoToml(ws) },
    { path: "README.md", contents: generateReadme(ws) },
    { path: ".gitignore", contents: GITIGNORE },
    { path: ".cargo/config.toml", contents: CARGO_CONFIG },
    { path: "workspace.json", contents: `${JSON.stringify(ws, null, 2)}\n` },
    { path: "src/main.rs", contents: generateMain(ws) },
    { path: "src/params.rs", contents: generateParams(ws) },
    ...templateFiles(ws).map((name) => ({ path: `src/${name}.rs`, contents: render(name) })),
  ];
}
