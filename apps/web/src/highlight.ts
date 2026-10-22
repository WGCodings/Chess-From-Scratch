/**
 * A tiny Rust highlighter for the preview pane. Each line becomes a <div>
 * tagged with the block region it belongs to, so selecting a block can
 * light up its code.
 */

const KEYWORDS = new Set(
  (
    "as break const continue crate else enum fn for if impl in let loop match mod move mut pub " +
    "ref return self Self static struct super trait type use where while true false"
  ).split(" "),
);

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TOKEN =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*")|(\b\d[\d_]*(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|(#!?\[[^\]]*\])/g;

function highlightLine(line: string): string {
  let out = "";
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    out += escape(line.slice(last, m.index));
    const [text, comment, string, number, ident, attr] = m;
    if (comment) {
      const marker = /^\/\/ @(block|end|else)\b/.test(comment.trim());
      out += `<span class="${marker ? "tk-marker" : "tk-comment"}">${escape(text)}</span>`;
    } else if (string) out += `<span class="tk-string">${escape(text)}</span>`;
    else if (number) out += `<span class="tk-number">${text}</span>`;
    else if (attr) out += `<span class="tk-attr">${escape(text)}</span>`;
    else if (ident && KEYWORDS.has(ident)) out += `<span class="tk-keyword">${text}</span>`;
    else if (ident && /^[A-Z]/.test(ident)) {
      const cls = /^[A-Z0-9_]+$/.test(ident) && ident.length > 1 ? "tk-const" : "tk-type";
      out += `<span class="${cls}">${text}</span>`;
    } else out += escape(text);
    last = m.index! + text.length;
  }
  return out + escape(line.slice(last));
}

/** Lines to show as removed (GitHub style) just above line `at`. */
export interface Removed {
  at: number;
  lines: string[];
  current: boolean;
}

/**
 * Highlighted HTML, one `<div class="ln">` per line. `extra[i]` adds classes
 * to line i (focus, tour highlights); `removed` inserts unnumbered deleted
 * lines above the line where they used to be.
 */
export function renderCode(source: string, extra: string[] = [], removed: Removed[] = []): string {
  const src = source.replace(/\n$/, "").split("\n");
  const before = new Map<number, string>();
  for (const r of removed) {
    const cls = r.current ? "ln removed current" : "ln removed";
    const html = r.lines.map((l) => `<div class="${cls}">${highlightLine(l) || " "}</div>`).join("");
    const at = Math.min(r.at, src.length);
    before.set(at, (before.get(at) ?? "") + html);
  }
  return (
    src
      .map((line, i) => {
        const cls = extra[i] ? `ln ${extra[i]}` : "ln";
        return `${before.get(i) ?? ""}<div class="${cls}">${highlightLine(line) || " "}</div>`;
      })
      .join("") + (before.get(src.length) ?? "")
  );
}
