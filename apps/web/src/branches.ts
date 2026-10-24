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
  lastTestOf,
  formatElo,
  mainChangedSince,
  renameBranch,
  summarizeChanges,
  type HistoryEvent,
  type Workbench,
} from "@cfs/codegen";
import { confirmAction } from "./platform";
import { diffText, renderDiff, workspaceDiff } from "./codediff";
import { preserving } from "./ui";
import type { Workspace } from "@cfs/codegen";

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
  /** The branch whose Keep is being reviewed (its full code diff against main). */
  private reviewing: string | null = null;

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
    this.reviewing = null;
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

  /** A collapsed "Code changes" section; the diff is made when it is opened. */
  private codeSection(before: Workspace, after: Workspace, label: string, open = false, key?: string): HTMLElement {
    const d = el("details", "br-code");
    if (key) d.dataset.key = key;
    const sum = el("summary", undefined, label);
    d.append(sum);
    const fill = () => {
      if (d.dataset.filled) return;
      d.dataset.filled = "1";
      const diff = workspaceDiff(before, after);
      if ("problem" in diff) {
        d.append(el("p", "br-hint", `No code to compare: ${diff.problem}`));
        return;
      }
      const added = diff.reduce((n, f) => n + f.added, 0);
      const removed = diff.reduce((n, f) => n + f.removed, 0);
      sum.textContent = `${label} · +${added} −${removed} in ${diff.length} file${diff.length === 1 ? "" : "s"}`;
      if (diff.length) {
        const copy = button("Copy as diff", "Copy these changes as a git diff");
        copy.addEventListener("click", () => {
          void navigator.clipboard
            .writeText(diffText(diff))
            .then(() => this.host.toast("Copied the diff."))
            .catch(() => this.host.toast("Copy is not available here."));
        });
        d.append(copy);
      }
      d.append(renderDiff(diff));
    };
    d.addEventListener("toggle", () => d.open && fill());
    if (open) {
      d.open = true;
      fill();
    }
    return d;
  }

  private renderReview(id: string): void {
    const wb = this.host.workbench();
    const b = wb.branches[id]!;
    const main = wb.branches[wb.main]!;
    const head = el("div", "br-head");
    head.append(el("h2", undefined, `Keep "${b.name}"?`));
    const close = button("✕", "Close", "br-x");
    close.addEventListener("click", () => this.close());
    head.append(close);
    const review = el("div", "br-review");
    review.append(el("p", "br-lead", `"${main.name}" becomes this version and the branch is closed. These are all the changes "${main.name}" gets:`));
    const lost = mainChangedSince(wb, id);
    if (lost.length) {
      const warn = el("div", "br-warn");
      warn.append(
        el("strong", undefined, `"${main.name}" changed after you cloned it. Keeping replaces these changes:`),
        ...describeChanges(lost).map((l) => el("div", "br-mono", l)),
      );
      review.append(warn);
    }
    const changes = describeChanges(branchChanges(wb, id));
    if (changes.length) {
      const ul = el("ul", "br-changes");
      for (const line of changes) ul.append(el("li", undefined, line));
      review.append(ul);
    }
    review.append(this.codeSection(main.workspace, b.workspace, "Code changes", true, `review-${id}`));
    const foot = el("div", "br-foot");
    const ok = button("Keep it", `Make "${b.name}" the main version`, "btn primary keep-confirm");
    ok.addEventListener("click", () => {
      this.reviewing = null;
      this.act(() => {
        keepBranch(wb, id);
        // The main version changed: the canvas shows it again when it is open.
        if (wb.current === wb.main) this.host.show(wb.current);
      }, `"${b.name}" is now the main version.`);
    });
    const back = button("Back", "Back to the branches", "btn");
    back.addEventListener("click", () => {
      this.reviewing = null;
      this.render();
    });
    foot.append(back, ok);
    this.body.append(head, review, foot);
  }

  private render(): void {
    // Redraws (a running test saves often) keep open code changes open.
    preserving(this.body, () => this.draw());
  }

  private draw(): void {
    const wb = this.host.workbench();
    if (this.reviewing && wb.branches[this.reviewing]) {
      this.body.replaceChildren();
      this.renderReview(this.reviewing);
      return;
    }
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
      const test = lastTestOf(wb, b.id);
      if (test && b.id !== wb.main) {
        const badge = el("span", `ts-badge ts-${test.status}`, `${test.status} ${formatElo(test.result.elo, test.result.eloError)}`);
        badge.title = `Last test against ${test.baseBranch.name}: ${test.result.games} games`;
        top.append(badge);
      }
      if (b.id === wb.current) top.append(el("span", "br-open", "open"));
      const actions = el("span", "br-actions");
      if (b.id !== wb.current) {
        const open = button("Open", "Show this branch on the canvas");
        open.addEventListener("click", () => this.switchTo(b.id));
        actions.append(open);
      }
      if (b.id !== wb.main) {
        const keep = button("Keep", "Make this the main version", "btn small keep");
        keep.addEventListener("click", () => this.keep(b.id));
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
      if (b.id !== wb.main && b.base && changes.length) li.append(this.codeSection(b.base, b.workspace, "Code changes", false, `code-${b.id}`));
      list.append(li);
    }
    this.body.append(list);
    if (Object.keys(wb.branches).length === 1) {
      this.body.append(el("p", "br-hint", `Only "${main.name}" so far. Clone it to try something without losing what works.`));
    }

    // History, newest first.
    if (wb.history.length) {
      const h = el("details", "br-history");
      h.dataset.key = "history";
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

  /** Opens the panel at the Keep review of branch `id`. */
  review(id: string): void {
    if (!this.isOpen) this.open();
    this.keep(id);
  }

  /** Asks, then deletes branch `id`. */
  askDelete(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Keep shows every change first, as a code diff against the main version. */
  private keep(id: string): void {
    this.host.sync();
    this.reviewing = id;
    this.render();
    this.body.parentElement?.scrollTo(0, 0);
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
