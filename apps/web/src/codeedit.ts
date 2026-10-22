/**
 * The code pane in edit mode: a dark code editor over one generated file,
 * hook lines included, where `// @block <name>` … `// @end <name>` code you
 * type becomes blocks when saved.
 */

import { oneDark } from "@codemirror/theme-one-dark";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { formatDocument, rustEditor } from "./cmsetup";

const hookLine = Decoration.line({ class: "cm-cfs-hook" });
const markerLine = Decoration.line({ class: "cm-cfs-marker" });

/** Hook lines and block markers stand out from the code. */
const markers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          if (/^\s*\/\/ @hook \w+\s*$/.test(line.text)) b.add(line.from, line.from, hookLine);
          else if (/^\s*\/\/ @(block|end|else)\b/.test(line.text)) b.add(line.from, line.from, markerLine);
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

export interface CodeEditor {
  text(): string;
  setText(text: string, line?: number): void;
  goToLine(line: number): void;
  format(): void;
  destroy(): void;
}

export function createCodeEditor(
  parent: HTMLElement,
  text: string,
  onSave: () => void,
  params: () => { name: string; type: string }[],
  line?: number,
): CodeEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        rustEditor({ onSave, params }),
        oneDark,
        markers,
        EditorView.theme({ "&": { height: "100%" }, ".cm-scroller": { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace" } }),
      ],
    }),
  });
  // Reachable from the page for automated tests.
  Object.assign(parent, { editorView: view });
  const goToLine = (n: number) => {
    const l = view.state.doc.line(Math.min(Math.max(n, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
    view.focus();
  };
  if (line) goToLine(line);
  return {
    text: () => view.state.doc.toString(),
    setText: (t, l) => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
      if (l) goToLine(l);
    },
    goToLine,
    format: () => {
      formatDocument(view);
      view.focus();
    },
    destroy: () => view.destroy(),
  };
}
