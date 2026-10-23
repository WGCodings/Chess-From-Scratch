/**
 * Turns a workspace into a complete, standalone Cargo project.
 */

import {
  EVAL_TERMS,
  SEARCH_BLOCKS,
  BASIC_TIME,
  TIME_BLOCKS,
  TRANSPOSITION_TABLE,
  NEGAMAX_PARAMS,
  defaultParams,
  type SkeletonType,
  type ParamSpec,
  type ParamValue,
  type Score,
} from "./blocks";
import { TEMPLATES } from "./embedded.generated";
import { renderTemplateWithOwners } from "./template";
import { applyToGenerated, customFiles, moduleOf, traceTemplate, type Origin } from "./custom";
import { serializeBlock, type BlockFile } from "./blockfile";
import {
  KNOWN_REGIONS,
  asVersionParams,
  enabledRegions,
  normalizeWorkspace,
  placedCustomBlocks,
  validate,
  type Issue,
  type Params,
  type Workspace,
} from "./workspace";

export interface GeneratedFile {
  path: string;
  contents: string;
  /** Rust templates only: for each line, the blocks whose code it is (empty = skeleton). */
  owners?: string[][];
  /** The template the file was made from ("search", "random", ...). */
  template?: string;
  /** Rust templates and block files: where each line came from (for editing code in place). */
  origins?: Origin[];
  /** Hooks in this file: `at` = the line they stand before, `text` = the hook line itself. */
  hooks?: HookMark[];
}

export interface HookMark {
  at: number;
  name: string;
  text: string;
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
  if (/^[0-9]/.test(slug)) return `engine-${slug}`;
  // Names Cargo reserves for its own folders or the standard library.
  const reserved = ["build", "deps", "examples", "incremental", "target", "test", "std", "core", "alloc"];
  return reserved.includes(slug) ? `${slug}-engine` : slug;
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
  const custom = placedCustomBlocks(ws);
  const byId = new Map(custom.map((b) => [b.id, b]));
  /** A skeleton block's section: your version's parameters when there is one. */
  const skeletonSection = (type: SkeletonType, specs: ParamSpec[], params: Params) => {
    const version = ws.versions?.[type] ? byId.get(ws.versions[type]!) : undefined;
    if (!version) return paramSection(type, specs, params);
    return paramSection(version.id, version.params, asVersionParams(specs, version.params, params));
  };

  if (ws.search.kind === "negamax") push(skeletonSection("negamax", NEGAMAX_PARAMS, ws.search.params));
  const tm = ws.engine.timeManagement;
  if (tm) {
    push(skeletonSection(tm.type, TIME_BLOCKS[tm.type].params, tm.params));
  } else {
    sections.push(
      [
        "// No time management block placed: basic time management with time left / 40.",
        ...BASIC_TIME.params.map((s) => rustConst(s, s.default)),
      ].join("\n"),
    );
  }
  if (ws.engine.transpositionTable) {
    push(skeletonSection("transposition_table", TRANSPOSITION_TABLE.params, ws.engine.transpositionTable));
  }
  // Your versions of skeleton blocks that have no parameters of their own.
  const unparamed: [SkeletonType, boolean][] = [
    ["engine", true],
    ["random_mover", ws.search.kind === "random_mover"],
    ["hce", ws.eval.kind === "hce"],
    ["taper", ws.eval.kind === "hce" && ws.eval.taper],
  ];
  for (const [type, isPlaced] of unparamed) {
    const version = ws.versions?.[type] ? byId.get(ws.versions[type]!) : undefined;
    if (isPlaced && version) {
      push(paramSection(version.id, version.params, { ...defaultParams(version.params), ...ws.versionParams?.[type] }));
    }
  }
  // Custom blocks: a version of a built-in block takes that block's place.
  const instances = new Map([...Object.values(ws.search.slots).flat(), ...ws.eval.terms].map((b) => [b.type, b.params]));
  const customSection = (b: BlockFile) =>
    paramSection(b.id, b.params, { ...Object.fromEntries(b.params.map((p) => [p.key, p.default])), ...instances.get(b.id) });
  const forks = new Map(custom.filter((b) => b.base).map((b) => [b.base!, b]));
  // Catalogue order keeps the file stable however blocks are arranged.
  const placed = new Map(
    Object.values(ws.search.slots)
      .flat()
      .map((b) => [b.type, b.params]),
  );
  for (const [type, spec] of Object.entries(SEARCH_BLOCKS)) {
    const params = placed.get(type as keyof typeof SEARCH_BLOCKS);
    if (params) push(paramSection(type, spec.params, params));
    const fork = forks.get(type);
    if (fork) push(customSection(fork));
  }
  const terms = new Map(ws.eval.terms.map((t) => [t.type, t.params]));
  for (const [type, spec] of Object.entries(EVAL_TERMS)) {
    const params = terms.get(type as keyof typeof EVAL_TERMS);
    if (params) push(paramSection(`eval_${type}`, spec.params, params));
    const fork = forks.get(type);
    if (fork) push(customSection(fork));
  }
  // New blocks, in placement order.
  for (const b of custom) if (!b.base) push(customSection(b));

  return [
    "//! Every block parameter as a constant. Edit these to tune the engine.",
    "",
    "#![allow(dead_code, unused_imports)]",
    "",
    ...(ws.eval.kind === "hce" ? ["use crate::eval::S;", ""] : []),
    sections.join("\n\n"),
    "",
  ].join("\n");
}

/** The template files a project needs, and the path each becomes. */
function templateFiles(ws: Workspace, enabled: Set<string>): { template: keyof typeof TEMPLATES; path: string }[] {
  const files: { template: keyof typeof TEMPLATES; path: string }[] = [];
  const add = (template: keyof typeof TEMPLATES, path = `src/${template}.rs`) => files.push({ template, path });
  add("main");
  if (ws.search.kind === "negamax") add("search");
  if (ws.search.kind === "random_mover") add("random", "src/search.rs");
  if (enabled.has("file_eval")) add("eval");
  if (enabled.has("file_psqt")) add("psqt");
  for (const t of ["uci", "position", "time", "moves", "score", "bench"] as const) add(t);
  if (enabled.has("file_tt")) add("tt");
  return files;
}

/** Adds `mod` lines for files blocks add, in the sorted list rustfmt keeps. */
function addModules(main: string, modules: string[]): string {
  if (!modules.length) return main;
  const lines = main.split("\n");
  for (const m of modules) {
    const line = `mod ${m};`;
    if (lines.includes(line)) continue;
    const mods = lines.map((l, i) => (/^mod \w+;$/.test(l) ? i : -1)).filter((i) => i >= 0);
    const after = mods.filter((i) => lines[i]! < line).at(-1) ?? mods[0]! - 1;
    lines.splice(after + 1, 0, line);
  }
  return lines.join("\n");
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
- \`workspace.json\`: your blocks; open it in Chess From Scratch to keep editing.${
    Object.keys(ws.customBlocks ?? {}).length
      ? "\n- \`blocks/\`: your own blocks as block files, to import into other projects."
      : ""
  }
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
  normalizeWorkspace(ws);
  const errors = validate(ws).filter((i) => i.level === "error");
  if (errors.length > 0) throw new GenerateError(errors);

  const blocks = placedCustomBlocks(ws);
  const enabled = enabledRegions(ws, options.includeTests);
  const known = new Set([...KNOWN_REGIONS, ...blocks.map((b) => b.id)]);
  const extra = customFiles(blocks);
  const render = ({ template: name, path }: { template: keyof typeof TEMPLATES; path: string }): GeneratedFile => {
    const traced = traceTemplate(TEMPLATES[name], `${name}.rs`, blocks, enabled);
    const r = renderTemplateWithOwners(traced.lines.join("\n"), enabled, known, `${name}.rs`);
    const contents =
      name === "main" ? addModules(r.text, extra.map((f) => moduleOf(f.path)).filter((m): m is string => !!m)) : r.text;
    const added = contents.split("\n").length - r.text.split("\n").length;
    return {
      path,
      template: name,
      contents,
      // Added `mod` lines (main.rs) are not tracked; edits in main.rs still map to its template.
      owners: added ? undefined : r.owners,
      origins: added ? undefined : r.sources.map((k) => traced.origins[k]!),
      hooks: r.hooks.map((h) => {
        const text = traced.lines[h.source]!;
        return { at: h.at, name: /@hook (\w+)/.exec(text)![1]!, text };
      }),
    };
  };
  const generated = (contents: string, file: string) => (blocks.length ? applyToGenerated(contents, file, blocks) : contents);
  const ownedBy = (contents: string, owner: string) => contents.replace(/\n$/, "").split("\n").map(() => [owner]);
  const custom = Object.entries(ws.customBlocks ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return [
    { path: "Cargo.toml", contents: generated(generateCargoToml(ws), "Cargo.toml") },
    { path: "README.md", contents: generateReadme(ws) },
    { path: ".gitignore", contents: GITIGNORE },
    { path: ".cargo/config.toml", contents: CARGO_CONFIG },
    { path: "workspace.json", contents: `${JSON.stringify(ws, null, 2)}\n` },
    ...custom.map(([id, src]) => ({ path: `blocks/${id}.block.rs`, contents: src.endsWith("\n") ? src : `${src}\n` })),
    { path: "src/params.rs", contents: generated(generateParams(ws), "params.rs") },
    ...templateFiles(ws, enabled).map(render),
    ...extra.map((f) => ({
      path: f.path,
      contents: f.contents,
      owners: ownedBy(f.contents, f.owner),
      origins: f.contents
        .replace(/\n$/, "")
        .split("\n")
        .map((_, line): Origin => ({ t: "body", block: f.owner, section: f.section, line })),
    })),
  ];
}

/** A block file for a block, e.g. to export it on its own. */
export function blockFileText(block: BlockFile): string {
  return serializeBlock(block);
}
