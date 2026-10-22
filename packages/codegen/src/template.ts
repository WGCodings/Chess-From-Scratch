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
 */

const BLOCK = /^\s*\/\/ @block ([\w|]+)\s*$/;
const ELSE = /^\s*\/\/ @else\s*$/;
const END = /^\s*\/\/ @end ([\w|]+)\s*$/;

export class TemplateError extends Error {}

export interface Rendered {
  text: string;
  /**
   * For each output line, the regions it sits in, outermost first: `a` or
   * `a|b` for block code, `!x` for the fallback of a missing block `x`.
   * Empty = skeleton. The last positive entry is the block it belongs to.
   */
  owners: string[][];
}

interface Frame {
  names: string[];
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
  const stack: Frame[] = [];
  const visible = () => stack.every((f) => f.on !== f.inElse);
  const ownersHere = () =>
    stack.flatMap((f) =>
      f.on && !f.inElse ? [f.names.join("|")] : !f.on && f.inElse && !f.shared ? [`!${f.names[0]}`] : [],
    );
  const emit = (line: string, marker?: string[]) => {
    out.push(line);
    owners.push(marker ? [...ownersHere(), marker.join("|")] : ownersHere());
  };

  source.split("\n").forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const block = BLOCK.exec(line);
    const end = END.exec(line);
    if (block) {
      const names = block[1]!.split("|");
      for (const n of names) {
        if (!known.has(n)) throw new TemplateError(`${where}: unknown block ${n}`);
      }
      const shown = visible();
      const frame: Frame = { names, on: names.some((n) => enabled.has(n)), shared: names.length > 1, inElse: false };
      if (shown && frame.on && !frame.shared) emit(line, names);
      stack.push(frame);
    } else if (ELSE.test(line)) {
      const top = stack.at(-1);
      if (!top || top.inElse) throw new TemplateError(`${where}: stray @else`);
      top.inElse = true;
    } else if (end) {
      const top = stack.pop();
      if (!top || end[1] !== top.names.join("|")) {
        throw new TemplateError(`${where}: @end ${end[1]} does not close ${top?.names.join("|") ?? "anything"}`);
      }
      if (visible() && top.on && !top.shared) emit(line, top.names);
    } else if (visible()) {
      emit(line);
    }
  });
  if (stack.length) throw new TemplateError(`${file}: @block ${stack.at(-1)!.names.join("|")} is never closed`);

  return tidy(out, owners);
}

/**
 * Tidies what removed regions leave behind, the way rustfmt would, keeping
 * the owner map aligned with the lines.
 */
function tidy(lines: string[], owners: string[][]): Rendered {
  let ls = lines;
  let os = owners;
  const keep = (pred: (i: number) => boolean) => {
    const nl: string[] = [];
    const no: string[][] = [];
    ls.forEach((l, i) => {
      if (pred(i)) {
        nl.push(l);
        no.push(os[i]!);
      }
    });
    ls = nl;
    os = no;
  };
  const blank = (i: number) => ls[i] !== undefined && ls[i]!.trim() === "";

  // At most one blank line in a row.
  keep((i) => !(blank(i) && i > 0 && blank(i - 1)));
  // No blank line after an opening brace.
  keep((i) => !(blank(i) && i > 0 && ls[i - 1]!.endsWith("{")));
  // No blank line before a closing brace.
  keep((i) => !(blank(i) && i + 1 < ls.length && /^[ \t]*\}/.test(ls[i + 1]!)));
  // Empty bodies on one line: `{` followed by a line starting with `}`.
  for (let i = 0; i + 1 < ls.length; i++) {
    if (ls[i]!.endsWith("{") && /^[ \t]*\}/.test(ls[i + 1]!)) {
      ls[i] = ls[i]! + ls[i + 1]!.trimStart();
      ls.splice(i + 1, 1);
      os.splice(i + 1, 1);
    }
  }
  // Exactly one newline at the end.
  while (ls.length && blank(ls.length - 1)) {
    ls.pop();
    os.pop();
  }
  return { text: `${ls.join("\n")}\n`, owners: os };
}
