/**
 * Shared setup of the two code editors (block editor, Edit code): Rust
 * highlighting, 4-space indentation with Tab, auto-indent, Format, and
 * autocompletion for cozy-chess and the engine.
 */

import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentSelection, indentWithTab, selectAll } from "@codemirror/commands";
import { rust } from "@codemirror/lang-rust";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { cfsCompletions } from "./complete";
import { signatureHelp } from "./sighelp";

export interface SetupOptions {
  onSave: () => void;
  /** Parameter constants in scope, for completion. */
  params: () => { name: string; type: string }[];
}

/** Re-indents the whole document the way the Rust grammar says, keeping the cursor line. */
export function formatDocument(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head).number;
  selectAll(view);
  indentSelection(view);
  // Trailing spaces go too.
  const changes: { from: number; to: number }[] = [];
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const l = view.state.doc.line(n);
    const m = /\s+$/.exec(l.text);
    if (m) changes.push({ from: l.from + m.index, to: l.to });
  }
  const target = view.state.doc.line(Math.min(line, view.state.doc.lines));
  view.dispatch({ changes, selection: EditorSelection.cursor(target.from) });
  return true;
}

export function rustEditor(opts: SetupOptions): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(4),
    indentUnit.of("    "),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [cfsCompletions(opts.params)], activateOnTyping: true }),
    signatureHelp(),
    // Tab takes the highlighted suggestion (Enter too); with no list open Tab indents.
    // Ctrl+Space (or Ctrl+I) opens the list.
    Prec.highest(
      keymap.of([
        { key: "Tab", run: (v) => completionStatus(v.state) === "active" && acceptCompletion(v) },
        { key: "Ctrl-Space", run: startCompletion, preventDefault: true },
        { key: "Mod-i", run: startCompletion, preventDefault: true },
      ]),
    ),
    EditorView.baseTheme({
      ".cm-tooltip-autocomplete ul li[aria-selected]::after": {
        content: '"Tab"',
        float: "right",
        marginLeft: "12px",
        opacity: "0.6",
        fontSize: "10px",
        border: "1px solid currentColor",
        borderRadius: "3px",
        padding: "0 3px",
      },
    }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    rust(),
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (opts.onSave(), true) },
      { key: "Shift-Alt-f", preventDefault: true, run: formatDocument },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ];
}
