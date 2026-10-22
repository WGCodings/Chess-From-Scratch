/**
 * Block regions in Rust templates:
 *
 *     // @block null_move_pruning
 *     ...code kept, with its markers, when the block is placed...
 *     // @else
 *     ...optional fallback emitted (without markers) when it is not...
 *     // @end null_move_pruning
 *
 * `// @block a|b` marks code shared by several blocks: it is kept (without
 * markers) when any of them is placed. Regions may nest; a line is kept when
 * every enclosing region keeps it. The markers kept in the output let a
 * future importer map generated code back to blocks.
 *
 * Names starting with `slot_` or `use_` are switches the generator sets on
 * its own (a slot has any block in it; a custom block uses a skeleton
 * helper). They count for keeping code but never appear in the output:
 * `// @block tt_move_ordering|use_tt_move` is emitted as a region of
 * `tt_move_ordering` alone.
 *
 * `// @hook name` lines mark places where custom blocks add code. The
 * generator replaces them before rendering; any left over are dropped.
 */

const BLOCK = /^\s*\/\/ @block ([\w|]+)\s*$/;
const ELSE = /^\s*\/\/ @else\s*$/;
const END = /^\s*\/\/ @end ([\w|]+)\s*$/;
const HOOK = /^\s*\/\/ @hook \w+\s*$/;

/** Switches set by the generator, never shown as regions. */
export const isPseudo = (name: string) => name.startsWith("slot_") || name.startsWith("use_");

export class TemplateError extends Error {}

export interface Rendered {
  text: string;
  /**
   * For each output line, the regions it sits in, outermost first: `a` or
   * `a|b` for block code, `!x` for the fallback of a missing block `x`.
   * Empty = skeleton. The last positive entry is the block it belongs to.
   */
  owners: string[][];
  /** For each output line, the index of the source line it came from. */
  sources: number[];
  /** Hooks in visible code: `at` = the output line they stand before; `source` = their source line. */
  hooks: { at: number; source: number }[];
}

interface Frame {
  /** Real block names (pseudo names removed). */
  names: string[];
  /** The names as written, to match `@end`. */
  written: string;
  on: boolean;
  shared: boolean;
  inElse: boolean;
}

export function renderTemplate(
  source: string,
  enabled: ReadonlySet<string>,
  known: ReadonlySet<string>,
  file = "template",
): string {
  return renderTemplateWithOwners(source, enabled, known, file).text;
}

export function renderTemplateWithOwners(
  source: string,
  enabled: ReadonlySet<string>,
  known: ReadonlySet<string>,
  file = "template",
): Rendered {
  const out: string[] = [];
  const owners: string[][] = [];
  const sources: number[] = [];
  const hooks: { at: number; source: number }[] = [];
  let src = 0;
  const stack: Frame[] = [];
  const visible = () => stack.every((f) => f.on !== f.inElse);
  const ownersHere = () =>
    stack.flatMap((f) =>
      f.on && !f.inElse && f.names.length
        ? [f.names.join("|")]
        : !f.on && f.inElse && !f.shared
          ? [`!${f.names[0]}`]
          : [],
    );
  const emit = (line: string, marker?: string[]) => {
    out.push(line);
    owners.push(marker ? [...ownersHere(), marker.join("|")] : ownersHere());
    sources.push(src);
  };
  // A marker line as emitted: pseudo names removed.
  const markerLine = (line: string, names: string[]) => line.replace(/([\w|]+)\s*$/, names.join("|"));

  source.split("\n").forEach((line, i) => {
    src = i;
    const where = `${file}:${i + 1}`;
    const block = BLOCK.exec(line);
    const end = END.exec(line);
    if (block) {
      const all = block[1]!.split("|");
      for (const n of all) {
        if (!known.has(n) && !isPseudo(n)) throw new TemplateError(`${where}: unknown block ${n}`);
      }
      const names = all.filter((n) => !isPseudo(n));
      const shown = visible();
      const frame: Frame = {
        names,
        written: block[1]!,
        on: all.some((n) => enabled.has(n)),
        shared: names.length !== 1,
        inElse: false,
      };
      if (shown && frame.on && !frame.shared) emit(markerLine(line, names), names);
      stack.push(frame);
    } else if (ELSE.test(line)) {
      const top = stack.at(-1);
      if (!top || top.inElse) throw new TemplateError(`${where}: stray @else`);
      top.inElse = true;
    } else if (end) {
      const top = stack.pop();
      if (!top || end[1] !== top.written) {
        throw new TemplateError(`${where}: @end ${end[1]} does not close ${top?.written ?? "anything"}`);
      }
      if (visible() && top.on && !top.shared) emit(markerLine(line, top.names), top.names);
    } else if (HOOK.test(line)) {
      // Hooks leave nothing behind in the code; the editor shows where they are.
      // Also shown inside a region a slot switches on (`slot_*`): code placed at
      // such a hook switches that region on.
      if (stack.every((f) => f.on !== f.inElse || (!f.inElse && f.written.split("|").some((n) => n.startsWith("slot_"))))) {
        hooks.push({ at: out.length, source: i });
      }
    } else if (visible()) {
      emit(line);
    }
  });
  if (stack.length) throw new TemplateError(`${file}: @block ${stack.at(-1)!.written} is never closed`);

  return tidy(out, owners, sources, hooks);
}

/**
 * Tidies what removed regions leave behind, the way rustfmt would, keeping
 * the owner and source maps aligned with the lines.
 */
function tidy(
  lines: string[],
  owners: string[][],
  sources: number[],
  hooks: { at: number; source: number }[],
): Rendered {
  // Each row remembers its position before tidying, to move the hook positions along.
  let rows = lines.map((text, i) => ({ text, owners: owners[i]!, source: sources[i]!, pos: i }));
  const blank = (i: number) => rows[i] !== undefined && rows[i]!.text.trim() === "";
  const keep = (pred: (i: number) => boolean) => {
    rows = rows.filter((_, i) => pred(i));
  };

  // At most one blank line in a row.
  keep((i) => !(blank(i) && i > 0 && blank(i - 1)));
  // No blank line after an opening brace.
  keep((i) => !(blank(i) && i > 0 && rows[i - 1]!.text.endsWith("{")));
  // No blank line before a closing brace.
  keep((i) => !(blank(i) && i + 1 < rows.length && /^[ \t]*\}/.test(rows[i + 1]!.text)));
  // Empty bodies on one line: `{` followed by a line starting with `}`.
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rows[i]!.text.endsWith("{") && /^[ \t]*\}/.test(rows[i + 1]!.text)) {
      rows[i] = { ...rows[i]!, text: rows[i]!.text + rows[i + 1]!.text.trimStart() };
      rows.splice(i + 1, 1);
    }
  }
  // Exactly one newline at the end.
  while (rows.length && blank(rows.length - 1)) rows.pop();

  const moved = hooks.map((h) => {
    const at = rows.findIndex((r) => r.pos >= h.at);
    return { at: at < 0 ? rows.length : at, source: h.source };
  });
  return {
    text: `${rows.map((r) => r.text).join("\n")}\n`,
    owners: rows.map((r) => r.owners),
    sources: rows.map((r) => r.source),
    hooks: moved,
  };
}
