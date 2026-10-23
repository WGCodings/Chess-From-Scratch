/**
 * Signature help: inside the brackets of a call, a small tooltip above the
 * cursor shows the parameters, with the one being typed in bold.
 */

import { StateField, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { signatureAt } from "./complete";

function tooltipFor(state: EditorState): Tooltip | null {
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const head = sel.head;
  const before = state.doc.sliceString(Math.max(0, head - 600), head);
  // Not inside a comment.
  const line = state.doc.lineAt(head);
  if (/^\s*\/\//.test(line.text)) return null;
  const sig = signatureAt(before);
  if (!sig) return null;
  return {
    pos: head,
    above: true,
    strictSide: true,
    arrow: false,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-sig";
      const call = document.createElement("div");
      call.className = "cm-sig-call";
      call.append(`${sig.name}(`);
      if (sig.params.length === 0) call.append(document.createTextNode("no arguments"));
      sig.params.forEach((p, k) => {
        if (k > 0) call.append(", ");
        const span = document.createElement(k === sig.active ? "b" : "span");
        span.textContent = p;
        call.append(span);
      });
      call.append(")");
      if (sig.ret) call.append(` -> ${sig.ret}`);
      dom.append(call);
      if (sig.doc) {
        const doc = document.createElement("div");
        doc.className = "cm-sig-doc";
        doc.textContent = sig.doc;
        dom.append(doc);
      }
      return { dom };
    },
  };
}

const field = StateField.define<Tooltip | null>({
  create: tooltipFor,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return tooltipFor(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

export function signatureHelp(): Extension {
  return [
    field,
    EditorView.baseTheme({
      ".cm-tooltip.cm-sig, .cm-sig": {
        padding: "4px 8px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "12px",
        maxWidth: "560px",
      },
      ".cm-sig b": { fontWeight: "700", textDecoration: "underline" },
      ".cm-sig-doc": { marginTop: "3px", opacity: "0.75", fontFamily: "system-ui, sans-serif", whiteSpace: "normal" },
    }),
  ];
}
