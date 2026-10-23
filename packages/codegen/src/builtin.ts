/**
 * Short stand-ins in your version of a block for the code of other blocks
 * that were not in your engine when you made it:
 *
 *     // @builtin killers          the code of Killers goes here when you add it
 *
 *     // @until late_move_reductions
 *     score = ...;                 the code that runs until you add LMR; then
 *     // @end late_move_reductions LMR's own code takes its place
 *
 *     // @block transposition_table
 *     ...                          code of a block in your engine; what runs
 *     // @end transposition_table  without it is the original code
 *
 * When the code is generated each stand-in is replaced by the original code
 * at that place, so adding Killers later still works with your version.
 * Older versions may hold `// @else` with a lone `// @builtin`: that branch
 * keeps the original code.
 */

export const BUILTIN_LINE = /^(\s*)\/\/ @builtin(?: ([\w|]+))?\s*$/;
const BLOCK = /^(\s*)\/\/ @block ([\w|]+)\s*$/;
const UNTIL = /^(\s*)\/\/ @until ([\w|]+)\s*$/;
const ELSE = /^\s*\/\/ @else\s*$/;
const END = /^\s*\/\/ @end\b/;

/** End (and `@else`) of the region opened at `start`. */
function regionEnd(lines: string[], start: number): { else?: number; end: number } {
  let depth = 0;
  let els: number | undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (BLOCK.test(l)) depth++;
    else if (END.test(l)) {
      if (depth === 0) return { else: els, end: i };
      depth--;
    } else if (depth === 0 && ELSE.test(l) && els === undefined) els = i;
  }
  return { else: els, end: lines.length - 1 };
}

const blank = (ls: string[]) => ls.every((l) => l.trim() === "");

/**
 * Shortens the code of other blocks inside a version of a block:
 * a block that is not in the engine becomes `// @builtin <names>`, or
 * `// @until <names>` … `// @end <names>` around the code that runs without
 * it; a block that is in the engine keeps its code but loses its `@else`
 * part (unused while it is there).
 */
export function collapseBuiltins(lines: string[], enabled: ReadonlySet<string>): string[] {
  const on = (names: string) => names.split("|").some((n) => enabled.has(n));
  const out: string[] = [];
  const walk = (a: number, b: number) => {
    for (let i = a; i < b; i++) {
      const m = BLOCK.exec(lines[i]!);
      if (!m) {
        out.push(lines[i]!);
        continue;
      }
      const [, indent, names] = m;
      const { else: els, end } = regionEnd(lines, i);
      const ifPart = lines.slice(i + 1, els ?? end);
      const elsePart = els === undefined ? [] : lines.slice(els + 1, end);
      // The part that is generated now.
      const visible = on(names!) ? ifPart : elsePart;
      if (blank(visible)) {
        out.push(`${indent}// @builtin ${names}`);
      } else if (on(names!)) {
        out.push(lines[i]!);
        walk(i + 1, els ?? end);
        out.push(lines[end]!);
      } else {
        out.push(`${indent}// @until ${names}`);
        walk(els! + 1, end);
        out.push(`${indent}// @end ${names}`);
      }
      i = end;
    }
  };
  walk(0, lines.length);
  return out;
}

interface Node {
  start: number;
  else?: number;
  end: number;
}

/**
 * Walks nested regions, naming each by its place: the names of the regions
 * around it, its own names and which one of its siblings with those names
 * it is. `@builtin <names>` lines count as regions.
 */
function walkTree(
  lines: string[],
  canon: (names: string) => string,
  visit: (i: number, kind: "open" | "until" | "else" | "end" | "builtin" | "stub" | "line", path: string, inElse: boolean) => void,
): void {
  const stack: { path: string; inElse: boolean; counts: Map<string, number> }[] = [{ path: "", inElse: false, counts: new Map() }];
  const child = (names: string) => {
    const top = stack.at(-1)!;
    const key = canon(names);
    const k = (top.counts.get(key) ?? 0) + 1;
    top.counts.set(key, k);
    return `${top.path}/${key}#${k}`;
  };
  lines.forEach((line, i) => {
    const b = BLOCK.exec(line);
    if (b) {
      const path = child(b[2]!);
      stack.push({ path, inElse: false, counts: new Map() });
      return visit(i, "open", path, false);
    }
    const u = UNTIL.exec(line);
    if (u) {
      // The code inside `@until` is the code for when the block is missing: its `@else` part.
      const path = child(u[2]!);
      stack.push({ path, inElse: true, counts: new Map() });
      return visit(i, "until", path, true);
    }
    const top = stack.at(-1)!;
    if (ELSE.test(line) && stack.length > 1) {
      top.inElse = true;
      return visit(i, "else", top.path, true);
    }
    if (END.test(line) && stack.length > 1) {
      stack.pop();
      return visit(i, "end", top.path, top.inElse);
    }
    const s = BUILTIN_LINE.exec(line);
    if (s?.[2]) return visit(i, "builtin", child(s[2]), false);
    if (s) return visit(i, "stub", top.path, top.inElse);
    visit(i, "line", top.path, top.inElse);
  });
}

/** Every region of `lines` by its place. */
function regionsByPath(lines: string[], canon: (names: string) => string): Map<string, Node> {
  const out = new Map<string, Node>();
  walkTree(lines, canon, (i, kind, path) => {
    if (kind === "open") out.set(path, { start: i, end: i });
    else if (kind === "else") out.get(path)!.else ??= i;
    else if (kind === "end") out.get(path)!.end = i;
  });
  return out;
}

/**
 * Replaces the `// @builtin` lines of a body with the code they stand for,
 * taken from `original` (the code the body replaces). Returns, for each
 * line, either the body line it came from or the original line.
 * `alias` maps renamed regions (your versions of blocks) to their original names.
 */
export function expandBuiltins(
  body: string[],
  original: string[],
  alias: ReadonlyMap<string, string> = new Map(),
): { line: string; from: { body: number } | { original: number } }[] {
  const canon = (names: string) =>
    names
      .split("|")
      .map((n) => alias.get(n) ?? n)
      .join("|");
  const orig = regionsByPath(original, canon);
  const untils = new Set<string>();
  const out: { line: string; from: { body: number } | { original: number } }[] = [];
  const copy = (a: number, b: number) => {
    for (let k = a; k < b; k++) out.push({ line: original[k]!, from: { original: k } });
  };
  walkTree(body, canon, (i, kind, path, inElse) => {
    if (kind === "until") {
      // The block's own code (original), then the code you see as its `@else` part.
      const n = orig.get(path);
      if (!n) return;
      untils.add(path);
      copy(n.start, n.else ?? n.end);
      if (n.else !== undefined) copy(n.else, n.else + 1);
      else out.push({ line: `${/^\s*/.exec(original[n.start]!)![0]}// @else`, from: { body: i } });
      return;
    }
    if (kind === "end" && untils.has(path)) {
      const n = orig.get(path);
      if (n) return copy(n.end, n.end + 1);
    }
    if (kind === "end" && !inElse) {
      // A block shown without its `@else` part keeps the original one.
      const n = orig.get(path);
      if (n?.else !== undefined) copy(n.else, n.end);
    }
    if (kind === "builtin") {
      const n = orig.get(path);
      if (n) copy(n.start, n.end + 1);
      return;
    }
    if (kind === "stub") {
      const n = orig.get(path);
      if (n) {
        if (inElse && n.else !== undefined) copy(n.else + 1, n.end);
        else if (!inElse) copy(n.start + 1, n.else ?? n.end);
      }
      return;
    }
    out.push({ line: body[i]!, from: { body: i } });
  });
  return out;
}
