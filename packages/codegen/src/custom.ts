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

/** Pseudo regions switched on by the placed custom blocks. */
export function customRegions(blocks: BlockFile[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) {
    out.add(b.id);
    if (b.base) out.add(regionOf(b.base));
    const code = allCode(b).replace(/\/\/.*$/gm, "");
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
  | { t: "body"; block: string; section: number; line: number };

export interface Traced {
  lines: string[];
  origins: Origin[];
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
function findAnchor(t: Traced, anchor: string, nth = 1): number {
  let seen = 0;
  for (let i = 0; i < t.lines.length; i++) {
    if (t.origins[i]!.t === "tpl" && t.lines[i]!.trim() === anchor.trim() && ++seen === nth) return i;
  }
  return -1;
}

/** Indentation for code placed after `line`: one level deeper after an opening bracket. */
function indentAfter(line: string): string {
  const base = /^\s*/.exec(line)![0];
  return /[{(\[]$/.test(line.trimEnd()) ? `${base}    ` : base;
}

/**
 * Applies the placed custom blocks to one template (`file` like "search.rs"),
 * in placement order: versions of built-in blocks, then inserts, then hooks
 * (last, so a block can add a hook that other blocks fill).
 */
export function applyToTemplate(source: string, file: string, blocks: BlockFile[]): string {
  return traceTemplate(source, file, blocks).lines.join("\n");
}

export function traceTemplate(source: string, file: string, blocks: BlockFile[]): Traced {
  let t: Traced = { lines: source.split("\n"), origins: source.split("\n").map((_, line) => ({ t: "tpl", line })) };
  const splice = (at: number, remove: number, add: Traced) => {
    t.lines.splice(at, remove, ...add.lines);
    t.origins.splice(at, remove, ...add.origins);
  };

  // Versions of built-in blocks: replace regions of the base, bottom first.
  for (const b of blocks) {
    if (!b.base) continue;
    const region = regionOf(b.base);
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
      const body = indentLines(s.body, sp.indent);
      const tail = t.lines.slice(stop, sp.end);
      const tailOrigins = t.origins.slice(stop, sp.end);
      splice(sp.start, sp.end - sp.start + 1, {
        lines: [rename(t.lines[sp.start]!), ...body, ...tail, rename(t.lines[sp.end]!)],
        origins: [
          { t: "open", block: b.id, sections: [k] },
          ...body.map((_, n): Origin => ({ t: "body", block: b.id, section: k, line: n })),
          ...tailOrigins,
          { t: "close", block: b.id, sections: [k] },
        ],
      });
    }
  }

  // Inserts after a line of the template.
  for (const b of blocks) {
    b.sections.forEach((s, k) => {
      if (s.kind !== "insert" || s.file !== file) return;
      const at = findAnchor(t, s.anchor, s.nth);
      if (at < 0) return;
      splice(at + 1, 0, wrapped(b.id, indentAfter(t.lines[at]!), [{ section: k, body: s.body }]));
    });
  }

  // Hooks: code goes right after the hook line. New code may hold hooks itself.
  for (let i = 0; i < t.lines.length && t.lines.length < 200_000; i++) {
    const m = HOOK_LINE.exec(t.lines[i]!);
    if (!m) continue;
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
  }
  return t;
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
