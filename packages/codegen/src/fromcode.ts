/**
 * Code to blocks: turns edits made directly in the generated code back into
 * block files.
 *
 * - New code wrapped in `// @block <name>` … `// @end <name>` becomes (part
 *   of) a block. Right below a hook it is a `@hook` section; anywhere else an
 *   `@insert … after "<line above>"` section. A new name makes a new block.
 * - Changes inside a custom block's code patch that block's sections.
 * - Changes inside a built-in block's code make your own version of it.
 * - Changes to skeleton code are refused: wrap new code in markers instead.
 */

import { collapseBuiltins } from "./builtin";
import { evalSpec, searchSpec, skeletonSpec, type ParamSpec } from "./blocks";
import {
  HOOKS,
  TEMPLATES,
  blockFilePath,
  dedent,
  escapeBody,
  findRegions,
  forkBlock,
  freeId,
  isCustomSlot,
  regionOf,
  sectionHead,
  serializeBlock,
  type BlockFile,
  type CustomSlot,
  type Section,
} from "./blockfile";
import { renderedLines, requirementClosure, traceTemplate, type Origin } from "./custom";
import type { GeneratedFile } from "./generate";
import { KNOWN_REGIONS, enabledRegions, parseBlock, placedCustomBlocks, type Workspace } from "./workspace";

type Head = Section extends infer S ? (S extends Section ? Omit<S, "body"> : never) : never;

export type ViewOrigin = Origin | { t: "hook"; name: string };

export interface CodeView {
  lines: string[];
  origins: ViewOrigin[];
  owners: string[][];
}

/** A generated file as the code editor shows it: with its hook lines. */
export function viewOf(file: GeneratedFile): CodeView {
  const src = file.contents.replace(/\n$/, "").split("\n");
  const lines: string[] = [];
  const origins: ViewOrigin[] = [];
  const owners: string[][] = [];
  const hooks = [...(file.hooks ?? [])].sort((a, b) => a.at - b.at);
  let h = 0;
  for (let i = 0; i <= src.length; i++) {
    while (h < hooks.length && hooks[h]!.at === i) {
      lines.push(hooks[h]!.text);
      origins.push({ t: "hook", name: hooks[h]!.name });
      owners.push(file.owners?.[i] ?? file.owners?.[i - 1] ?? []);
      h++;
    }
    if (i === src.length) break;
    lines.push(src[i]!);
    origins.push(file.origins?.[i] ?? { t: "tpl", line: -1 });
    owners.push(file.owners?.[i] ?? []);
  }
  return { lines, origins, owners };
}

export interface CodeEdit {
  path: string;
  /** The whole edited file, hook lines included. */
  text: string;
}

export interface CodeError {
  path: string;
  /** 1-based line in the edited text. */
  line: number;
  message: string;
}

export interface CodeResult {
  /** Block id → its new block file text, for every block created or changed. */
  sources: Record<string, string>;
  /** New blocks, to place in their slot. */
  created: { id: string; slot: CustomSlot }[];
  /** Built-in blocks replaced by a new version of them. */
  forks: { base: string; id: string }[];
  /**
   * Existing blocks whose code the edits change: ids of your blocks and
   * built-in types (those get a version). With `onTop` these are left alone.
   */
  changed: string[];
  errors: CodeError[];
}

/** Which slot new code belongs to, by the hook it sits at (or the nearest hook above it). */
const HOOK_SLOT: Record<string, CustomSlot> = {
  ...Object.fromEntries(Object.entries(HOOKS).flatMap(([n, h]) => (h.slot ? [[n, h.slot]] : []))),
  node_start: "pruning",
  on_cutoff: "move_loop",
  eval_helpers: "eval",
};

interface BodyOp {
  /** Insert before this body line (original numbering). */
  at: number;
  remove: number[];
  add: string[];
}

const BLOCK_LINE = /^\s*\/\/ @block (\S+)\s*$/;
const END_LINE = /^\s*\/\/ @end (\S+)\s*$/;
const HOOK_LINE = /^\s*\/\/ @hook (\w+)\s*$/;
const MARKER_LINE = /^\s*\/\/ @(block|end|else|hook)\b/;

/** Indentation for code placed after `line`: one level deeper after an opening bracket. */
function indentAfterLine(line: string): string {
  const base = /^\s*/.exec(line)![0];
  return /[{(\[]$/.test(line.trimEnd()) ? `${base}    ` : base;
}

/** Line hunks turning `a` into `b`: [a0, a1) replaced by [b0, b1). */
export function lineHunks(a: string[], b: string[]): { a0: number; a1: number; b0: number; b1: number }[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x = a.slice(pre, a.length - suf);
  const y = b.slice(pre, b.length - suf);
  const n = x.length;
  const m = y.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] = x[i] === y[j] ? lcs[at(i + 1, j + 1)]! + 1 : Math.max(lcs[at(i + 1, j)]!, lcs[at(i, j + 1)]!);
    }
  }
  const out: { a0: number; a1: number; b0: number; b1: number }[] = [];
  let open: { a0: number; a1: number; b0: number; b1: number } | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      if (open) out.push(open);
      open = null;
      i++;
      j++;
    } else if (j < m && (i === n || lcs[at(i, j + 1)]! >= lcs[at(i + 1, j)]!)) {
      open ??= { a0: pre + i, a1: pre + i, b0: pre + j, b1: pre + j };
      open.b1 = pre + j + 1;
      j++;
    } else {
      open ??= { a0: pre + i, a1: pre + i, b0: pre + j, b1: pre + j };
      open.a1 = pre + i + 1;
      i++;
    }
  }
  if (open) out.push(open);
  return out;
}

/** UPPER_CASE names a piece of code uses that nothing defines yet: they become parameters. */
function unknownConstants(code: string, known: Set<string>): string[] {
  const clean = code.replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const names = new Set<string>();
  for (const m of clean.matchAll(/(?<![:\w])([A-Z][A-Z0-9_]*[A-Z0-9])\b/g)) {
    if (/[A-Z]/.test(m[1]!) && m[1]!.length > 1 && !known.has(m[1]!)) names.add(m[1]!);
  }
  return [...names];
}

const label = (id: string) => {
  const words = id.replace(/_+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Applies edits made in the code view. `taken` lists block ids that exist
 * outside this project (My blocks, examples): new blocks may not reuse them.
 */
export interface CodeOptions {
  /**
   * Turn changes inside existing blocks (your own or built-in) into one new
   * block that builds on them, instead of changing those blocks.
   */
  onTop?: { id: string; label: string };
}

export function codeToBlocks(
  ws: Workspace,
  files: GeneratedFile[],
  edits: CodeEdit[],
  taken: string[] = [],
  options: CodeOptions = {},
): CodeResult {
  const result: CodeResult = { sources: {}, created: [], forks: [], changed: [], errors: [] };
  const enabled = enabledRegions(ws);
  const placed = new Map(placedCustomBlocks(ws).map((b) => [b.id, b]));
  const ops = new Map<string, Map<number, BodyOp[]>>();
  const deleted = new Map<string, Set<number>>();
  const added = new Map<string, Section[]>();
  const fresh = new Map<string, { slot: CustomSlot; requires: Set<string>; label: string }>();
  const forkOps = new Map<string, Map<string, { at: number; remove: number[]; add: string[] }[]>>();
  const usedIds = new Set([...taken, ...placed.keys()]);
  // A new block on top of the blocks whose code was changed.
  const layer = options.onTop;
  const layerRequires = new Set<string>();
  let layerSlot: CustomSlot | null = null;
  if (layer) usedIds.add(layer.id);

  const known = new Set<string>();
  for (const f of files) for (const m of f.contents.matchAll(/\b(?:const|static)\s+([A-Z][A-Z0-9_]*)/g)) known.add(m[1]!);

  const bodyOp = (id: string, section: number, op: BodyOp) => {
    if (!ops.has(id)) ops.set(id, new Map());
    const m = ops.get(id)!;
    if (!m.has(section)) m.set(section, []);
    m.get(section)!.push(op);
  };
  const addSection = (id: string, s: Section) => {
    if (!added.has(id)) added.set(id, []);
    added.get(id)!.push(s);
  };

  for (const edit of edits) {
    const file = files.find((f) => f.path === edit.path);
    const fail = (line: number, message: string) => result.errors.push({ path: edit.path, line, message });
    if (!file) {
      fail(1, "This file is not part of the project any more.");
      continue;
    }
    if (!file.origins) {
      fail(1, `${edit.path} is written from your settings and block parameters; it can't be edited here.`);
      continue;
    }
    const tplName = file.template ?? /^src\/(\w+)\.rs$/.exec(edit.path)?.[1];
    const template = tplName && tplName in TEMPLATES ? TEMPLATES[tplName as keyof typeof TEMPLATES] : null;
    const view = viewOf(file);
    const O = view.lines;
    const E = edit.text.replace(/\n$/, "").split("\n");
    const vo = view.origins;
    const blank = (l: string | undefined) => (l ?? "").trim() === "";
    const innerOwner = (i: number) => view.owners[i]?.filter((o) => !o.startsWith("!")).at(-1);
    const builtinOwner = (i: number) => {
      const o = innerOwner(i);
      return o && !o.includes("|") && (searchSpec(o) || o.startsWith("eval_") || skeletonSpec(o)) && vo[i]!.t === "tpl" ? o : null;
    };
    // The indentation of a custom section's code in the view.
    const sectionIndent = (id: string, section: number) => {
      const k = vo.findIndex((o) => (o.t === "open" && o.block === id && o.sections.includes(section)));
      if (k >= 0) return /^\s*/.exec(O[k]!)![0];
      return "";
    };
    const strip = (lines: string[], indent: string) => lines.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()));

    // What new code is anchored to: the nearest template line or hook above, past other blocks' code.
    // The template as the generator sees it before inserts: anchors count lines there.
    const traced = template && tplName ? traceTemplate(template, `${tplName}.rs`, [...placed.values()], enabled) : null;
    // Anchors count the lines that are generated.
    const shown = traced ? renderedLines(traced.lines, enabled) : [];
    const sameOrigin = (a: Origin, b: ViewOrigin) =>
      (a.t === "tpl" && b.t === "tpl" && a.line === b.line) ||
      (a.t === "body" && b.t === "body" && a.block === b.block && a.section === b.section && a.line === b.line);
    /**
     * The anchor text of view line `k` and which of the equal lines it is, counting
     * generated lines of the template, of versions of built-in blocks and of the
     * blocks in `builds` (the blocks the new code builds on).
     */
    const anchorText = (k: number, builds: ReadonlySet<string>): { anchor: string; nth?: number } | null => {
      const o = vo[k]!;
      if ((o.t === "tpl" && o.line < 0) || !traced) return null;
      const idx = traced.origins.findIndex((x) => sameOrigin(x, o));
      if (idx < 0) return null;
      const text = traced.lines[idx]!.trim();
      const anchorable = (i: number) => {
        const x = traced.origins[i]!;
        return shown[i] === true && (x.t === "tpl" || (x.t === "body" && (x.fork === true || builds.has(x.block))));
      };
      const same = traced.lines.map((l, i) => ({ l: l.trim(), i })).filter((x) => x.l === text && anchorable(x.i));
      const nth = same.findIndex((x) => x.i === idx) + 1;
      return { anchor: text, ...(same.length > 1 ? { nth } : {}) };
    };
    /** The blocks a block builds on, with versions standing in for built-in blocks. */
    const closureOf = (ids: Iterable<string>): Set<string> =>
      requirementClosure({ id: "\0", requires: [...ids] } as BlockFile, placed);
    const anchorFor = (at: number): { section: Head | null; index: number; inside?: string } => {
      let first = true;
      for (let k = at - 1; k >= 0; k--) {
        const o = vo[k]!;
        if (blank(O[k])) continue;
        // Right inside the code of one of your blocks: the new code builds on that block.
        if (first && o.t === "body" && !o.fork && tplName) {
          let n = at;
          while (n < O.length && blank(O[n])) n++;
          const next = vo[n];
          if (next && (next.t === "body" || next.t === "close") && next.block === o.block) {
            const a = anchorText(k, closureOf([o.block]));
            if (a) return { section: { kind: "insert", file: `${tplName}.rs`, ...a, line: 0 }, index: k, inside: o.block };
          }
        }
        first = false;
        // Code of your version of a block counts as template code; other blocks' code doesn't.
        if (o.t === "open" || o.t === "close" || (o.t === "body" && !o.fork)) continue;
        if (o.t === "hook") return { section: { kind: "hook", hook: o.name, line: 0 }, index: k };
        if (!tplName) break;
        const a = anchorText(k, new Set());
        if (!a) break;
        return { section: { kind: "insert", file: `${tplName}.rs`, ...a, line: 0 }, index: k };
      }
      return { section: null, index: -1 };
    };
    const slotAt = (at: number, anchor: Head): CustomSlot => {
      if (tplName === "eval") return "eval";
      if (anchor.kind === "hook") return HOOK_SLOT[anchor.hook] ?? "root";
      for (let k = at - 1; k >= 0; k--) {
        const o = vo[k]!;
        if (o.t === "hook" && HOOK_SLOT[o.name]) return HOOK_SLOT[o.name]!;
      }
      return "root";
    };

    /** New code at view position `at`: block regions and hook lines. */
    const newCode = (lines: string[], at: number, line0: number) => {
      const { section: anchor, index, inside } = anchorFor(at);
      // Comment lines right above a new block go into it, as its explanation.
      let comments: string[] = [];
      let k = 0;
      while (k < lines.length) {
        const l = lines[k]!;
        const n = line0 + k + 1;
        if (blank(l)) {
          k++;
          continue;
        }
        if (/^\s*\/\//.test(l) && !BLOCK_LINE.test(l) && !END_LINE.test(l) && !HOOK_LINE.test(l)) {
          comments.push(l);
          k++;
          if (k === lines.length || lines.slice(k).every((x) => blank(x))) {
            fail(n, `The comment "${l.trim()}" is outside any block. Move it between the \`// @block\` and \`// @end\` lines of a block (right above a block also works).`);
            return;
          }
          continue;
        }
        const hook = HOOK_LINE.exec(l);
        const start = BLOCK_LINE.exec(l);
        if (!anchor && (hook || start)) {
          fail(n, "New code here has no line of the skeleton above it to attach to.");
          return;
        }
        if (hook) {
          fail(n, "Hooks are fixed places in the skeleton; new ones can't be added. Put your code at an existing hook or after a line.");
          return;
        }
        if (!start) {
          fail(n, `"${l.trim()}" is outside any block. Wrap new code in \`// @block <name>\` and \`// @end <name>\` lines; it then becomes (part of) a block.`);
          return;
        }
        const id = start[1]!;
        let depth = 0;
        let end = -1;
        for (let j = k; j < lines.length; j++) {
          const b = BLOCK_LINE.exec(lines[j]!);
          const e = END_LINE.exec(lines[j]!);
          if (b?.[1] === id) depth++;
          if (e?.[1] === id && --depth === 0) {
            end = j;
            break;
          }
        }
        if (end < 0) {
          fail(n, `\`// @block ${id}\` needs a matching \`// @end ${id}\` line.`);
          return;
        }
        const body = dedent([...comments, ...lines.slice(k + 1, end)]).join("\n");
        comments = [];
        if (!/^[a-z][a-z0-9_]*$/.test(id)) {
          fail(n, `"${id}": block names use lowercase letters, digits and underscores, starting with a letter.`);
        } else if (KNOWN_REGIONS.has(id) || searchSpec(id) || evalSpec(id) || id.startsWith("slot_") || id.startsWith("use_")) {
          fail(n, `"${id}" is the name of a built-in block; pick another name.`);
        } else if (placed.has(id) || fresh.has(id)) {
          addSection(id, { ...anchor!, body } as Section);
        } else if (usedIds.has(id)) {
          fail(n, `"${id}" is already a block in My blocks. Drag it into the engine first to add code to it, or pick another name.`);
        } else {
          usedIds.add(id);
          const requires = requiresAt(index, anchor!);
          if (inside) requires.add(inside);
          const slot = inside && placed.get(inside) && isCustomSlot(placed.get(inside)!.slot) ? (placed.get(inside)!.slot as CustomSlot) : slotAt(at, anchor!);
          fresh.set(id, { slot, requires, label: label(id) });
          addSection(id, { ...anchor!, body } as Section);
        }
        k = end + 1;
      }
    };
    /** A block the anchor sits inside must stay placed for the code to appear. */
    const requiresAt = (index: number, anchor: Head): Set<string> => {
      const req = new Set<string>();
      const owner = index >= 0 ? innerOwner(index) : undefined;
      if (owner && !owner.includes("|") && searchSpec(owner)) req.add(owner);
      if (anchor.kind === "hook" && anchor.hook === "on_cutoff") req.add("alpha_beta");
      return req;
    };

    /** A change inside a built-in block's own code becomes part of your version of it. */
    const forkEdit = (base: string, rows: number[], insertAfter: number | null, add: string[], line: number): boolean => {
      if (!template) return false;
      const spans = findRegions(template, regionOf(base));
      if (rows.some((i) => BLOCK_LINE.test(O[i]!) || END_LINE.test(O[i]!))) {
        fail(line, "Keep the `// @block` and `// @end` lines of built-in blocks as they are.");
        return true;
      }
      const tplOf = (i: number) => (vo[i]!.t === "tpl" ? (vo[i] as { line: number }).line : -1);
      const ks = rows.map(tplOf);
      const probe = ks[0] ?? (insertAfter !== null ? tplOf(insertAfter) : -1);
      const r = spans.findIndex((s) => probe >= s.start && probe < (s.else ?? s.end));
      if (r < 0) {
        fail(line, `This is code ${searchSpec(base)?.label ?? base} shares with other blocks; use Edit this block on it instead.`);
        return true;
      }
      const span = spans[r]!;
      const inBody = (k: number) => k > span.start && k < (span.else ?? span.end);
      if (ks.some((k) => !inBody(k))) {
        fail(line, "Keep the `// @block` and `// @end` lines of built-in blocks as they are.");
        return true;
      }
      const key = `${tplName}.rs ${r + 1}`;
      if (!forkOps.has(base)) forkOps.set(base, new Map());
      const m = forkOps.get(base)!;
      if (!m.has(key)) m.set(key, []);
      const at = ks.length ? ks[0]! - span.start - 1 : probe - span.start; // after the probe line (or after the marker: 0)
      m.get(key)!.push({ at, remove: ks.map((k) => k - span.start - 1), add });
      return true;
    };

    // Indentation of unchanged lines does not matter (formatters may move comments).
    const norm = (ls: string[]) => ls.map((l) => l.trim());
    type LayerOp = { kind: "replace"; rows: number[]; add: string[]; line: number } | { kind: "insert"; at: number; add: string[]; line: number };
    const layerOps: LayerOp[] = [];
    /** Notes the block a change on top builds on, and the new block's slot. */
    const buildOn = (owner: string, at: number) => {
      const custom = placed.get(owner);
      if (owner !== "engine") layerRequires.add(owner);
      if (layerSlot) return;
      const spec = searchSpec(owner);
      if (custom && isCustomSlot(custom.slot)) layerSlot = custom.slot;
      else if (custom?.base && searchSpec(custom.base)) layerSlot = searchSpec(custom.base)!.slot;
      else if (spec) layerSlot = spec.slot;
      else if (evalSpec(owner) || custom?.slot === "eval" || tplName === "eval") layerSlot = "eval";
      else layerSlot = slotAt(at, { kind: "insert", file: "", anchor: "", line: 0 });
    };
    const hasMarkerLines = (ls: string[]) => ls.some((l) => BLOCK_LINE.test(l) || END_LINE.test(l) || HOOK_LINE.test(l));

    for (const h of lineHunks(norm(O), norm(E))) {
      const removed = Array.from({ length: h.a1 - h.a0 }, (_, i) => h.a0 + i);
      const add = E.slice(h.b0, h.b1);
      const real = removed.filter((i) => !blank(O[i]));
      const line = h.b0 + 1;
      if (real.length === 0 && add.every((l) => blank(l))) continue;

      if (real.length > 0) {
        const os = real.map((i) => vo[i]!);
        const first = os[0]!;
        // On top: a change inside one block (yours or built-in) becomes a replacement in the new block.
        if (layer && !hasMarkerLines(add)) {
          const blocksTouched = new Set(os.map((o) => (o.t === "body" ? o.block : o.t === "tpl" ? builtinOwner(real[os.indexOf(o)]!) : null)));
          const owner = [...blocksTouched][0];
          if (blocksTouched.size === 1 && owner && os.every((o) => o.t === "body" || o.t === "tpl")) {
            buildOn(owner.startsWith("eval_") ? owner.slice(5) : owner, h.a0);
            layerOps.push({ kind: "replace", rows: real, add, line });
            continue;
          }
        }
        // Inside one section of a custom block.
        if (first.t === "body" && os.every((o) => o.t === "body" && o.block === first.block && o.section === first.section && o.line >= 0)) {
          const lines = os.map((o) => (o as { line: number }).line);
          bodyOp(first.block, first.section, {
            at: Math.min(...lines),
            remove: lines,
            add: strip(add, sectionIndent(first.block, first.section)),
          });
          continue;
        }
        // Whole sections of one custom block removed (maybe with new code in their place).
        if (os.every((o) => o.t !== "tpl" && o.t !== "hook")) {
          const ids = new Set(os.map((o) => (o as { block: string }).block));
          const touched = new Set(os.flatMap((o) => (o.t === "body" ? [o.section] : (o as { sections: number[] }).sections)));
          const id = [...ids][0]!;
          const all = vo
            .map((o, i) => ({ o, i }))
            .filter(({ o }) => o.t !== "tpl" && o.t !== "hook" && (o as { block: string }).block === id)
            .filter(({ o }) => (o.t === "body" ? touched.has(o.section) : (o as { sections: number[] }).sections.some((s) => touched.has(s))));
          if (ids.size === 1 && all.every(({ i }) => i >= h.a0 && i < h.a1)) {
            if (!deleted.has(id)) deleted.set(id, new Set());
            for (const s of touched) deleted.get(id)!.add(s);
            if (add.some((l) => !blank(l))) newCode(add, h.a0, h.b0);
            continue;
          }
          fail(line, `Keep the \`// @block ${id}\` and \`// @end ${id}\` lines together: change the code between them, or remove both.`);
          continue;
        }
        // Inside one built-in block.
        const owners = new Set(real.map(builtinOwner));
        const base = [...owners][0];
        if (owners.size === 1 && base) {
          const type = base.startsWith("eval_") ? base.slice(5) : base;
          forkEdit(type, real, null, add, line);
          continue;
        }
        fail(
          line,
          `\`${O[real[0]!]!.trim()}\` is code several blocks share, so it can't be changed here. Add your own code between \`// @block <name>\` and \`// @end <name>\` lines instead.`,
        );
        continue;
      }

      // Pure insertion before view line a0.
      const prev = vo[h.a0 - 1];
      const next = vo[h.a0];
      // On top: new lines inside a block (yours or built-in) become an insert in the new block.
      if (layer && !hasMarkerLines(add)) {
        const ownerOf = (o: ViewOrigin | undefined, i: number) =>
          o?.t === "body" || o?.t === "open" || o?.t === "close" ? o.block : o?.t === "tpl" ? builtinOwner(i) : null;
        const pOwner = ownerOf(prev, h.a0 - 1);
        const nOwner = ownerOf(next, h.a0);
        if (pOwner && pOwner === nOwner) {
          buildOn(pOwner.startsWith("eval_") ? pOwner.slice(5) : pOwner, h.a0);
          layerOps.push({ kind: "insert", at: h.a0, add, line });
          continue;
        }
      }
      // New block markers inside a block's code make a new block, not part of that block.
      const newBlock = add.some((l) => {
        const m = BLOCK_LINE.exec(l);
        return m && !(prev && "block" in prev && prev.block === m[1]);
      });
      if (
        !newBlock &&
        prev &&
        (prev.t === "body" || prev.t === "open") &&
        next &&
        (next.t === "body" || next.t === "close") &&
        prev.block === next.block
      ) {
        const section = prev.t === "body" ? prev.section : prev.sections[0]!;
        const at = prev.t === "body" ? (prev.line < 0 ? 0 : prev.line + 1) : 0;
        bodyOp(prev.block, section, { at, remove: [], add: strip(add, sectionIndent(prev.block, section)) });
        continue;
      }
      const hasMarkers = add.some((l) => BLOCK_LINE.test(l) || HOOK_LINE.test(l));
      const pb = h.a0 > 0 ? builtinOwner(h.a0 - 1) : null;
      const nb = builtinOwner(h.a0);
      if (!hasMarkers && pb && pb === nb) {
        const type = pb.startsWith("eval_") ? pb.slice(5) : pb;
        forkEdit(type, [], h.a0 - 1, add, line);
        continue;
      }
      newCode(add, h.a0, h.b0);
    }

    // The new block on top: its replacements and inserts, anchored on lines it can see.
    if (layer && layerOps.length && tplName) {
      const builds = closureOf(layerRequires);
      const seeable = (k: number) => {
        const o = vo[k]!;
        if (blank(O[k]) || MARKER_LINE.test(O[k]!)) return false;
        return o.t === "tpl" || (o.t === "body" && (o.fork === true || builds.has(o.block)));
      };
      for (const op of layerOps) {
        const file = `${tplName}.rs`;
        if (op.kind === "replace") {
          const a = anchorText(op.rows[0]!, builds);
          if (!a || op.rows.some((k) => !seeable(k))) {
            fail(op.line, "This change can't be made in a block on top: change fewer lines, inside one block.");
            continue;
          }
          let to: string | undefined;
          if (op.rows.length > 1) {
            to = O[op.rows.at(-1)!]!.trim();
            // The generator takes the first line equal to `to` below the anchor; it must be the last line changed.
            const firstEqual = op.rows.find((k, n) => n > 0 && O[k]!.trim() === to);
            if (firstEqual !== op.rows.at(-1)) {
              fail(op.line, `The last line you changed, "${to}", appears more than once in the lines you changed; change fewer lines at a time.`);
              continue;
            }
          }
          const indent = /^\s*/.exec(O[op.rows[0]!]!)![0];
          const body = dedent(strip(op.add, indent)).join("\n");
          addSection(layer.id, { kind: "replace", file, ...a, ...(to !== undefined ? { to } : {}), body, line: 0 });
        } else {
          let k = op.at - 1;
          while (k >= 0 && !seeable(k)) k--;
          let before = false;
          if (k < 0) {
            k = op.at;
            while (k < O.length && !seeable(k)) k++;
            before = true;
          }
          const a = k >= 0 && k < O.length ? anchorText(k, builds) : null;
          if (!a) {
            fail(op.line, "New lines here have no line above or below to attach to.");
            continue;
          }
          const indent = before ? /^\s*/.exec(O[k]!)![0] : indentAfterLine(O[k]!);
          const body = dedent(strip(op.add, indent)).join("\n");
          addSection(layer.id, { kind: "insert", file, ...a, ...(before ? { before: true } : {}), body, line: 0 });
        }
      }
    }
  }
  if (layer && added.has(layer.id)) {
    fresh.set(layer.id, { slot: layerSlot ?? "root", requires: layerRequires, label: layer.label });
  }

  result.changed = [...new Set([...ops.keys(), ...deleted.keys(), ...forkOps.keys()])];

  // Changed and new sections of the project's blocks.
  for (const [id, block] of placed) {
    if (!ops.has(id) && !deleted.has(id) && !added.has(id)) continue;
    const src = ws.customBlocks?.[id] ?? "";
    let text = patchSource(src, block, ops.get(id), deleted.get(id), added.get(id) ?? []);
    const params = unknownConstants(newCodeOf(ops.get(id), added.get(id)), new Set([...known, ...block.params.map((p) => p.rust)]));
    if (params.length) text = addParams(text, params);
    result.sources[id] = text;
  }
  // New blocks.
  for (const [id, info] of fresh) {
    const sections = added.get(id) ?? [];
    const code = sections.map((s) => s.body).join("\n");
    const params: ParamSpec[] = unknownConstants(code, known).map((name) => ({ key: name, rust: name, label: name, type: "i32", default: 1 }));
    const block: BlockFile = {
      id,
      label: info.label,
      slot: info.slot,
      requires: [...info.requires],
      description: "",
      info: "",
      params,
      sections,
    };
    result.sources[id] = serializeBlock(block);
    result.created.push({ id, slot: info.slot });
  }
  // Your versions of built-in blocks.
  for (const [base, regions] of forkOps) {
    const id = freeId(`my_${base}`, usedIds);
    usedIds.add(id);
    const src = forkBlock(base, id, undefined, enabled);
    const block = parseBlock(src).block!;
    const bodies = new Map<number, string>();
    for (const [key, list] of regions) {
      const [file, index] = key.split(" ");
      const k = block.sections.findIndex((s) => s.kind === "region" && s.file === file && s.index === Number(index));
      if (k < 0) continue;
      const tpl = TEMPLATES[file!.replace(/\.rs$/, "") as keyof typeof TEMPLATES];
      const span = findRegions(tpl, regionOf(base))[Number(index) - 1]!;
      const raw = tpl.split("\n").slice(span.start + 1, span.else ?? span.end);
      bodies.set(k, dedent(collapseBuiltins(applyOps(raw, list), enabled)).join("\n"));
    }
    let text = replaceBodies(src, block, bodies);
    const params = unknownConstants([...bodies.values()].join("\n"), new Set([...known, ...block.params.map((p) => p.rust)]));
    if (params.length) text = addParams(text, params);
    result.sources[id] = text;
    result.forks.push({ base, id });
  }

  // Everything produced must be a valid block file.
  for (const [id, text] of Object.entries(result.sources)) {
    const error = parseBlock(text).diagnostics.find((d) => d.level === "error");
    if (error) result.errors.push({ path: blockFilePath(id, text), line: error.line, message: `${id}: ${error.message}` });
  }
  return result;
}

function newCodeOf(ops: Map<number, BodyOp[]> | undefined, added: Section[] | undefined): string {
  return [...[...(ops?.values() ?? [])].flat().flatMap((o) => o.add), ...(added ?? []).map((s) => s.body)].join("\n");
}

/** Applies body ops (original numbering) to a list of lines. */
function applyOps(lines: string[], ops: { at: number; remove: number[]; add: string[] }[]): string[] {
  const removed = new Set(ops.flatMap((o) => o.remove));
  const out: string[] = [];
  for (let i = 0; i <= lines.length; i++) {
    for (const o of ops) if (o.at === i) out.push(...o.add);
    if (i < lines.length && !removed.has(i)) out.push(lines[i]!);
  }
  return out;
}

/** Source line ranges [header, end) of each section. */
function sectionRanges(src: string, block: BlockFile): [number, number][] {
  const total = src.replace(/\n$/, "").split("\n").length;
  return block.sections.map((s, k) => [s.line - 1, (block.sections[k + 1]?.line ?? total + 1) - 1]);
}

/** Rewrites a block file's text: patched, removed and new sections; the rest stays as written. */
function patchSource(
  src: string,
  block: BlockFile,
  ops: Map<number, BodyOp[]> | undefined,
  deleted: Set<number> | undefined,
  added: Section[],
): string {
  const bodies = new Map<number, string>();
  for (const [k, list] of ops ?? []) {
    if (deleted?.has(k)) continue;
    bodies.set(k, dedent(applyOps(block.sections[k]!.body.split("\n"), list)).join("\n"));
  }
  let text = replaceBodies(src, block, bodies, deleted);
  if (added.length) {
    text = `${text.replace(/\n+$/, "")}\n\n${added.map((s) => `${sectionHead(s)}\n${escapeBody(s.body)}`).join("\n\n")}\n`;
  }
  return text;
}

function replaceBodies(src: string, block: BlockFile, bodies: Map<number, string>, deleted?: Set<number>): string {
  const lines = src.replace(/\n$/, "").split("\n");
  const ranges = sectionRanges(src, block);
  for (let k = ranges.length - 1; k >= 0; k--) {
    const [start, end] = ranges[k]!;
    if (deleted?.has(k)) {
      lines.splice(start, end - start);
      continue;
    }
    const body = bodies.get(k);
    if (body === undefined) continue;
    const last = k === ranges.length - 1;
    lines.splice(start + 1, end - start - 1, ...(body ? escapeBody(body).split("\n") : []), ...(last ? [] : [""]));
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;
}

/** Declares new parameters in a block file's header (as i32 = 1). */
function addParams(src: string, names: string[]): string {
  const lines = src.split("\n");
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "//! ---");
  if (close < 0) return src;
  const items = names.map((n) => `//!   ${n}: i32 = 1`);
  const p = lines.findIndex((l, i) => i < close && /^\/\/!\s*params:\s*$/.test(l));
  if (p >= 0) {
    let end = p + 1;
    while (end < close && /^\/\/!\s{2,}/.test(lines[end]!)) end++;
    lines.splice(end, 0, ...items);
  } else {
    lines.splice(close, 0, "//! params:", ...items);
  }
  return lines.join("\n");
}

export { HOOKS };
