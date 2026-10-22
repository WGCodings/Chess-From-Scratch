/**
 * A Rust syntax check in the browser (lezer's Rust grammar). It catches
 * unbalanced braces, missing semicolons and the like in generated files; it
 * does not type-check, so code that parses can still fail to compile.
 */

import { parser } from "@lezer/rust";

export interface SyntaxProblem {
  /** 0-based line in the checked text. */
  line: number;
  text: string;
}

/** Lines with a syntax error, at most `limit` of them. */
export function rustSyntaxErrors(code: string, limit = 5): SyntaxProblem[] {
  const tree = parser.parse(code);
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") starts.push(i + 1);
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const out: SyntaxProblem[] = [];
  const seen = new Set<number>();
  tree.iterate({
    enter: (node) => {
      if (out.length >= limit) return false;
      if (!node.type.isError) return;
      const line = lineAt(Math.min(node.from, code.length - 1));
      if (seen.has(line)) return;
      seen.add(line);
      out.push({ line, text: code.slice(starts[line], starts[line + 1] ?? code.length).replace(/\n$/, "") });
    },
  });
  return out;
}
