// A git-style diff of two engines' generated code: per file, the changed
// lines with a few lines of context, numbered like `git diff`.

import { generateProject, type GeneratedFile, type Workspace } from "@cfs/codegen";
import { diffLines } from "./diff";

export interface DiffLine {
  kind: " " | "+" | "-" | "@";
  text: string;
  /** Line number in the old file (context and removed lines). */
  old?: number;
  /** Line number in the new file (context and added lines). */
  new?: number;
}

export interface FileDiff {
  path: string;
  status: "added" | "removed" | "changed";
  added: number;
  removed: number;
  lines: DiffLine[];
}

/** Files that only repeat what is elsewhere in the diff. */
const SKIP = (path: string) => path.startsWith("blocks/") || path === "workspace.json";

const split = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/** The diff of one file, `before` and `after` as lines. */
export function fileDiff(path: string, before: string[], after: string[], context = 3): FileDiff | null {
  const hunks = diffLines(path, before, after);
  if (!hunks.length) return null;
  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  // Old-file position of each hunk: new start minus the net lines added before it.
  let shift = 0;
  const spans = hunks.map((h) => {
    const oldStart = h.start - shift;
    shift += h.end - h.start - h.removed;
    return { ...h, oldStart, oldEnd: oldStart + h.removed };
  });
  let i = 0;
  while (i < spans.length) {
    // Join hunks whose context would touch.
    let j = i;
    while (j + 1 < spans.length && spans[j + 1]!.start - spans[j]!.end <= context * 2) j++;
    const first = spans[i]!;
    const last = spans[j]!;
    const newFrom = Math.max(0, first.start - context);
    const oldFrom = first.oldStart - (first.start - newFrom);
    const newTo = Math.min(after.length, last.end + context);
    const oldTo = last.oldEnd + (newTo - last.end);
    lines.push({ kind: "@", text: `@@ -${oldFrom + 1},${oldTo - oldFrom} +${newFrom + 1},${newTo - newFrom} @@` });
    let n = newFrom;
    let o = oldFrom;
    for (let k = i; k <= j; k++) {
      const h = spans[k]!;
      for (; n < h.start; n++, o++) lines.push({ kind: " ", text: after[n]!, old: o + 1, new: n + 1 });
      for (const text of h.removedLines ?? before.slice(h.oldStart, h.oldEnd)) {
        lines.push({ kind: "-", text, old: ++o });
        removed++;
      }
      for (; n < h.end; n++) {
        lines.push({ kind: "+", text: after[n]!, new: n + 1 });
        added++;
      }
    }
    for (; n < newTo; n++, o++) lines.push({ kind: " ", text: after[n]!, old: o + 1, new: n + 1 });
    i = j + 1;
  }
  return { path, status: "changed", added, removed, lines };
}

/** Every file that differs between two generated projects. */
export function projectDiff(before: GeneratedFile[], after: GeneratedFile[], context = 3): FileDiff[] {
  const old = new Map(before.map((f) => [f.path, f.contents]));
  const now = new Map(after.map((f) => [f.path, f.contents]));
  const paths = [...new Set([...old.keys(), ...now.keys()])].filter((p) => !SKIP(p)).sort();
  const out: FileDiff[] = [];
  for (const path of paths) {
    const a = old.get(path);
    const b = now.get(path);
    if (a === b) continue;
    if (a === undefined || b === undefined) {
      const lines = split(a ?? b ?? "");
      const kind: "+" | "-" = a === undefined ? "+" : "-";
      out.push({
        path,
        status: a === undefined ? "added" : "removed",
        added: a === undefined ? lines.length : 0,
        removed: a === undefined ? 0 : lines.length,
        lines: [
          { kind: "@", text: a === undefined ? `@@ -0,0 +1,${lines.length} @@` : `@@ -1,${lines.length} +0,0 @@` },
          ...lines.map((text, i): DiffLine => (kind === "+" ? { kind, text, new: i + 1 } : { kind, text, old: i + 1 })),
        ],
      });
      continue;
    }
    const d = fileDiff(path, split(a), split(b), context);
    if (d) out.push(d);
  }
  return out;
}

/** The code diff between two workspaces, or why there is none. */
export function workspaceDiff(before: Workspace, after: Workspace): FileDiff[] | { problem: string } {
  try {
    return projectDiff(generateProject(before), generateProject(after));
  } catch (err) {
    return { problem: err instanceof Error ? err.message : String(err) };
  }
}

/** The diff as `git diff` text (for copying). */
export function diffText(files: FileDiff[]): string {
  return files
    .map((f) => [`--- a/${f.status === "added" ? "/dev/null" : f.path}`, `+++ b/${f.status === "removed" ? "/dev/null" : f.path}`, ...f.lines.map((l) => (l.kind === "@" ? l.text : `${l.kind}${l.text}`))].join("\n"))
    .join("\n");
}

/** Renders the diff: one collapsible section per file. */
export function renderDiff(files: FileDiff[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "cd";
  if (!files.length) {
    root.textContent = "The generated code is the same.";
    return root;
  }
  for (const f of files) {
    const sec = document.createElement("details");
    sec.className = "cd-file";
    sec.open = files.length <= 6;
    const sum = document.createElement("summary");
    sum.innerHTML = `<span class="cd-path"></span><span class="cd-count"><b class="cd-add">+${f.added}</b> <b class="cd-del">−${f.removed}</b></span>`;
    sum.querySelector(".cd-path")!.textContent = `${f.path}${f.status === "added" ? " (new file)" : f.status === "removed" ? " (removed)" : ""}`;
    sec.append(sum);
    const table = document.createElement("table");
    table.className = "cd-lines";
    for (const l of f.lines) {
      const tr = document.createElement("tr");
      tr.className = l.kind === "+" ? "cd-a" : l.kind === "-" ? "cd-d" : l.kind === "@" ? "cd-h" : "cd-c";
      const o = document.createElement("td");
      o.className = "cd-no";
      o.textContent = l.old === undefined ? "" : String(l.old);
      const n = document.createElement("td");
      n.className = "cd-no";
      n.textContent = l.new === undefined ? "" : String(l.new);
      const t = document.createElement("td");
      t.className = "cd-text";
      t.textContent = l.kind === "@" ? l.text : `${l.kind === " " ? " " : l.kind} ${l.text}`;
      tr.append(o, n, t);
      table.append(tr);
    }
    sec.append(table);
    root.append(sec);
  }
  return root;
}
