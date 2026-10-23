/**
 * Custom blocks in the generator: the transforms that put a block file's
 * sections into the templates before they are rendered.
 *
 * - `@region f n` of a fork replaces the n-th region of its base block in
 *   file f, and the region is renamed to the fork, so the output and the
 *   tour credit the fork. The base stays switched on for the code it
 *   shares with other blocks.
 * - `@hook h` code is placed at `// @hook h` inside `// @block <id>` markers.
 * - `@insert f after "line"` code is placed after that line, with markers.
 * - `@file p` becomes a file of its own (a `mod` line is added for src/*.rs).
 */

import { expandBuiltins } from "./builtin";
import {
  SKELETON_VALUES,
  findRegions,
  indentLines,
  regionOf,
  type BlockFile,
  type Section,
} from "./blockfile";

const HOOK_LINE = /^(\s*)\/\/ @hook (\w+)\s*$/;

/** Code of every section, to find skeleton values the block mentions. */
function allCode(b: BlockFile): string {
  return b.sections.map((s) => s.body).join("\n");
}

/** The lines of a fork's code outside the nested `@block` regions. */
function ownLines(code: string): string {
  let depth = 0;
  const out: string[] = [];
  for (const line of code.split("\n")) {
    const t = line.trim();
    if (/^\/\/ @(block|until)\b/.test(t)) depth++;
    else if (/^\/\/ @end\b/.test(t)) depth = Math.max(0, depth - 1);
    else if (depth === 0) out.push(line);
  }
  return out.join("\n");
}

/** Pseudo regions switched on by the placed custom blocks. */
export function customRegions(blocks: BlockFile[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    out.add(b.id);
    if (b.base) out.add(regionOf(b.base));
    // A fork's body keeps other blocks' regions; only its own lines count.
    const code = (b.base ? ownLines(allCode(b)) : allCode(b)).replace(/\/\/.*$/gm, "");
    // Skeleton parts a slot's hook sits in: on when a block works at that hook.
    const hooks = new Set(b.sections.flatMap((s) => (s.kind === "hook" ? [s.hook] : [])));
    if (hooks.has("ordering")) out.add("slot_ordering");
    if (hooks.has("extensions") || hooks.has("reductions") || (!b.base && /\bextension\b/.test(code))) {
      out.add("slot_extensions");
      out.add("slot_reductions");
    }
    for (const [name, region] of Object.entries(SKELETON_VALUES)) {
      if (new RegExp(`\\b${name}\\b`).test(code)) out.add(region);
    }
  }
  return out;
}

/**
 * Where a line of a transformed template came from, so edits in the code
 * view can be traced back to a template line or a block's section.
 */
export type Origin =
  | { t: "tpl"; line: number }
  | { t: "open"; block: string; sections: number[] }
  | { t: "close"; block: string; sections: number[] }
  | { t: "body"; block: string; section: number; line: number; fork?: boolean };

export interface Traced {
  lines: string[];
  origins: Origin[];
  /** Inserts and replacements whose line was not found (or could not be cut). */
  missed?: { block: string; section: number; why: string }[];
}

/** A section's code wrapped in its block's markers, with origins. */
function wrapped(id: string, indent: string, parts: { section: number; body: string }[]): Traced {
  const sections = parts.map((p) => p.section);
  const lines = [`${indent}// @block ${id}`];
  const origins: Origin[] = [{ t: "open", block: id, sections }];
  parts.forEach((p, k) => {
    if (k > 0) {
      lines.push("");
      origins.push({ t: "body", block: id, section: p.section, line: -1 });
    }
    indentLines(p.body, indent).forEach((l, n) => {
      lines.push(l);
      origins.push({ t: "body", block: id, section: p.section, line: n });
    });
  });
  lines.push(`${indent}// @end ${id}`);
  origins.push({ t: "close", block: id, sections });
  return { lines, origins };
}

/** The n-th (1-based) line from the template itself whose text is `anchor` (ignoring indentation). */
function findAnchor(
  t: Traced,
  anchor: string,
  nth = 1,
  anchorable: (o: Origin, i: number) => boolean = (o) => o.t === "tpl" || (o.t === "body" && o.fork === true),
): number {
  let seen = 0;
  for (let i = 0; i < t.lines.length; i++) {
    if (anchorable(t.origins[i]!, i) && t.lines[i]!.trim() === anchor.trim() && ++seen === nth) return i;
  }
  return -1;
}

/** Indentation for code placed after `line`: one level deeper after an opening bracket. */
function indentAfter(line: string): string {
  const base = /^\s*/.exec(line)![0];
  return /[{(\[]$/.test(line.trimEnd()) ? `${base}    ` : base;
}

/**
 * Applies the placed custom blocks to one template (`file` like "search.rs"):
 * versions of built-in blocks, then hooks, then inserts and replacements in
 * the order of what blocks require, so a block can change the code of the
 * blocks it builds on.
 */
export function applyToTemplate(source: string, file: string, blocks: BlockFile[]): string {
  return traceTemplate(source, file, blocks).lines.join("\n");
}

/**
 * Which lines of a template are generated with the regions in `enabled` on:
 * a region's code when one of its names is on, its `@else` code otherwise.
 */
export function renderedLines(lines: string[], enabled: ReadonlySet<string>): boolean[] {
  const stack: { on: boolean; inElse: boolean }[] = [];
  const active = () => stack.every((f) => f.on !== f.inElse);
  return lines.map((line) => {
    const b = REGION_OPEN.exec(line);
    if (b) {
      const here = active();
      stack.push({ on: b[1]!.split("|").some((n) => enabled.has(n)), inElse: false });
      return here;
    }
    if (REGION_ELSE.test(line) && stack.length) {
      stack.at(-1)!.inElse = true;
      return active();
    }
    if (REGION_END.test(line) && stack.length) {
      stack.pop();
      return active();
    }
    return active();
  });
}
const REGION_OPEN = /^\s*\/\/ @block ([\w|]+)\s*$/;
const REGION_ELSE = /^\s*\/\/ @else\s*$/;
const REGION_END = /^\s*\/\/ @end\b/;

/**
 * `enabled` (the regions on in the engine) makes inserts and replacements
 * count only the lines that are generated: `#2` is the second such line.
 */
export function traceTemplate(source: string, file: string, blocks: BlockFile[], enabled?: ReadonlySet<string>): Traced {
  let t: Traced = { lines: source.split("\n"), origins: source.split("\n").map((_, line) => ({ t: "tpl", line })) };
  const splice = (at: number, remove: number, add: Traced) => {
    t.lines.splice(at, remove, ...add.lines);
    t.origins.splice(at, remove, ...add.origins);
  };

  // Versions of built-in blocks: replace regions of the base, bottom first.
  // Blocks around others go first, so a version of an inner block changes
  // the code inside a version of the outer one.
  const alias = new Map(blocks.flatMap((b) => (b.base ? [[b.id, regionOf(b.base)] as const] : [])));
  const size = (b: BlockFile) => findRegions(source, regionOf(b.base!)).reduce((n, r) => n + r.end - r.start, 0);
  const versions = blocks.filter((b) => b.base).sort((x, y) => size(y) - size(x));
  for (const b of versions) {
    const region = regionOf(b.base!);
    const spans = findRegions(t.lines.join("\n"), region);
    const edits = b.sections
      .map((s, k) => ({ s, k }))
      .filter((e): e is { s: Extract<Section, { kind: "region" }>; k: number } => e.s.kind === "region" && e.s.file === file)
      .map((e) => ({ ...e, span: spans[e.s.index - 1] }))
      .filter((e) => e.span)
      .sort((x, y) => y.span!.start - x.span!.start);
    for (const { s, k, span } of edits) {
      const sp = span!;
      const rename = (l: string) =>
        l.replace(/(\/\/ @(?:block|end) )([\w|]+)/, (_, head: string, names: string) =>
          head + names.split("|").map((n) => (n === region ? b.id : n)).join("|"),
        );
      const stop = sp.else ?? sp.end;
      // `// @builtin` lines stand for the original code of blocks around: put it back.
      const body = expandBuiltins(indentLines(s.body, sp.indent), t.lines.slice(sp.start + 1, stop), alias);
      const firstLine = sp.start + 1;
      const tail = t.lines.slice(stop, sp.end);
      const tailOrigins = t.origins.slice(stop, sp.end);
      splice(sp.start, sp.end - sp.start + 1, {
        lines: [rename(t.lines[sp.start]!), ...body.map((e) => e.line), ...tail, rename(t.lines[sp.end]!)],
        origins: [
          { t: "open", block: b.id, sections: [k] },
          ...body.map(
            (e): Origin =>
              "body" in e.from
                ? { t: "body", block: b.id, section: k, line: e.from.body, fork: true }
                : t.origins[firstLine + e.from.original]!,
          ),
          ...tailOrigins,
          { t: "close", block: b.id, sections: [k] },
        ],
      });
    }
  }

  // Hooks: code goes right after the hook line. Hook code may hold hooks itself.
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const fillHooks = (only: (i: number) => boolean) => {
    for (let i = 0; i < t.lines.length && t.lines.length < 200_000; i++) {
      const m = HOOK_LINE.exec(t.lines[i]!);
      if (!m || !only(i)) continue;
      const add: Traced = { lines: [], origins: [] };
      for (const b of blocks) {
        const parts = b.sections
          .map((s, section) => ({ s, section }))
          .filter((e) => e.s.kind === "hook" && e.s.hook === m[2])
          // A block never fills a hook inside its own code for that hook.
          .filter(() => !(t.origins[i]!.t === "body" && (t.origins[i] as { block: string }).block === b.id))
          .map((e) => ({ section: e.section, body: e.s.body }));
        if (parts.length) {
          const w = wrapped(b.id, m[1]!, parts);
          add.lines.push(...w.lines);
          add.origins.push(...w.origins);
        }
      }
      splice(i + 1, 0, add);
      // Hook lines inside the code just added are filled as the loop reaches them.
    }
  };
  fillHooks(() => true);

  // Inserts and replacements, in the order of what blocks require: a block
  // changes the code of the blocks it builds on, which is in place by then.
  const kindOf = (o: Origin) => {
    if (o.t === "tpl") return null;
    const b = byId.get(o.block);
    const k = o.t === "body" ? o.section : o.sections[0]!;
    return b?.sections[k]?.kind ?? null;
  };
  for (const b of inRequirementOrder(blocks)) {
    const builds = requirementClosure(b, byId);
    const anchorable = (o: Origin) =>
      o.t === "tpl" || (o.t === "body" && (o.fork === true || builds.has(o.block)));
    b.sections.forEach((s, k) => {
      if ((s.kind !== "insert" && s.kind !== "replace") || s.file !== file) return;
      const miss = (why: string) => (t.missed ??= []).push({ block: b.id, section: k, why });
      const shown = enabled ? renderedLines(t.lines, enabled) : null;
      const usable = (o: Origin, i: number) => anchorable(o) && (!shown || shown[i]!);
      const at = findAnchor(t, s.anchor, s.nth, usable);
      const where = `"${s.anchor.trim()}"${s.nth ? ` #${s.nth}` : ""}`;
      if (at < 0) {
        const hidden = findAnchor(t, s.anchor, 1, anchorable) >= 0;
        return miss(
          hidden
            ? `the line ${where} is not generated in this engine; add the block it belongs to, or make this block require it`
            : `the line ${where} is not in ${file}${b.requires.length ? ` (or not in the code of ${b.requires.join(", ")})` : ""}`,
        );
      }
      if (s.kind === "replace" && MARKER.test(t.lines[at]!)) return miss(`${where} is a marker line; it can't be replaced`);
      if (s.kind === "insert" && s.before) {
        splice(at, 0, wrapped(b.id, /^\s*/.exec(t.lines[at]!)![0], [{ section: k, body: s.body }]));
      } else if (s.kind === "insert") {
        // After a hook line: after the code at that hook.
        let after = at;
        if (HOOK_LINE.test(t.lines[at]!)) while (after + 1 < t.lines.length && kindOf(t.origins[after + 1]!) === "hook") after++;
        splice(after + 1, 0, wrapped(b.id, indentAfter(t.lines[at]!), [{ section: k, body: s.body }]));
      } else {
        let last = at;
        if (s.to !== undefined) {
          last = -1;
          for (let j = at; j < t.lines.length; j++) {
            if (t.lines[j]!.trim() === s.to.trim() && usable(t.origins[j]!, j)) {
              last = j;
              break;
            }
          }
          if (last < 0) return miss(`the line "${s.to.trim()}" is not below ${where}`);
        }
        // Never cut through other blocks' markers or hooks.
        if (t.lines.slice(at, last + 1).some((l) => MARKER.test(l))) {
          return miss(`the lines from ${where} to "${s.to?.trim()}" hold another block's markers or a hook; replace fewer lines`);
        }
        splice(at, last - at + 1, wrapped(b.id, /^\s*/.exec(t.lines[at]!)![0], [{ section: k, body: s.body }]));
      }
    });
  }
  // Hooks inside inserted code.
  fillHooks((i) => {
    const kind = kindOf(t.origins[i]!);
    return kind === "insert" || kind === "replace";
  });
  return t;
}

const MARKER = /^\s*\/\/ @(block|end|else|hook)\b/;

/** Blocks with the blocks they require (by id) first; otherwise in placement order. */
function inRequirementOrder(blocks: BlockFile[]): BlockFile[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: BlockFile[] = [];
  const seen = new Set<string>();
  const visit = (b: BlockFile) => {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    for (const r of b.requires) {
      const dep = byId.get(r);
      if (dep) visit(dep);
    }
    out.push(b);
  };
  blocks.forEach(visit);
  return out;
}

/** The ids of the blocks `b` builds on, directly or through others (and `b` itself). */
export function requirementClosure(b: BlockFile, byId: ReadonlyMap<string, BlockFile>): Set<string> {
  const out = new Set<string>([b.id]);
  const stack = [...b.requires];
  while (stack.length) {
    const r = stack.pop()!;
    if (out.has(r)) continue;
    out.add(r);
    stack.push(...(byId.get(r)?.requires ?? []));
  }
  // A version of a built-in block stands in for it.
  for (const other of byId.values()) if (other.base && out.has(other.base)) out.add(other.id);
  return out;
}

/** Inserts `body` after the first line equal to `anchor` (ignoring indentation). */
export function insertAfter(lines: string[], anchor: string, id: string, body: string, markers: boolean, nth = 1): string[] {
  let seen = 0;
  const at = lines.findIndex((l) => l.trim() === anchor.trim() && ++seen === nth);
  if (at < 0) return lines;
  const indent = indentAfter(lines[at]!);
  const add = markers ? wrapped(id, indent, [{ section: 0, body }]).lines : indentLines(body, indent);
  return [...lines.slice(0, at + 1), ...add, ...lines.slice(at + 1)];
}

/** Applies inserts to a file the generator writes itself (main.rs, params.rs, Cargo.toml). */
export function applyToGenerated(contents: string, file: string, blocks: BlockFile[]): string {
  let lines = contents.replace(/\n$/, "").split("\n");
  for (const b of blocks) {
    for (const s of b.sections) {
      if (s.kind === "insert" && s.file === file) {
        lines = insertAfter(lines, s.anchor, b.id, s.body, file.endsWith(".rs"), s.nth);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** New files the blocks add, with the module names to declare in main.rs. */
export function customFiles(blocks: BlockFile[]): { path: string; contents: string; owner: string; section: number }[] {
  const out: { path: string; contents: string; owner: string; section: number }[] = [];
  for (const b of blocks) {
    b.sections.forEach((s, section) => {
      if (s.kind !== "file") return;
      const path = s.path.includes("/") ? s.path : `src/${s.path}`;
      out.push({ path, contents: `${s.body.replace(/\n+$/, "")}\n`, owner: b.id, section });
    });
  }
  return out;
}

export function moduleOf(path: string): string | null {
  const m = /^src\/([a-z_][a-z0-9_]*)\.rs$/.exec(path);
  return m && m[1] !== "main" ? m[1]! : null;
}
