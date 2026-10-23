// The Branches panel: try an idea in a copy of the engine, then keep it
// (it becomes the main version) or delete it. Every branch lists what it
// changed since it was cloned. The workbench itself lives in @cfs/codegen.

import {
  branchChanges,
  branchList,
  cloneBranch,
  deleteBranch,
  describeChanges,
  keepBranch,
  mainChangedSince,
  renameBranch,
  summarizeChanges,
  type HistoryEvent,
  type Workbench,
} from "@cfs/codegen";
import { confirmAction } from "./platform";

export interface BranchHost {
  workbench(): Workbench;
  /** Stores the editor's latest state in the open branch. */
  sync(): void;
  /** Shows branch `id` in the editor (the workbench's `current` is already set). */
  show(id: string): void;
  /** The workbench changed (branches, history): save it. */
  changed(): void;
  toast(message: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, title: string, cls = "btn small"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.title = title;
  return b;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function historyLine(h: HistoryEvent): string {
  switch (h.kind) {
    case "created":
      return `Started "${h.branch}"`;
    case "cloned":
      return `Cloned "${h.detail}" into "${h.branch}"`;
    case "kept":
      return `Kept "${h.branch}" as the main version`;
    case "deleted":
      return `Deleted "${h.branch}"`;
    case "renamed":
      return `Renamed "${h.detail}" to "${h.branch}"`;
    case "test":
      return `Tested "${h.branch}": ${h.detail ?? ""}`;
  }
}

export class BranchPanel {
  private readonly backdrop: HTMLElement;
  private readonly body: HTMLElement;
  private renaming: string | null = null;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly host: BranchHost,
  ) {
    this.backdrop = el("div", "br-backdrop");
    this.backdrop.hidden = true;
    const panel = el("section", "br");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Branches");
    this.body = el("div", "br-body");
    panel.append(this.body);
    this.backdrop.append(panel);
    document.body.append(this.backdrop);
    this.backdrop.addEventListener("mousedown", (e) => {
      if (e.target === this.backdrop) this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    button.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    this.updateButton();
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(): void {
    this.host.sync();
    this.backdrop.hidden = false;
    this.render();
    this.body.querySelector<HTMLInputElement>(".br-new input")?.focus();
  }

  close(): void {
    this.backdrop.hidden = true;
    this.renaming = null;
  }

  /** Shows the open branch's name on the top bar button. */
  updateButton(): void {
    const wb = this.host.workbench();
    const b = wb.branches[wb.current];
    const count = Object.keys(wb.branches).length;
    this.button.textContent = `⑂ ${b?.name ?? "main"}`;
    this.button.title = `Branches: try ideas in a copy of your engine (${count} branch${count === 1 ? "" : "es"})`;
    this.button.classList.toggle("on-branch", wb.current !== wb.main);
  }

  /** Re-renders after the workbench changed elsewhere (open file, new engine). */
  refresh(): void {
    this.updateButton();
    if (this.isOpen) this.render();
  }

  private act(fn: () => void, message?: string): void {
    this.host.sync();
    try {
      fn();
    } catch (err) {
      this.host.toast(err instanceof Error ? err.message : String(err));
      return;
    }
    this.host.changed();
    this.updateButton();
    this.render();
    if (message) this.host.toast(message);
  }

  private switchTo(id: string): void {
    const wb = this.host.workbench();
    if (wb.current === id) return;
    this.host.sync();
    wb.current = id;
    this.host.show(id);
    this.host.changed();
    this.updateButton();
    this.render();
  }

  private render(): void {
    const wb = this.host.workbench();
    const main = wb.branches[wb.main]!;
    const current = wb.branches[wb.current]!;
    this.body.replaceChildren();

    const head = el("div", "br-head");
    head.append(el("h2", undefined, "Branches"));
    const close = button("✕", "Close", "br-x");
    close.addEventListener("click", () => this.close());
    head.append(close);
    this.body.append(head);
    this.body.append(
      el("p", "br-lead", "Try an idea in a copy of your engine. If it works, keep it: it becomes the main version. If not, delete it."),
    );

    // Clone the open branch.
    const form = el("form", "br-new");
    const name = el("input");
    name.placeholder = 'Name, e.g. "+ killers" or "LMR base 0.8"';
    name.maxLength = 60;
    const clone = button(`Clone "${current.name}"`, "Make a copy of the open branch and switch to it", "btn primary");
    clone.type = "submit";
    form.append(name, clone);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      let id = "";
      this.act(() => {
        id = cloneBranch(wb, current.id, name.value || `${current.name} copy`);
      });
      if (!id) return;
      this.switchTo(id);
      this.host.toast(`Now on "${wb.branches[id]?.name ?? ""}". Change it, then keep or delete it here.`);
    });
    this.body.append(form);

    // The branches.
    const list = el("ul", "br-list");
    for (const b of branchList(wb)) {
      const li = el("li", "br-item");
      li.dataset.branch = b.id;
      li.classList.toggle("current", b.id === wb.current);
      const top = el("div", "br-top");
      if (this.renaming === b.id) {
        const input = el("input", "br-rename");
        input.value = b.name;
        input.maxLength = 60;
        const done = () => {
          this.renaming = null;
          if (input.value.trim() && input.value.trim() !== b.name) this.act(() => renameBranch(wb, b.id, input.value));
          else this.render();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") done();
          if (e.key === "Escape") {
            e.stopPropagation();
            this.renaming = null;
            this.render();
          }
        });
        input.addEventListener("blur", done);
        top.append(input);
        queueMicrotask(() => input.select());
      } else {
        const title = el("span", "br-name", b.name);
        title.title = "Double-click to rename";
        title.addEventListener("dblclick", () => {
          this.renaming = b.id;
          this.render();
        });
        top.append(title);
      }
      const changes = branchChanges(wb, b.id);
      const meta =
        b.id === wb.main
          ? "the main version"
          : `from ${wb.branches[b.parent ?? ""]?.name ?? "main"} · ${changes.length ? `${changes.length} change${changes.length > 1 ? "s" : ""}` : "no changes yet"}`;
      top.append(el("span", "br-meta", meta));
      if (b.id === wb.current) top.append(el("span", "br-open", "open"));
      const actions = el("span", "br-actions");
      if (b.id !== wb.current) {
        const open = button("Open", "Show this branch on the canvas");
        open.addEventListener("click", () => this.switchTo(b.id));
        actions.append(open);
      }
      if (b.id !== wb.main) {
        const keep = button("Keep", "Make this the main version", "btn small keep");
        keep.addEventListener("click", () => void this.keep(b.id));
        const del = button("Delete", "Throw this branch away", "btn small del");
        del.addEventListener("click", () => void this.remove(b.id));
        actions.append(keep, del);
      }
      top.append(actions);
      li.append(top);
      if (b.id !== wb.main && changes.length) {
        const ul = el("ul", "br-changes");
        for (const line of describeChanges(changes)) ul.append(el("li", undefined, line));
        li.append(ul);
      }
      list.append(li);
    }
    this.body.append(list);
    if (Object.keys(wb.branches).length === 1) {
      this.body.append(el("p", "br-hint", `Only "${main.name}" so far. Clone it to try something without losing what works.`));
    }

    // History, newest first.
    if (wb.history.length) {
      const h = el("details", "br-history");
      h.open = wb.history.length <= 8;
      h.append(el("summary", undefined, `History (${wb.history.length})`));
      const ul = el("ul");
      for (const ev of [...wb.history].reverse()) {
        const li = el("li");
        li.append(el("time", undefined, when(ev.at)), el("span", undefined, historyLine(ev)));
        if (ev.changes?.length) li.append(el("span", "br-hchanges", summarizeChangesText(ev.changes)));
        ul.append(li);
      }
      h.append(ul);
      this.body.append(h);
    }
  }

  private async keep(id: string): Promise<void> {
    const wb = this.host.workbench();
    const b = wb.branches[id]!;
    const main = wb.branches[wb.main]!;
    const lost = mainChangedSince(wb, id);
    const changes = branchChanges(wb, id);
    const msg =
      `Keep "${b.name}"? It becomes the main version (${summarizeChanges(changes)}) and the branch is closed.` +
      (lost.length ? `\n\n"${main.name}" changed after you cloned it (${summarizeChanges(lost)}). Keeping replaces those changes.` : "");
    if (!(await confirmAction(msg, "Keep branch"))) return;
    // The main version changes: the canvas shows it again when it is open.
    this.act(() => {
      keepBranch(wb, id);
      if (wb.current === wb.main) this.host.show(wb.current);
    }, `"${b.name}" is now the main version.`);
  }

  private async remove(id: string): Promise<void> {
    const wb = this.host.workbench();
    const b = wb.branches[id]!;
    const changes = branchChanges(wb, id);
    if (!(await confirmAction(`Delete "${b.name}"${changes.length ? ` and its changes (${summarizeChanges(changes)})` : ""}? This can't be undone.`, "Delete branch"))) return;
    this.act(() => {
      const wasOpen = wb.current === id;
      deleteBranch(wb, id);
      if (wasOpen) this.host.show(wb.current);
    }, `Deleted "${b.name}".`);
  }
}

function summarizeChangesText(lines: string[]): string {
  return lines.length > 3 ? `${lines.slice(0, 3).join(", ")} and ${lines.length - 3} more` : lines.join(", ");
}
