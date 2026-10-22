/**
 * Line diffs between two generated projects, grouped into hunks, plus the
 * one-line explanation for each hunk taken from the code's own comments.
 */

export interface Hunk {
  file: string;
  /** First added line in the new file (0-based). */
  start: number;
  /** One past the last added line; equals `start` for pure removals. */
  end: number;
  /** Lines of the old file this hunk replaces. */
  removed: number;
  /** The replaced lines themselves, shown like a GitHub diff. */
  removedLines?: string[];
}

/** Hunks that turn `before` into `after` (both split into lines). */
export function diffLines(file: string, before: string[], after: string[]): Hunk[] {
  // Trim the common prefix and suffix; blocks change small parts of big files.
  let pre = 0;
  while (pre < before.length && pre < after.length && before[pre] === after[pre]) pre++;
  let suf = 0;
  while (
    suf < before.length - pre &&
    suf < after.length - pre &&
    before[before.length - 1 - suf] === after[after.length - 1 - suf]
  ) {
    suf++;
  }
  const a = before.slice(pre, before.length - suf);
  const b = after.slice(pre, after.length - suf);

  // Longest common subsequence table, filled from the end.
  const n = a.length;
  const m = b.length;
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] = a[i] === b[j] ? lcs[at(i + 1, j + 1)]! + 1 : Math.max(lcs[at(i + 1, j)]!, lcs[at(i, j + 1)]!);
    }
  }

  const hunks: Hunk[] = [];
  let open: Hunk | null = null;
  const close = () => {
    if (open) hunks.push(open);
    open = null;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j < m && (i === n || lcs[at(i, j + 1)]! >= lcs[at(i + 1, j)]!)) {
      open ??= { file, start: pre + j, end: pre + j, removed: 0 };
      open.end = pre + j + 1;
      j++;
    } else {
      open ??= { file, start: pre + j, end: pre + j, removed: 0 };
      open.removed++;
      (open.removedLines ??= []).push(a[i]!);
      i++;
    }
  }
  close();
  // Blank-only hunks are noise (rustfmt-style spacing around regions).
  return hunks.filter(
    (h) => h.removed > 0 || after.slice(h.start, h.end).some((l) => l.trim() !== ""),
  );
}

const COMMENT = /^\s*\/\/[/!]?\s?(.*)$/;
const MARKER = /^\s*\/\/ @(block|end|else)\b/;

/** The first explanatory comment inside lines[start, end), if any. */
export function explain(lines: string[], start: number, end: number): string | null {
  const parts: string[] = [];
  for (let k = start; k < end; k++) {
    const line = lines[k]!;
    if (MARKER.test(line)) continue;
    const m = COMMENT.exec(line);
    if (m) {
      const text = m[1]!.trim();
      if (/^-+$/.test(text) || text === "") {
        if (parts.length) break;
        continue;
      }
      parts.push(text.replace(/\s{2,}/g, " "));
    } else if (parts.length) {
      break;
    }
  }
  return parts.length ? parts.join(" ") : null;
}

const BLOCK = /^\s*\/\/ @block (\w+)\s*$/;
const END = /^\s*\/\/ @end (\w+)\s*$/;

/** The block region each line belongs to (markers included). */
export function lineRegions(lines: string[]): (string | null)[] {
  let region: string | null = null;
  return lines.map((line) => {
    const start = BLOCK.exec(line);
    if (start) region = start[1]!;
    const here = region;
    if (END.test(line)) region = null;
    return here;
  });
}

const MARKER_LINE = /^\s*\/\/ @(block|end|else)\b/;
const COMMENT_LINE = /^\s*\/\//;

/**
 * Splits lines[start, end) into sections: a new section begins wherever a
 * comment follows code or a blank line, so each section is one commented
 * piece of code. Sections with nothing but markers, blanks and closing
 * braces are dropped.
 */
export function splitSections(lines: string[], start: number, end: number): [number, number][] {
  const commentish = (k: number) => COMMENT_LINE.test(lines[k] ?? "");
  const starts = [start];
  for (let k = start + 1; k < end; k++) {
    if (commentish(k) && !commentish(k - 1)) starts.push(k);
  }
  const out: [number, number][] = [];
  starts.forEach((s, i) => {
    const e = starts[i + 1] ?? end;
    const meaningful = lines
      .slice(s, e)
      .some((l) => l.trim() !== "" && !MARKER_LINE.test(l) && !/^[\s})\];,]*$/.test(l));
    if (meaningful) out.push([s, e]);
  });
  return out;
}

/** A fallback explanation for a section without its own comment. */
export function describeCode(lines: string[], start: number, end: number): string | null {
  const first = lines.slice(start, end).find((l) => l.trim() !== "" && !MARKER_LINE.test(l))?.trim() ?? "";
  if (first.startsWith("use ")) return "Imports: the other parts of the engine and of the chess library this code uses.";
  if (first.startsWith("mod ")) return "Declares the files (modules) the engine is made of.";
  if (first.startsWith("#![allow")) return "Tells the compiler not to warn about imports that some block combinations leave unused.";
  if (first.startsWith("#[derive")) return "Lets Rust copy, compare and print this type automatically.";
  if (/^(pub )?struct /.test(first)) return `Defines ${first.replace(/^(pub )?struct (\w+).*/, "$2")}, the data this part of the engine keeps.`;
  if (/^impl /.test(first)) return `The functions that belong to ${first.replace(/^impl(<.*?>)? (\w+ for )?(\w+).*/, "$3")}.`;
  return null;
}
