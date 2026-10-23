/**
 * A search box at the top of the toolbox: typing shows every matching block
 * in the flyout, ready to drag.
 */

import * as Blockly from "blockly";

export interface SearchEntry {
  type: string;
  label: string;
  /** Extra words that match (description, slot, id). */
  text: string;
  /** Greyed out: the block needs another block first. */
  disabled?: boolean;
}

export function installToolboxSearch(bw: Blockly.WorkspaceSvg, entries: () => SearchEntry[]): HTMLInputElement {
  const toolbox = bw.getToolbox() as Blockly.Toolbox;
  const host = toolbox.HtmlDiv!;
  const box = document.createElement("div");
  box.className = "tb-search";
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = "Search blocks";
  input.setAttribute("aria-label", "Search blocks");
  box.append(input);
  host.prepend(box);

  const run = () => {
    const q = input.value.trim().toLowerCase();
    const flyout = toolbox.getFlyout();
    if (!q) {
      flyout?.hide();
      return;
    }
    toolbox.clearSelection();
    const words = q.split(/\s+/);
    const hits = entries().filter((e) => {
      const hay = `${e.label} ${e.text} ${e.type}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    // Best matches first: label starts with the query, then label contains it.
    hits.sort((a, b) => rank(a, q) - rank(b, q) || a.label.localeCompare(b.label));
    flyout?.show([
      { kind: "label", text: hits.length ? `${hits.length} block${hits.length > 1 ? "s" : ""} for “${input.value.trim()}”` : `No blocks for “${input.value.trim()}”` },
      ...hits.map((h) => ({ kind: "block", type: h.type, ...(h.disabled ? { disabledReasons: ["cfs_needs"] } : {}) })),
    ] as Blockly.utils.toolbox.FlyoutItemInfoArray);
  };
  input.addEventListener("input", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      run();
      input.blur();
    }
    e.stopPropagation();
  });
  return input;
}

function rank(e: SearchEntry, q: string): number {
  const l = e.label.toLowerCase();
  return l.startsWith(q) ? 0 : l.includes(q) ? 1 : 2;
}
