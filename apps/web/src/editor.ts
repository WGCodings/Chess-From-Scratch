/**
 * The block editor: a code editor for one block file, with live checks and
 * a reference of hooks and skeleton values beside it.
 */

import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CUSTOM_SLOTS, HOOKS, SKELETON_VALUES, parseBlock, type CustomSlot, type Diagnostic } from "@cfs/codegen";
import { formatDocument, rustEditor } from "./cmsetup";

export interface EditorOptions {
  title: string;
  /** Shown under the title. */
  subtitle?: string;
  source: string;
  /** Structural and syntax checks for the current text. */
  check: (source: string) => Diagnostic[];
  /** Saves; returns an error message to keep the editor open. */
  save: (source: string) => string | null;
  exportFile: (source: string) => void;
  /** Line (1-based) to put the cursor on. */
  line?: number;
  /** Parameter constants of the project, for completion. */
  params?: () => { name: string; type: string }[];
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let openEditor: { close: () => void } | null = null;

export function isEditorOpen(): boolean {
  return openEditor !== null;
}

/** Opens the block editor over the page. */
export function openBlockEditor(opts: EditorOptions): void {
  openEditor?.close();
  const backdrop = el("div", "be-backdrop");
  const dialog = el("div", "be");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", opts.title);

  const head = el("header", "be-head");
  const titles = el("div");
  titles.append(el("strong", "be-title", opts.title));
  if (opts.subtitle) titles.append(el("span", "be-sub", opts.subtitle));
  const x = el("button", "tour-x", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Close without saving");
  head.append(titles, x);

  const body = el("div", "be-body");
  const codeBox = el("div", "be-code");
  const side = el("aside", "be-side");
  const checks = el("section", "be-checks");
  checks.append(el("h3", undefined, "Checks"));
  const checkList = el("ul");
  checks.append(checkList);
  side.append(checks, reference());
  body.append(codeBox, side);

  const foot = el("footer", "be-foot");
  const exportBtn = el("button", "btn", "Export block file");
  exportBtn.type = "button";
  const spacer = el("span", "be-spacer");
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  const saveBtn = el("button", "btn primary", "Save block");
  saveBtn.type = "button";
  const formatBtn = el("button", "btn", "Format");
  formatBtn.type = "button";
  formatBtn.title = "Re-indent the code (Shift+Alt+F)";
  foot.append(exportBtn, formatBtn, spacer, cancel, saveBtn);

  dialog.append(head, body, foot);
  backdrop.append(dialog);
  document.body.append(backdrop);

  let dirty = false;
  let timer: number | undefined;
  const runChecks = () => {
    const text = view.state.doc.toString();
    const diags = opts.check(text);
    const errors = diags.filter((d) => d.level === "error");
    saveBtn.disabled = errors.length > 0;
    saveBtn.title = errors.length ? "Fix the errors listed under Checks first." : "";
    checkList.replaceChildren();
    if (diags.length === 0) checkList.append(el("li", "ok", "No problems found. Whether the code compiles is checked by cargo when you build."));
    for (const d of diags) {
      const li = el("li", d.level, d.line ? `Line ${d.line}: ${d.message}` : d.message);
      if (d.line) {
        li.tabIndex = 0;
        li.addEventListener("click", () => goToLine(d.line));
      }
      checkList.append(li);
    }
    const doc = view.state.doc;
    const cm: CmDiagnostic[] = diags.map((d) => {
      const line = doc.line(Math.min(Math.max(d.line, 1), doc.lines));
      return { from: line.from, to: line.to, severity: d.level, message: d.message };
    });
    view.dispatch(setDiagnostics(view.state, cm));
  };

  const view = new EditorView({
    parent: codeBox,
    state: EditorState.create({
      doc: opts.source,
      extensions: [
        rustEditor({
          onSave: () => doSave(),
          // This block's own parameters, then the project's.
          params: () => [
            ...(parseBlock(view.state.doc.toString()).block?.params ?? []).map((p) => ({ name: p.rust, type: p.type })),
            ...(opts.params?.() ?? []),
          ],
        }),
        lintGutter(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          dirty = true;
          window.clearTimeout(timer);
          timer = window.setTimeout(runChecks, 250);
        }),
      ],
    }),
  });

  // Reachable from the page for automated tests: document.querySelector(".be-code").editorView.
  Object.assign(codeBox, { editorView: view });

  const goToLine = (n: number) => {
    const line = view.state.doc.line(Math.min(Math.max(n, 1), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
    view.focus();
  };

  const close = () => {
    window.clearTimeout(timer);
    view.destroy();
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    openEditor = null;
  };
  const tryClose = () => {
    if (dirty && !window.confirm("Close the block editor without saving your changes?")) return;
    close();
  };
  function doSave() {
    if (saveBtn.disabled) return;
    const err = opts.save(view.state.doc.toString());
    if (err) {
      checkList.prepend(el("li", "error", err));
      return;
    }
    close();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      tryClose();
    }
  };
  document.addEventListener("keydown", onKey, true);
  x.addEventListener("click", tryClose);
  cancel.addEventListener("click", tryClose);
  saveBtn.addEventListener("click", doSave);
  exportBtn.addEventListener("click", () => opts.exportFile(view.state.doc.toString()));
  formatBtn.addEventListener("click", () => {
    formatDocument(view);
    view.focus();
  });
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) tryClose();
  });

  openEditor = { close };
  runChecks();
  if (opts.line) goToLine(opts.line);
  else view.focus();
}

/** The reference panel: sections, hooks and skeleton values. */
function reference(): HTMLElement {
  const box = el("section", "be-ref");
  box.append(el("h3", undefined, "Sections"));
  const sections = el("dl");
  const add = (dl: HTMLElement, term: string, desc: string) => {
    dl.append(el("dt", undefined, term), el("dd", undefined, desc));
  };
  add(sections, "// @hook <name>", "Adds code at a hook in the skeleton (list below).");
  add(sections, "// @region <file> <n>", "Replaces region n of the base block in that file (versions of built-in blocks).");
  add(sections, '// @insert <file> after "<line>" #n', "Adds code after an exact line of any file (#n: its n-th occurrence).");
  add(sections, "// @file src/<name>.rs", "Adds a whole new file to the project.");
  box.append(sections);
  box.append(el("p", "be-note", "Section lines start at the beginning of a line. Parameters you declare in the header are constants: use them by name."));

  box.append(el("h3", undefined, "Hooks: one per slot"));
  box.append(el("p", "be-note", "Each slot of the Negamax and Evaluation blocks has a hook with the same name, where blocks of that slot work."));
  const hooks = el("dl");
  for (const [name, h] of Object.entries(HOOKS)) if (h.slot) add(hooks, `${name} (${h.file})`, h.description);
  box.append(hooks);
  box.append(el("h3", undefined, "Support hooks"));
  const support = el("dl");
  for (const [name, h] of Object.entries(HOOKS)) if (!h.slot) add(support, `${name} (${h.file})`, h.description.replace(/^Support: /, ""));
  box.append(support);
  box.append(el("p", "be-note", "Press Ctrl+Space for completions: cozy-chess (board., Piece::, ...), skeleton values and parameters. Tab indents, Shift+Alt+F formats."));

  box.append(el("h3", undefined, "Skeleton values"));
  box.append(
    el(
      "p",
      "be-note",
      `${Object.keys(SKELETON_VALUES).join(", ")}: generated only when a block uses them, so just mention them in your code. tt_move needs a Transposition table.`,
    ),
  );
  return box;
}

/** A small dialog asking for a new block's name and slot. */
export function openNewBlockDialog(onCreate: (label: string, slot: CustomSlot) => void, slot: CustomSlot = "pruning"): void {
  const backdrop = el("div", "be-backdrop");
  const form = el("form", "be be-small");
  form.setAttribute("role", "dialog");
  form.setAttribute("aria-label", "New block");
  form.append(el("strong", "be-title", "New block"));
  form.append(el("p", "be-note", "Starts a block with example code for the slot you pick. You can change everything later."));
  const nameLabel = el("label", "be-field", "Name");
  const name = el("input");
  name.value = "My block";
  name.required = true;
  nameLabel.append(name);
  const slotLabel = el("label", "be-field", "Goes in");
  const select = el("select");
  const SLOT_TEXT: Record<CustomSlot, string> = {
    root: "Search: at the root",
    pruning: "Search: pruning (before the move loop)",
    ordering: "Search: move ordering",
    extensions: "Search: extensions",
    move_loop: "Search: move loop",
    reductions: "Search: reductions",
    leaf: "Search: at depth 0",
    eval: "Evaluation term",
  };
  for (const s of CUSTOM_SLOTS) {
    const o = el("option", undefined, SLOT_TEXT[s]);
    o.value = s;
    o.selected = s === slot;
    select.append(o);
  }
  slotLabel.append(select);
  const foot = el("div", "be-foot");
  const cancel = el("button", "btn", "Cancel");
  cancel.type = "button";
  const create = el("button", "btn primary", "Create and edit");
  create.type = "submit";
  foot.append(el("span", "be-spacer"), cancel, create);
  form.append(nameLabel, slotLabel, foot);
  backdrop.append(form);
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  cancel.addEventListener("click", close);
  form.addEventListener("keydown", (e) => e.key === "Escape" && close());
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    close();
    onCreate(name.value.trim() || "My block", select.value as CustomSlot);
  });
  name.select();
  name.focus();
}
