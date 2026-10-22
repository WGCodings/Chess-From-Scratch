import * as Blockly from "blockly";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  EXAMPLE_BLOCKS,
  BASIC_TIME,
  EVAL_TERMS,
  SEARCH_BLOCKS,
  TIME_MANAGEMENT,
  TRANSPOSITION_TABLE,
  GenerateError,
  HOOKS,
  codeToBlocks,
  emptyWorkspace,
  evalSpec,
  forkBlock,
  freeId,
  generateProject,
  newBlockSource,
  parseBlock,
  referenceWorkspace,
  searchSpec,
  starterWorkspace,
  toCrateName,
  validate,
  viewOf,
  type CodeResult,
  type CustomSlot,
  type Diagnostic,
  type GeneratedFile,
  type Issue,
  type ParamSpec,
  type Workspace,
} from "@cfs/codegen";
import {
  COLOURS,
  CUSTOM_PREFIX,
  ENGINE,
  HCE,
  IMPORT_BLOCK_BUTTON,
  NEGAMAX,
  NEW_BLOCK_BUTTON,
  SLOT_INPUT,
  customType,
  defineBlocks,
  defineCustomBlock,
  fieldNames,
  maxInstances,
  toolbox,
  type ToolboxCustom,
} from "./blocks";
import { loadWorkspace, parseWorkspaceFile, readWorkspace } from "./convert";
import { openBlockEditor, openNewBlockDialog } from "./editor";
import { createCodeEditor, type CodeEditor } from "./codeedit";
import { allIds, library, project, saveLibrary, setProject, sourceOf } from "./library";
import { rustSyntaxErrors } from "./syntax";
import { installToolboxSearch, type SearchEntry } from "./tbsearch";
import { FolderSync, canLinkFolders, rememberFolder, rememberedFolder } from "./folder";
import { describeCode, diffLines, explain, lineRegions, splitSections, type Hunk } from "./diff";
import { renderCode } from "./highlight";
import { infoForBlockType, infoForKey, placedKeys, setCustomLookup, type BlockInfo } from "./info";
import "./style.css";

const STORAGE_KEY = "cfs.blockly.v1";
/** The files that are "your engine"; the rest is machinery. */
const ENGINE_FILES = new Set(["src/search.rs", "src/eval.rs", "src/params.rs"]);

// Blockly setup -------------------------------------------------------------

defineBlocks();

const theme = Blockly.Theme.defineTheme("cfs", {
  name: "cfs",
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: "#f4f2ec",
    toolboxBackgroundColour: "#fbfaf7",
    toolboxForegroundColour: "#23231f",
    flyoutBackgroundColour: "#ebe7dd",
    flyoutForegroundColour: "#23231f",
    flyoutOpacity: 1,
    scrollbarColour: "#cfc9bc",
    insertionMarkerColour: COLOURS.skeleton,
    insertionMarkerOpacity: 0.35,
  },
  fontStyle: { family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', weight: "600", size: 11 },
});

const bw = Blockly.inject("workspace", {
  toolbox: toolbox(),
  renderer: "zelos",
  theme,
  media: "/blockly-media/",
  maxInstances: maxInstances(),
  trashcan: true,
  grid: { spacing: 24, length: 2, colour: "#e2ded4", snap: true },
  zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 1.5, minScale: 0.3 },
  move: { scrollbars: true, drag: true, wheel: false },
});

// "Inline inputs" only rearranges a block's fields and would confuse beginners.
Blockly.ContextMenuRegistry.registry.unregister("blockInline");

Blockly.ContextMenuRegistry.registry.register({
  id: "cfsExplain",
  scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
  displayText: "Explain this block",
  weight: -10,
  preconditionFn: (scope) => (scope.block && infoForBlockType(scope.block.type) ? "enabled" : "hidden"),
  callback: (scope) => {
    if (scope.block) explainBlock(scope.block);
  },
});

/** The built-in block type (search block or eval term) of a Blockly block, if any. */
function builtinOf(block: Blockly.Block): string | null {
  const t = block.type;
  if (t.startsWith("cfs_search_")) return t.slice("cfs_search_".length);
  if (t.startsWith("cfs_eval_")) return t.slice("cfs_eval_".length);
  return null;
}
const customIdOf = (block: Blockly.Block) => (block.type.startsWith(CUSTOM_PREFIX) ? block.type.slice(CUSTOM_PREFIX.length) : null);

Blockly.ContextMenuRegistry.registry.register({
  id: "cfsEdit",
  scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
  displayText: (scope) => (scope.block && customIdOf(scope.block) ? "Edit this block" : "Edit this block (make your own version)"),
  weight: -9,
  preconditionFn: (scope) => (scope.block && (builtinOf(scope.block) || customIdOf(scope.block)) ? "enabled" : "hidden"),
  callback: (scope) => {
    if (scope.block) editBlock(scope.block);
  },
});

Blockly.ContextMenuRegistry.registry.register({
  id: "cfsExportBlock",
  scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
  displayText: "Export block file",
  weight: -8,
  preconditionFn: (scope) => (scope.block && customIdOf(scope.block) ? "enabled" : "hidden"),
  callback: (scope) => {
    const id = scope.block && customIdOf(scope.block);
    const src = id ? sourceOf(id) : undefined;
    if (id && src) download(`${id}.block.rs`, src, "text/plain");
  },
});

Blockly.ContextMenuRegistry.registry.register({
  id: "cfsForgetBlock",
  scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
  displayText: "Remove from My blocks",
  weight: -7,
  preconditionFn: (scope) => {
    const id = scope.block && customIdOf(scope.block);
    return id && library[id] !== undefined ? "enabled" : "hidden";
  },
  callback: (scope) => {
    const id = scope.block && customIdOf(scope.block);
    if (!id) return;
    if (!window.confirm(`Remove "${parseBlock(library[id]!).block?.label ?? id}" from My blocks? Projects that use it keep their copy.`)) return;
    delete library[id];
    saveLibrary();
    updateCustomBlocks();
    toast("Removed from My blocks");
  },
});

/** Everything the toolbox search can find. */
function searchEntries(): SearchEntry[] {
  const out: SearchEntry[] = [
    { type: ENGINE, label: "Engine", text: "root name author bench" },
    { type: NEGAMAX, label: "Negamax search", text: "search skeleton iterative deepening" },
    { type: HCE, label: "Hand-crafted evaluation", text: "eval evaluation skeleton terms" },
    { type: "cfs_basic_time", label: BASIC_TIME.label, text: `time ${BASIC_TIME.description}` },
    { type: "cfs_time_management", label: TIME_MANAGEMENT.label, text: `time ${TIME_MANAGEMENT.description}` },
    { type: "cfs_transposition_table", label: TRANSPOSITION_TABLE.label, text: `tt hash ${TRANSPOSITION_TABLE.description}` },
  ];
  for (const [t, spec] of Object.entries(SEARCH_BLOCKS)) out.push({ type: `cfs_search_${t}`, label: spec.label, text: `${spec.slot} ${spec.description}` });
  for (const [t, spec] of Object.entries(EVAL_TERMS)) out.push({ type: `cfs_eval_${t}`, label: spec.label, text: `eval term ${spec.description}` });
  for (const id of allIds()) {
    const b = parseBlock(sourceOf(id) ?? "").block;
    if (b?.id === id && Blockly.Blocks[customType(id)]) out.push({ type: customType(id), label: b.label, text: `my blocks custom ${b.slot} ${b.description} ${id}` });
  }
  return out;
}
installToolboxSearch(bw, searchEntries);

bw.registerButtonCallback(NEW_BLOCK_BUTTON, () => openNewBlockDialog(createNewBlock));
bw.registerButtonCallback(IMPORT_BLOCK_BUTTON, () => fileInput.click());

// Blocks not connected to an Engine block are greyed out and ignored.
bw.addChangeListener(Blockly.Events.disableOrphans);

// DOM -----------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeEl = $<HTMLPreElement>("code");
const pathEl = $("code-path");
const treeEl = $("tree");
const tourEl = $("tour");
const issuesEl = $<HTMLUListElement>("issues");
const exportBtn = $<HTMLButtonElement>("export");
const fileInput = $<HTMLInputElement>("file");
const toastEl = $("toast");

let files: GeneratedFile[] = [];
let activeFile = "src/search.rs";
let current: Workspace | null = null;
let focusRegion: string | null = null;
const collapsed = new Set<string>();

const lines = (path: string) => files.find((f) => f.path === path)?.contents.replace(/\n$/, "").split("\n") ?? [];

/** Which blocks own each line of a file ([] = skeleton); from the generator or from markers. */
function ownersOf(path: string): string[][] {
  const file = files.find((f) => f.path === path);
  if (file?.owners) return file.owners;
  return lineRegions(lines(path)).map((r) => (r ? [r] : []));
}

/** Splits [start, end) of a file into commented sections, as tour steps. */
function sectionHunks(path: string, start: number, end: number, removed = 0, removedLines?: string[]): Hunk[] {
  const parts = splitSections(lines(path), start, end);
  // Nothing but markers, blanks and braces: not worth a step, unless code was removed there.
  if (parts.length === 0) return removed > 0 ? [{ file: path, start, end, removed, removedLines }] : [];
  return parts.map(([s, e], i) =>
    i === 0 ? { file: path, start: s, end: e, removed, removedLines } : { file: path, start: s, end: e, removed: 0 },
  );
}

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// File tree -----------------------------------------------------------------

interface Dir {
  dirs: Map<string, Dir>;
  files: string[];
}

function buildTree(paths: string[]): Dir {
  const root: Dir = { dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      if (!dir.dirs.has(part)) dir.dirs.set(part, { dirs: new Map(), files: [] });
      dir = dir.dirs.get(part)!;
    }
    dir.files.push(path);
  }
  return root;
}

/** Counts of tour changes per file, shown as badges in the tree. */
let changeCounts = new Map<string, number>();

function renderTree(): void {
  const crate = current ? toCrateName(current.engine.name) : "engine";
  const list = el("ul", "tree-root");
  const header = el("li", "tree-dir open");
  header.append(el("span", "tree-label", `${crate}/`));
  list.append(header);

  const renderDir = (dir: Dir, prefix: string, depth: number, into: HTMLElement) => {
    const ul = el("ul");
    const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
    for (const name of [...dir.dirs.keys()].sort(byName)) {
      const key = `${prefix}${name}/`;
      const li = el("li", collapsed.has(key) ? "tree-dir" : "tree-dir open");
      const label = el("button", "tree-label", `${name}/`);
      label.type = "button";
      label.style.paddingLeft = `${depth * 14 + 8}px`;
      label.addEventListener("click", () => {
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        renderTree();
      });
      li.append(label);
      if (!collapsed.has(key)) renderDir(dir.dirs.get(name)!, key, depth + 1, li);
      ul.append(li);
    }
    for (const path of [...dir.files].sort((a, b) => byName(a.split("/").pop()!, b.split("/").pop()!))) {
      const li = el("li");
      const b = el("button", "tree-file");
      b.type = "button";
      b.style.paddingLeft = `${depth * 14 + 8}px`;
      b.dataset.path = path;
      b.append(el("span", "tree-name", path.split("/").pop()));
      if (ENGINE_FILES.has(path)) {
        b.classList.add("engine-file");
        b.title = "Your engine: built from your blocks";
      }
      const n = changeCounts.get(path);
      if (n) b.append(el("span", "tree-badge", `+${n}`));
      if (path === activeFile) b.setAttribute("aria-current", "true");
      if (editing?.drafts.has(path)) b.append(el("span", "tree-badge", "edited"));
      b.addEventListener("click", () => (editing ? editFile(path) : showFile(path)));
      li.append(b);
      ul.append(li);
    }
    into.append(ul);
  };
  renderDir(buildTree(files.map((f) => f.path)), "", 1, header);
  treeEl.replaceChildren(list);
}

// Code view -----------------------------------------------------------------

function lineClasses(path: string): string[] {
  const src = lines(path);
  const extra: string[] = new Array(src.length).fill("");
  const add = (i: number, cls: string) => {
    if (i >= 0 && i < extra.length) extra[i] = extra[i] ? `${extra[i]} ${cls}` : cls;
  };
  if (focusRegion) {
    lineRegions(src).forEach((r, i) => r === focusRegion && add(i, "focus"));
  }
  if (tour) {
    tour.hunks.forEach((h, k) => {
      if (h.file !== path) return;
      const now = k === tour!.index;
      if (h.end === h.start) add(h.start, now ? "removed-here current" : "removed-here");
      for (let i = h.start; i < h.end; i++) add(i, now ? "changed current" : "changed");
    });
  }
  return extra;
}

function showFile(path: string, scrollTo?: number): void {
  if (!files.some((f) => f.path === path)) path = "src/search.rs";
  activeFile = path;
  pathEl.textContent = path;
  const file = files.find((f) => f.path === path);
  if (!editing) editBtn.disabled = !editable(file);
  editBtn.title = editable(file)
    ? "Edit this file: code between // @block name and // @end name lines becomes blocks"
    : "This file is written from your settings and parameters";
  // During a tour, removed lines are shown in red above the code that replaced them.
  const removed = tour
    ? tour.hunks.flatMap((h, k) =>
        h.file === path && h.removedLines?.length ? [{ at: h.start, lines: h.removedLines, current: k === tour!.index }] : [],
      )
    : [];
  // Hooks: places where blocks can add code, shown between the lines.
  const ghosts = (file?.hooks ?? []).map((h) => ({
    at: h.at,
    text: h.text,
    title: `Hook "${h.name}": ${HOOKS[h.name]?.description ?? "added by one of your blocks."} Blocks add code here with // @hook ${h.name}, or type code below it in Edit code.`,
  }));
  codeEl.innerHTML = file ? renderCode(file.contents, lineClasses(path), removed, ghosts) : "";
  renderTree();
  if (scrollTo !== undefined) {
    const rows = codeEl.querySelectorAll<HTMLElement>(".ln:not(.removed):not(.hook)");
    const target = rows[Math.min(scrollTo, rows.length - 1)];
    // Show the removed lines above the change too, when there are any.
    let first: HTMLElement | undefined = target;
    while (first?.previousElementSibling?.classList.contains("removed")) first = first.previousElementSibling as HTMLElement;
    (first ?? target)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/** Highlights the code of the selected block, jumping to it if needed. */
function focusBlock(block: Blockly.Block | null): void {
  if (tour) return; // the tour owns the highlights while it runs
  const info = block ? infoForBlockType(block.type) : null;
  focusRegion = info?.key ?? null;
  if (!focusRegion) return showFile(activeFile);
  const firstLine = (path: string) => lineRegions(lines(path)).indexOf(focusRegion);
  const order = [activeFile, ...files.map((f) => f.path)];
  const path = order.find((p) => firstLine(p) >= 0);
  if (path) showFile(path, firstLine(path));
  else showFile(activeFile);
}

/** Double-click a line of code to edit the block it belongs to. */
codeEl.addEventListener("dblclick", (e) => {
  const row = (e.target as HTMLElement).closest(".ln");
  if (!row || row.classList.contains("removed")) return;
  if (row.classList.contains("hook")) {
    // A hook: start editing right there, to add code at that hook.
    const all = [...codeEl.querySelectorAll(".ln:not(.removed)")];
    window.getSelection()?.removeAllRanges();
    startEditing(all.indexOf(row) + 1);
    toast("Add your code below the hook line, between // @block name and // @end name, then Save as blocks.");
    return;
  }
  const rows = [...codeEl.querySelectorAll(".ln:not(.removed):not(.hook)")];
  const i = rows.indexOf(row);
  if (i < 0) return;
  window.getSelection()?.removeAllRanges();
  editLine(activeFile, i);
});

// Tour ----------------------------------------------------------------------

interface Tour {
  title: string;
  blocks: BlockInfo[];
  hunks: Hunk[];
  /** -1 is the introduction; 0.. are hunks. */
  index: number;
  mode: "added" | "explain";
}

let tour: Tour | null = null;

/** Your engine's files first, then the rest; top to bottom within a file. */
const TOUR_ORDER = ["src/search.rs", "src/eval.rs", "src/params.rs", "src/main.rs"];

function sortHunks(hunks: Hunk[]): Hunk[] {
  const rank = (p: string) => {
    const i = TOUR_ORDER.indexOf(p);
    return i >= 0 ? i : p.startsWith("src/") ? TOUR_ORDER.length : TOUR_ORDER.length + 1;
  };
  return hunks
    // Engine code only: workspace.json, the README and block files are bookkeeping.
    .filter((h) => h.file.endsWith(".rs") || h.file === "Cargo.toml")
    .filter((h) => !h.file.startsWith("blocks/"))
    .sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file) || a.start - b.start);
}

function startTour(t: Omit<Tour, "index">): void {
  tour = { ...t, index: -1 };
  changeCounts = new Map();
  for (const h of tour.hunks) changeCounts.set(h.file, (changeCounts.get(h.file) ?? 0) + 1);
  renderTour();
}

function endTour(message?: string): void {
  tour = null;
  changeCounts = new Map();
  tourEl.hidden = true;
  showFile(activeFile);
  if (message) toast(message);
}

function hunkText(h: Hunk): string {
  const src = lines(h.file);
  const own = explain(src, h.start, h.end) ?? describeCode(src, h.start, h.end);
  if (own) return own;
  if (h.file === "src/params.rs") return "The block's parameters as constants. Change them to tune the engine.";
  // Lines inside a region are explained by the comment at the top of that region.
  const regions = lineRegions(src);
  const region = regions[h.start];
  if (region) {
    let top = h.start;
    while (top > 0 && regions[top - 1] === region && !/\/\/ @block /.test(src[top]!)) top--;
    const above = explain(src, top, h.start);
    const info = infoForKey(region);
    if (above) return above;
    if (info) return `Part of ${info.label}.`;
  }
  if (h.file === "src/main.rs") return "Registers the module so the rest of the engine can use it.";
  return tour && tour.mode === "explain" ? `Part of ${tour.title}.` : "Changed by this block.";
}

function renderTour(): void {
  if (!tour) return;
  const t = tour;
  tourEl.hidden = false;
  tourEl.style.setProperty("--tour-colour", t.blocks[0]?.colour ?? COLOURS.skeleton);
  const card = el("div", "tour-card");
  const head = el("div", "tour-head");
  head.append(el("strong", "tour-title", t.title));
  const close = el("button", "tour-x", "×");
  close.type = "button";
  close.title = "Skip (Esc)";
  close.setAttribute("aria-label", "Skip the tour");
  close.addEventListener("click", () => endTour());
  head.append(close);
  card.append(head);

  const fileCount = new Set(t.hunks.map((h) => h.file)).size;
  const nav = el("div", "tour-nav");
  const btn = (label: string, cls: string, fn: () => void, disabled = false) => {
    const b = el("button", `btn ${cls}`, label);
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", fn);
    nav.append(b);
    return b;
  };

  if (t.index === -1) {
    for (const info of t.blocks) {
      const p = el("p", "tour-info");
      if (t.blocks.length > 1) p.append(el("strong", undefined, `${info.label}: `));
      p.append(info.info, " ");
      const a = el("a", undefined, "Chess Programming Wiki");
      a.href = info.cpw;
      a.target = "_blank";
      a.rel = "noopener";
      p.append(a);
      card.append(p);
    }
    const summary =
      t.hunks.length === 0
        ? t.mode === "explain"
          ? "This block has no code of its own here yet. Attach it to the engine to see it."
          : "No code changed."
        : t.mode === "added"
          ? `It changed ${t.hunks.length} ${t.hunks.length === 1 ? "place" : "places"} in ${fileCount} ${fileCount === 1 ? "file" : "files"}.`
          : `Its code has ${t.hunks.length} ${t.hunks.length === 1 ? "part" : "parts"} in ${fileCount} ${fileCount === 1 ? "file" : "files"}. Each is explained in turn.`;
    card.append(el("p", "tour-step", summary));
    if (t.hunks.length) btn("Walk through the code", "primary", () => go(0));
    btn(t.hunks.length ? "Skip" : "Close", "", () => endTour());
  } else {
    const h = t.hunks[t.index]!;
    const where = el("p", "tour-step");
    const noun = t.mode === "added" ? "Change" : "Part";
    where.append(`${noun} ${t.index + 1} of ${t.hunks.length} · `, el("code", undefined, `${h.file}:${h.start + 1}`));
    card.append(where);
    card.append(el("p", "tour-why", hunkText(h)));
    if (h.removed > 0) {
      card.append(
        el(
          "p",
          "tour-note",
          h.end > h.start
            ? `Replaces ${h.removed} old ${h.removed === 1 ? "line" : "lines"}, shown in red above it.`
            : `${h.removed} ${h.removed === 1 ? "line was" : "lines were"} removed here, shown in red.`,
        ),
      );
    }
    btn("Back", "", () => go(t.index - 1));
    const last = t.index === t.hunks.length - 1;
    btn(last ? "Done" : "Next", "primary", () => (last ? endTour("Nice, you've seen every change.") : go(t.index + 1)));
    btn("Skip", "", () => endTour());
  }
  card.append(nav);
  tourEl.replaceChildren(card);
  (nav.querySelector(".primary") as HTMLButtonElement | null)?.focus({ preventScroll: true });

  if (t.index >= 0) {
    const h = t.hunks[t.index]!;
    showFile(h.file, h.start);
  } else {
    showFile(t.hunks[0]?.file ?? activeFile, t.hunks[0]?.start);
  }
}

function go(index: number): void {
  if (!tour) return;
  tour.index = Math.max(-1, Math.min(index, tour.hunks.length - 1));
  renderTour();
}

document.addEventListener("keydown", (e) => {
  if (!tour || (e.target as HTMLElement).closest("input, select, textarea, .blocklyWidgetDiv")) return;
  if (e.key === "Escape") endTour();
  else if (e.key === "ArrowRight" && tour.index < tour.hunks.length - 1) go(tour.index + 1);
  else if (e.key === "ArrowLeft" && tour.index > -1) go(tour.index - 1);
  else return;
  e.preventDefault();
});

/** Files whose skeleton code a skeleton block explains. */
const SKELETON_FILES: Record<string, string[]> = {
  negamax: ["src/search.rs"],
  hce: ["src/eval.rs"],
  engine: ["src/main.rs", "src/uci.rs", "src/position.rs", "src/time.rs", "src/moves.rs", "src/score.rs", "src/bench.rs"],
};

/** Tour of a block's current code, section by section (right-click > Explain this block). */
function explainBlock(block: Blockly.Block): void {
  const info = infoForBlockType(block.type);
  if (!info) return;
  const skeleton = SKELETON_FILES[info.key];
  // Skeleton blocks own the lines no feature block claims; fallback lines of a
  // missing block (`!x`) are skeleton too. Basic time also owns the fallback of
  // the soft/hard block.
  // The innermost region decides: code of a block nested in another belongs to the inner one.
  const mine = (owners: string[]) => {
    const inner = owners.filter((o) => !o.startsWith("!")).at(-1);
    if (skeleton) return inner === undefined;
    if (inner?.split("|").includes(info.key)) return true;
    return info.key === "basic_time" && inner === undefined && owners.includes("!time_management");
  };
  const hunks: Hunk[] = [];
  for (const path of skeleton ?? files.map((f) => f.path)) {
    if (path === "workspace.json") continue;
    const owners = ownersOf(path);
    let start = -1;
    owners.forEach((o, i) => {
      if (mine(o) && start < 0) start = i;
      if (!mine(o) && start >= 0) {
        hunks.push(...sectionHunks(path, start, i));
        start = -1;
      }
    });
    if (start >= 0) hunks.push(...sectionHunks(path, start, owners.length));
  }
  const attached = block.isEnabled() && block.getRootBlock().type === ENGINE;
  // Skeleton tours follow the files in reading order; block tours start with your engine files.
  const ordered = skeleton ? hunks.filter((h) => h.file !== "workspace.json") : sortHunks(hunks);
  startTour({ title: info.label, blocks: [info], hunks: attached ? ordered : [], mode: "explain" });
}

// Status and regeneration ---------------------------------------------------

function renderIssues(issues: Issue[]): void {
  issuesEl.replaceChildren();
  if (!issues.some((i) => i.level === "error")) {
    issuesEl.append(
      el("li", "ok", current ? `Ready: ${current.engine.name} compiles as the ${toCrateName(current.engine.name)} Cargo project.` : "Ready."),
    );
  }
  for (const issue of issues) issuesEl.append(el("li", issue.level, issue.message));
}

let lastKeys = new Set<string>();
let suppressTour = true;
/** Set when a block was just saved: the next refresh tours its changes. */
let pendingTour: { title: string; keys: string[] } | null = null;

const MARKERISH = /^\s*(\/\/ @(block|end|else)\b.*)?$/;

/** Diff hunks that change more than markers and blank lines (a fork renames markers only). */
function meaningful(h: Hunk): boolean {
  const code = (ls: string[]) => ls.filter((l) => !MARKERISH.test(l)).join("\n");
  return code(lines(h.file).slice(h.start, h.end)) !== code(h.removedLines ?? []);
}

function changeHunks(before: GeneratedFile[]): Hunk[] {
  const old = new Map(before.map((f) => [f.path, f.contents.replace(/\n$/, "").split("\n")]));
  return files
    .flatMap((f) => diffLines(f.path, old.get(f.path) ?? [], f.contents.replace(/\n$/, "").split("\n")))
    .filter((h) => !h.file.startsWith("blocks/"))
    .filter(meaningful)
    .flatMap((h) => (h.end > h.start ? sectionHunks(h.file, h.start, h.end, h.removed, h.removedLines) : [h]));
}

function refresh(): void {
  const { workspace, problems } = readWorkspace(bw, sourceOf);
  current = workspace;
  if (workspace) {
    // The project's blocks are the ones placed in it.
    const placed = workspace.customBlocks ?? {};
    if (JSON.stringify(placed) !== JSON.stringify(project)) {
      setProject(placed);
      updateCustomBlocks();
    }
  }
  const issues: Issue[] = problems.map((message) => ({ level: "error", message }));
  if (workspace) issues.push(...validate(workspace));
  const blocking = issues.some((i) => i.level === "error");

  const before = files;
  if (workspace && !blocking) {
    try {
      files = generateProject(workspace);
    } catch (err) {
      if (!(err instanceof GenerateError)) throw err;
    }
  }
  codeEl.classList.toggle("stale", blocking);
  exportBtn.disabled = blocking;
  renderIssues(issues);

  if (pendingTour) {
    const p = pendingTour;
    pendingTour = null;
    lastKeys = placedKeys(workspace);
    if (!blocking) {
      const hunks = sortHunks(changeHunks(before));
      const infos = p.keys.map(infoForKey).filter((i): i is BlockInfo => !!i);
      if (hunks.length && infos.length) {
        startTour({ title: p.title, blocks: infos, hunks, mode: "added" });
        return;
      }
      if (tour) endTour();
      toast(hunks.length ? p.title : `${p.title}. The generated code did not change.`);
    }
    showFile(activeFile);
    return;
  }

  if (!blocking && files !== before) {
    const keys = placedKeys(workspace);
    const added = [...keys].filter((k) => !lastKeys.has(k)).map(infoForKey).filter((i): i is BlockInfo => !!i);
    const removed = [...lastKeys].filter((k) => !keys.has(k)).map(infoForKey).filter((i): i is BlockInfo => !!i);
    lastKeys = keys;

    if (!suppressTour && added.length > 0) {
      const hunks = changeHunks(before);
      const title = added.length === 1 ? `${added[0]!.label} added` : `${added.length} blocks added`;
      startTour({ title, blocks: added, hunks: sortHunks(hunks), mode: "added" });
      return;
    }
    if (tour) endTour(); // line numbers moved; the tour no longer matches the code
    if (!suppressTour && removed.length > 0) {
      const names = removed.map((r) => r.label).join(", ");
      toast(`${names} removed, with all ${removed.length === 1 ? "its" : "their"} code.`);
    }
  }
  showFile(activeFile);
}

let timer: number | undefined;
function scheduleRefresh(): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    refresh();
    save();
  }, 120);
}

bw.addChangeListener((e: Blockly.Events.Abstract) => {
  if (e.type === Blockly.Events.SELECTED) {
    const id = (e as Blockly.Events.Selected).newElementId;
    focusBlock(id ? bw.getBlockById(id) : null);
    return;
  }
  if (!e.isUiEvent) scheduleRefresh();
});

// Custom blocks ---------------------------------------------------------------

setCustomLookup((id) => {
  const src = sourceOf(id);
  return src === undefined ? null : parseBlock(src).block;
});

let toolboxSignature = "";

/** Defines every known custom block type and refreshes the My blocks category. */
function updateCustomBlocks(): void {
  const entries: ToolboxCustom[] = [];
  const add = (id: string, group: ToolboxCustom["group"]) => {
    const block = parseBlock(sourceOf(id) ?? "").block;
    if (!block?.id || block.id !== id) return;
    const type = defineCustomBlock(block);
    (bw.options.maxInstances ??= {})[type] = 1;
    entries.push({ id, group });
  };
  for (const id of Object.keys(project)) add(id, "project");
  for (const id of Object.keys(library)) if (!(id in project)) add(id, "library");
  for (const id of Object.keys(EXAMPLE_BLOCKS)) if (!(id in project) && !(id in library)) add(id, "example");
  const signature = JSON.stringify(entries) + JSON.stringify(entries.map((e) => sourceOf(e.id)));
  if (signature !== toolboxSignature) {
    toolboxSignature = signature;
    bw.updateToolbox(toolbox(entries));
  }
}

type State = Blockly.serialization.blocks.State;

/** Visits every block state in a saved workspace. */
function walk(state: State, fn: (b: State) => void): void {
  fn(state);
  for (const input of Object.values(state.inputs ?? {})) if (input.block) walk(input.block, fn);
  if (state.next?.block) walk(state.next.block, fn);
}

/** Saves the workspace, lets `edit` change the saved state, and loads it again. */
function rebuild(edit: (blocks: State[]) => void): void {
  const saved = Blockly.serialization.workspaces.save(bw) as { blocks?: { blocks: State[] } };
  const blocks = saved.blocks?.blocks ?? [];
  edit(blocks);
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(saved, bw);
  } finally {
    Blockly.Events.enable();
  }
}

/** Field values of a built-in block renamed to the matching parameters of its version. */
function mapFields(fields: Record<string, unknown> | undefined, from: ParamSpec[], to: ParamSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of from) {
    const q = to.find((t) => t.rust === p.rust && t.type === p.type);
    if (!q) continue;
    const a = fieldNames(p);
    const b = fieldNames(q);
    a.forEach((name, i) => {
      if (fields?.[name] !== undefined) out[b[i]!] = fields[name];
    });
  }
  return out;
}

/** The statement input a block in `slot` goes into, as [skeleton type, input name]. */
function inputFor(slot: CustomSlot): [string, string] {
  return slot === "eval" ? [HCE, "TERMS"] : [NEGAMAX, SLOT_INPUT[slot]];
}

/** Appends a new block state at the end of the slot's stack. Returns false without an engine. */
function appendToSlot(blocks: State[], slot: CustomSlot, block: State): boolean {
  const [skeleton, input] = inputFor(slot);
  let done = false;
  for (const root of blocks) {
    if (root.type !== ENGINE) continue;
    walk(root, (b) => {
      if (done || b.type !== skeleton) return;
      b.inputs ??= {};
      if (!b.inputs[input]?.block) b.inputs[input] = { block };
      else {
        let last = b.inputs[input].block!;
        while (last.next?.block) last = last.next.block;
        last.next = { block };
      }
      done = true;
    });
    if (done) break;
  }
  return done;
}

interface SaveContext {
  /** The id the block had when the editor opened (null for new blocks and new versions). */
  originalId: string | null;
  /** Blockly id of the built-in block this new version replaces. */
  replaces?: string;
  /** Put the block into the engine after saving (new blocks). */
  place?: boolean;
}

/** Saves an edited block file into My blocks and the project, then updates the workspace. */
function saveBlockSource(src: string, ctx: SaveContext): string | null {
  const { block, diagnostics } = parseBlock(src);
  const error = diagnostics.find((d) => d.level === "error");
  if (!block || error) return error?.message ?? "This block file cannot be read.";
  const id = block.id;
  if (id !== ctx.originalId && allIds().includes(id)) {
    return `A block with id "${id}" already exists in My blocks. Change the id on line 2, or edit that block instead.`;
  }
  library[id] = src;
  saveLibrary();
  const inProject = ctx.replaces || ctx.place || (ctx.originalId !== null && ctx.originalId in project);
  if (inProject) setProject({ ...project, [id]: src });
  updateCustomBlocks();

  const type = customType(id);
  let placed = true;
  rebuild((blocks) => {
    for (const root of blocks) {
      walk(root, (b) => {
        // A built-in block becomes your version of it, keeping its values.
        if (ctx.replaces && b.id === ctx.replaces) {
          const base = builtinOf({ type: b.type } as Blockly.Block);
          const spec = base ? (searchSpec(base) ?? evalSpec(base)) : undefined;
          b.fields = mapFields(b.fields, spec?.params ?? [], block.params) as State["fields"];
          b.type = type;
        }
        // A changed id renames every use.
        if (ctx.originalId && ctx.originalId !== id && b.type === customType(ctx.originalId)) b.type = type;
        // Fields of removed parameters would make Blockly complain.
        if (b.type === type && b.fields) {
          const keep = new Set(block.params.flatMap(fieldNames));
          for (const f of Object.keys(b.fields)) if (!keep.has(f)) delete b.fields[f];
        }
      });
    }
    if (ctx.place) placed = appendToSlot(blocks, block.slot, { type });
  });
  pendingTour = { title: ctx.replaces ? `${block.label} saved` : ctx.place ? `${block.label} added` : `${block.label} saved`, keys: [id] };
  refresh();
  save();
  if (!placed) toast(`Saved to My blocks. Drag ${block.label} from My blocks into your engine.`);
  return null;
}

/** The checks shown in the block editor: structure, placement and a Rust syntax check. */
function checkBlockSource(src: string, originalId: string | null): Diagnostic[] {
  const { block, diagnostics } = parseBlock(src);
  const out = [...diagnostics];
  if (!block || out.some((d) => d.level === "error")) return out;
  if (block.id !== originalId && allIds().includes(block.id)) {
    out.push({ level: "error", line: 2, message: `A block with id "${block.id}" already exists in My blocks; pick another id.` });
    return out;
  }
  // Try the block in (a copy of) the current engine.
  const ws = structuredClone(current ?? starterWorkspace()) as Workspace;
  ws.customBlocks = { ...ws.customBlocks, [block.id]: src };
  const lists = [...Object.values(ws.search.slots), ws.eval.terms];
  let found = false;
  for (const list of lists) {
    for (const b of list) {
      if (b.type === block.id || (originalId && b.type === originalId) || (block.base && b.type === block.base)) {
        if (originalId && originalId !== block.id) delete ws.customBlocks[originalId];
        b.type = block.id;
        found = true;
      }
    }
  }
  if (!found) (block.slot === "eval" ? ws.eval.terms : ws.search.slots[block.slot]).push({ type: block.id, params: {} });
  const issues = validate(ws).filter((i) => i.level === "error");
  if (issues.length) {
    for (const i of issues) out.push({ level: "warning", line: 0, message: `In this engine: ${i.message}` });
    return out;
  }
  const srcLines = src.split("\n");
  const lineInBlock = (text: string) => {
    const t = text.trim();
    const k = t ? srcLines.findIndex((l) => l.trim() === t) : -1;
    return k >= 0 ? k + 1 : 0;
  };
  try {
    for (const f of generateProject(ws)) {
      if (!f.path.endsWith(".rs") || f.path.startsWith("blocks/")) continue;
      for (const p of rustSyntaxErrors(f.contents, 3)) {
        out.push({
          level: "warning",
          line: lineInBlock(p.text),
          message: `Rust syntax error in ${f.path} line ${p.line + 1}: ${p.text.trim() || "(blank line)"}`,
        });
      }
    }
  } catch (err) {
    out.push({ level: "warning", line: 0, message: err instanceof Error ? err.message : String(err) });
  }
  return out;
}

function openEditorFor(src: string, ctx: SaveContext, subtitle: string, line?: number): void {
  const label = parseBlock(src).block?.label ?? "block";
  openBlockEditor({
    title: ctx.originalId || ctx.replaces ? `Edit block: ${label}` : `New block: ${label}`,
    subtitle,
    source: src,
    line,
    check: (s) => checkBlockSource(s, ctx.originalId),
    params: projectParams,
    save: (s) => saveBlockSource(s, ctx),
    exportFile: (s) => download(`${parseBlock(s).block?.id || "block"}.block.rs`, s, "text/plain"),
  });
}

/** Edit this block: custom blocks open as they are; built-in blocks are forked first. */
function editBlock(block: Blockly.Block, line?: number): void {
  const id = customIdOf(block);
  if (id) return editCustom(id, line);
  const base = builtinOf(block);
  const spec = base ? (searchSpec(base) ?? evalSpec(base)) : undefined;
  if (!base || !spec) return;
  if (block.isInFlyout) {
    return toast(`Drag ${spec.label} into your engine first, then edit it there.`);
  }
  const newId = freeId(`my_${base}`, allIds());
  openEditorFor(
    forkBlock(base, newId),
    { originalId: null, replaces: block.id },
    `Your own version of ${spec.label}. Saving replaces the block in your engine and keeps it in My blocks.`,
    line,
  );
}

function editCustom(id: string, line?: number): void {
  const src = sourceOf(id);
  if (src === undefined) return toast(`The block "${id}" is not available.`);
  openEditorFor(src, { originalId: id }, `${id}.block.rs · saved in My blocks${id in project ? " and in this project" : ""}`, line);
}

function createNewBlock(label: string, slot: CustomSlot): void {
  const id = freeId(label, allIds());
  openEditorFor(newBlockSource(id, label, slot), { originalId: null, place: true }, `${id}.block.rs · a new block`);
}

/** Double-click on a line of generated code. */
function editLine(path: string, i: number): void {
  const text = lines(path)[i] ?? "";
  if (path.startsWith("blocks/")) {
    return editCustom(path.slice("blocks/".length).replace(/\.block\.rs$/, ""), i + 1);
  }
  const owners = ownersOf(path)[i] ?? [];
  const inner = owners.filter((o) => !o.startsWith("!")).at(-1);
  const names = inner?.split("|") ?? [];
  // The block's own text, to put the cursor on the same line in the editor.
  const lineIn = (src: string | undefined) => {
    const k = src?.split("\n").findIndex((l) => l.trim() !== "" && l.trim() === text.trim()) ?? -1;
    return k >= 0 ? k + 1 : undefined;
  };
  const custom = names.find((n) => sourceOf(n) !== undefined && !searchSpec(n));
  if (custom) return editCustom(custom, lineIn(sourceOf(custom)));
  if (names.length > 1) {
    const labels = names.map((n) => infoForKey(n)?.label ?? n).join(", ");
    return toast(`Shared code: generated when any of these is placed: ${labels}.`);
  }
  if (names.length === 1) {
    const key = names[0]!;
    const base = key.startsWith("eval_") ? key.slice(5) : key;
    const info = infoForKey(key);
    const block = bw.getAllBlocks(false).find((b) => builtinOf(b) === base && b.isEnabled());
    if (!block || !info) return toast("This code belongs to a setting block; it cannot be edited as a block yet.");
    if (window.confirm(`This line belongs to ${info.label}, a built-in block. Make your own version of it to edit this code?`)) {
      editBlock(block, lineIn(forkBlock(base, "x")));
    }
    return;
  }
  // Skeleton code: edit the file right there; code wrapped in block markers becomes a block.
  const file = files.find((f) => f.path === path);
  if (!editable(file)) return toast("This file is written from your settings and parameters; it can't be edited here.");
  const hooksBefore = (file!.hooks ?? []).filter((h) => h.at <= i).length;
  startEditing(i + hooksBefore + 1);
  toast("Type your code below this line between // @block name and // @end name, then Save as blocks.");
}

/** Adds a block file to My blocks (Open or Import). */
function importBlockFile(name: string, text: string): void {
  const { block, diagnostics } = parseBlock(text);
  const error = diagnostics.find((d) => d.level === "error");
  if (!block || error) return toast(`${name}: ${error ? `line ${error.line}: ${error.message}` : "not a block file."}`);
  if (library[block.id] !== undefined && library[block.id] !== text) {
    if (!window.confirm(`My blocks already has a block "${block.id}". Replace it with ${name}?`)) return;
  }
  library[block.id] = text;
  saveLibrary();
  if (block.id in project) setProject({ ...project, [block.id]: text });
  updateCustomBlocks();
  refresh();
  toast(`${block.label} is now in My blocks`);
}

// Editing code ----------------------------------------------------------------

/** Every parameter constant of the project (params.rs), for completion. */
function projectParams(): { name: string; type: string }[] {
  const src = files.find((f) => f.path === "src/params.rs")?.contents ?? "";
  return [...src.matchAll(/pub const ([A-Z][A-Z0-9_]*): ([^=]+?) =/g)].map((m) => ({ name: m[1]!, type: m[2]! }));
}

const editorEl = $("code-editor");
const codeErrorsEl = $<HTMLUListElement>("code-errors");
const codeHintEl = $("code-hint");
const editBtn = $<HTMLButtonElement>("edit-code");
const saveCodeBtn = $<HTMLButtonElement>("save-code");
const cancelCodeBtn = $<HTMLButtonElement>("cancel-code");
const formatCodeBtn = $<HTMLButtonElement>("format-code");
const HINT = "Double-click a line to edit its block";
const EDIT_HINT = "New code goes between // @block name and // @end name";

interface Editing {
  /** The project as it was when editing started. */
  ws: Workspace;
  files: GeneratedFile[];
  /** Edited text per file, hook lines included. */
  drafts: Map<string, string>;
  path: string;
  editor: CodeEditor;
}

let editing: Editing | null = null;

/** Files whose code can be edited here: templates and files blocks add. */
const editable = (f: GeneratedFile | undefined) => !!f?.origins;
const viewText = (f: GeneratedFile) => viewOf(f).lines.join("\n");

function startEditing(line?: number): void {
  const file = files.find((f) => f.path === activeFile);
  if (!current || !editable(file)) {
    return toast(`${activeFile} is written from your settings and parameters; it can't be edited here.`);
  }
  if (codeEl.classList.contains("stale")) return toast("Fix the problems under Status first.");
  if (tour) endTour();
  const snapshotFiles = files;
  editorEl.hidden = false;
  codeEl.hidden = true;
  const editor = createCodeEditor(editorEl, viewText(file!), saveCode, projectParams, line);
  editing = { ws: structuredClone(current), files: snapshotFiles, drafts: new Map(), path: activeFile, editor };
  editBtn.hidden = true;
  saveCodeBtn.hidden = false;
  cancelCodeBtn.hidden = false;
  formatCodeBtn.hidden = false;
  codeHintEl.textContent = EDIT_HINT;
  codeHintEl.classList.add("editing");
  renderTree();
}

/** Keeps the current file's text and opens another file in the editor. */
function stash(): void {
  if (!editing) return;
  const file = editing.files.find((f) => f.path === editing!.path)!;
  const text = editing.editor.text();
  if (text.replace(/\s+$/, "") !== viewText(file).replace(/\s+$/, "")) editing.drafts.set(editing.path, text);
  else editing.drafts.delete(editing.path);
}

function editFile(path: string, line?: number): void {
  if (!editing) return showFile(path);
  const file = editing.files.find((f) => f.path === path);
  if (!editable(file)) return toast(`${path} is written from your settings and parameters; it can't be edited here.`);
  stash();
  editing.path = path;
  activeFile = path;
  pathEl.textContent = path;
  editing.editor.setText(editing.drafts.get(path) ?? viewText(file!), line);
  renderTree();
}

function stopEditing(): void {
  if (!editing) return;
  editing.editor.destroy();
  editing = null;
  editorEl.hidden = true;
  editorEl.replaceChildren();
  codeEl.hidden = false;
  codeErrorsEl.hidden = true;
  editBtn.hidden = false;
  saveCodeBtn.hidden = true;
  cancelCodeBtn.hidden = true;
  formatCodeBtn.hidden = true;
  codeHintEl.textContent = HINT;
  codeHintEl.classList.remove("editing");
  showFile(activeFile);
}

function showCodeErrors(errors: { path: string; line: number; message: string }[]): void {
  codeErrorsEl.replaceChildren();
  const close = el("button", "code-errors-x", "×");
  close.type = "button";
  close.title = "Close";
  close.setAttribute("aria-label", "Close the error list");
  close.addEventListener("click", () => (codeErrorsEl.hidden = true));
  codeErrorsEl.append(close);
  for (const e of errors) {
    const li = el("li");
    li.append(el("code", undefined, `${e.path}${e.line ? `:${e.line}` : ""}`), ` ${e.message}`);
    li.addEventListener("click", () => {
      if (e.path.startsWith("blocks/")) return;
      if (editing && e.path !== editing.path) editFile(e.path, e.line);
      else editing?.editor.goToLine(e.line);
    });
    codeErrorsEl.append(li);
  }
  codeErrorsEl.hidden = errors.length === 0;
}

/** Save as blocks: the edits become block files, placed in the engine. */
function saveCode(): void {
  if (!editing) return;
  stash();
  const ed = editing;
  if (ed.drafts.size === 0) {
    stopEditing();
    return toast("Nothing changed.");
  }
  // Blocks changed on the canvas while editing: the edited files no longer match.
  const changed = [...ed.drafts.keys()].some(
    (p) => ed.files.find((f) => f.path === p)?.contents !== files.find((f) => f.path === p)?.contents,
  );
  if (changed) {
    return showCodeErrors([{ path: ed.path, line: 0, message: "Your blocks changed while you were editing. Copy your code, cancel, and edit again." }]);
  }
  const taken = allIds().filter((id) => !(id in project));
  const r = codeToBlocks(ed.ws, ed.files, [...ed.drafts].map(([path, text]) => ({ path, text })), taken);
  if (r.errors.length) return showCodeErrors(r.errors);

  stopEditing();
  applyCodeResult(r, "Code saved as blocks");
}

/** Puts the blocks made from edited code into My blocks, the project and the canvas. */
function applyCodeResult(r: CodeResult, title: string): void {
  for (const [id, src] of Object.entries(r.sources)) library[id] = src;
  saveLibrary();
  setProject({ ...project, ...r.sources });
  updateCustomBlocks();
  const blocksBySlot = new Map(r.created.map((c) => [c.id, c.slot]));
  let unplaced = 0;
  rebuild((blocks) => {
    for (const root of blocks) {
      walk(root, (b) => {
        const fork = r.forks.find((f) => builtinOf({ type: b.type } as Blockly.Block) === f.base);
        if (!fork) return;
        const spec = searchSpec(fork.base) ?? evalSpec(fork.base);
        const block = parseBlock(r.sources[fork.id]!).block!;
        b.fields = mapFields(b.fields, spec?.params ?? [], block.params) as State["fields"];
        b.type = customType(fork.id);
      });
    }
    for (const [id, slot] of blocksBySlot) if (!appendToSlot(blocks, slot, { type: customType(id) })) unplaced++;
  });
  const names = [
    ...r.created.map((c) => `${c.id} (new, in ${c.slot})`),
    ...r.forks.map((f) => `${f.id} (your version of ${f.base})`),
    ...Object.keys(r.sources).filter((id) => !blocksBySlot.has(id) && !r.forks.some((f) => f.id === id)),
  ];
  pendingTour = { title, keys: Object.keys(r.sources) };
  refresh();
  save();
  const params = r.created.some((c) => parseBlock(r.sources[c.id]!).block?.params.length);
  toast(
    `Saved: ${names.join(", ")}.${params ? " New parameters start at 1: set them on the block." : ""}${unplaced ? " Drag new blocks from My blocks into your engine." : ""}`,
  );
}

editBtn.addEventListener("click", () => startEditing());
saveCodeBtn.addEventListener("click", saveCode);
formatCodeBtn.addEventListener("click", () => editing?.editor.format());
cancelCodeBtn.addEventListener("click", () => {
  stash();
  if (editing?.drafts.size && !window.confirm("Throw away your code changes?")) return;
  stopEditing();
});

// Linked folder -----------------------------------------------------------------

const linkBtn = $<HTMLButtonElement>("link-folder");
const folderStatusEl = $("folder-status");
let folder: FolderSync | null = null;

function folderStatus(text: string, level: "ok" | "busy" | "error"): void {
  folderStatusEl.hidden = false;
  folderStatusEl.textContent = text;
  folderStatusEl.className = `folder-status ${level}`;
}

async function linkFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  folder?.stop();
  folder = new FolderSync(handle, {
    files: () => (codeEl.classList.contains("stale") ? null : files),
    applyCode: (edits, base) => {
      if (!current) return [{ path: edits[0]!.path, line: 0, message: "Add an Engine block first." }];
      const stale = edits.some((e) => base.find((f) => f.path === e.path)?.contents !== files.find((f) => f.path === e.path)?.contents);
      if (stale) return [{ path: edits[0]!.path, line: 0, message: "Your blocks changed in the app at the same time; save the file again." }];
      const taken = allIds().filter((id) => !(id in project));
      const r = codeToBlocks(structuredClone(current), base, edits, taken);
      if (r.errors.length) return r.errors;
      applyCodeResult(r, `Changes from ${edits.map((e) => e.path).join(", ")}`);
      return [];
    },
    applyBlockFile: (id, text) => saveBlockSource(text, { originalId: id }),
    status: folderStatus,
    errors: (list) => (list.length ? showCodeErrors(list) : (codeErrorsEl.hidden = true)),
  });
  await folder.writeOut();
  folder.start();
  await rememberFolder(handle);
  linkBtn.textContent = "Unlink folder";
  linkBtn.title = `Stop syncing with ${handle.name}`;
  toast(`Linked to ${handle.name}: open that folder in VS Code. Saved edits come back here as blocks.`);
}

function unlinkFolder(): void {
  folder?.stop();
  folder = null;
  void rememberFolder(null);
  folderStatusEl.hidden = true;
  linkBtn.textContent = "Link folder";
  linkBtn.title = "Write the project into a folder on your computer and keep it in sync, to edit it in VS Code or any editor";
}

type PickerWindow = Window & { showDirectoryPicker(o?: { mode?: string; id?: string }): Promise<FileSystemDirectoryHandle> };
type PermissionHandle = FileSystemDirectoryHandle & { requestPermission(o: { mode: string }): Promise<PermissionState> };

if (canLinkFolders()) {
  linkBtn.hidden = false;
  let remembered: FileSystemDirectoryHandle | null = null;
  void rememberedFolder().then((h) => {
    if (h && !folder) {
      remembered = h;
      linkBtn.textContent = `Reconnect ${h.name}`;
    }
  });
  linkBtn.addEventListener("click", async () => {
    if (folder) {
      if (window.confirm(`Stop syncing with ${folder.name}? The files stay where they are.`)) unlinkFolder();
      return;
    }
    try {
      if (remembered) {
        const h = remembered as PermissionHandle;
        remembered = null;
        if ((await h.requestPermission({ mode: "readwrite" })) === "granted") return void (await linkFolder(h));
      }
      const handle = await (window as unknown as PickerWindow).showDirectoryPicker({ mode: "readwrite", id: "cfs-project" });
      let hasWorkspace = false;
      let empty = true;
      for await (const name of (handle as unknown as { keys(): AsyncIterable<string> }).keys()) {
        empty = false;
        if (name === "workspace.json") hasWorkspace = true;
      }
      if (!empty && !hasWorkspace && !window.confirm(`${handle.name} is not empty. Write the project into it? Files with the same names are replaced.`)) return;
      await linkFolder(handle);
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast(err instanceof Error ? err.message : "Could not link the folder.");
    }
  });
}

// For automated tests: link a folder handle without the picker (e.g. the origin private file system).
Object.assign(window, { __cfsLinkFolder: (h: FileSystemDirectoryHandle) => linkFolder(h) });

// Persistence ---------------------------------------------------------------

function save(): void {
  void folder?.writeOut();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Blockly.serialization.workspaces.save(bw)));
  } catch {
    // Storage can be unavailable (private mode); autosave is a convenience.
  }
}

function restore(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    Blockly.serialization.workspaces.load(JSON.parse(raw), bw);
    return bw.getBlocksByType(ENGINE, false).length > 0;
  } catch {
    return false;
  }
}

/** Scrolls so the engine block's top-left corner is in view. */
function showEngineTop(): void {
  const engine = bw.getBlocksByType(ENGINE, false)[0] as Blockly.BlockSvg | undefined;
  if (!engine) return;
  const r = engine.getBoundingRectangle();
  bw.scrollBoundsIntoView(new Blockly.utils.Rect(r.top - 24, r.top + 160, r.left - 24, r.left + 240));
}

/** Replaces the workspace without starting a tour. */
function load(ws: Workspace): void {
  if (tour) endTour();
  suppressTour = true;
  loadWorkspace(bw, ws);
  showEngineTop();
  refresh();
  save();
  suppressTour = false;
}

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Actions -------------------------------------------------------------------

const TEMPLATES: Record<string, () => Workspace> = {
  starter: starterWorkspace,
  reference: referenceWorkspace,
  empty: () => emptyWorkspace(),
};

$<HTMLSelectElement>("template").addEventListener("change", (e) => {
  const select = e.target as HTMLSelectElement;
  const make = TEMPLATES[select.value];
  select.value = "";
  if (!make) return;
  if (bw.getAllBlocks(false).length > 0 && !window.confirm("Replace the current workspace?")) return;
  setProject({});
  load(make());
  toast("New engine created");
});

$("open").addEventListener("click", () => fileInput.click());

/** Reads a `.cfs` project bundle: workspace.json plus blocks/*.block.rs. */
function readBundle(data: Uint8Array): Workspace {
  const entries = unzipSync(data);
  const strip = (p: string) => p.replace(/^[^/]+\/(?=workspace\.json$|blocks\/)/, "");
  const files = new Map(Object.entries(entries).map(([p, d]) => [strip(p), d]));
  const json = files.get("workspace.json");
  if (!json) throw new Error("This bundle has no workspace.json.");
  const ws = parseWorkspaceFile(strFromU8(json));
  // Block files in blocks/ win: they may have been edited outside the app.
  for (const [p, d] of files) {
    const m = /^blocks\/([a-z][a-z0-9_]*)\.block\.rs$/.exec(p);
    if (m) ws.customBlocks![m[1]!] = strFromU8(d);
  }
  return ws;
}

/** Opens a workspace: its blocks join the project, and My blocks when new there. */
function openWorkspace(ws: Workspace, name: string): void {
  let added = 0;
  for (const [id, src] of Object.entries(ws.customBlocks ?? {})) {
    if (library[id] === undefined) {
      library[id] = src;
      added++;
    }
  }
  if (added) saveLibrary();
  setProject(ws.customBlocks ?? {});
  updateCustomBlocks();
  load(ws);
  toast(`Opened ${name}${added ? `; ${added} block${added > 1 ? "s" : ""} added to My blocks` : ""}`);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    if (file.name.endsWith(".rs")) importBlockFile(file.name, await file.text());
    else if (/\.(cfs|zip)$/i.test(file.name)) openWorkspace(readBundle(new Uint8Array(await file.arrayBuffer())), file.name);
    else openWorkspace(parseWorkspaceFile(await file.text()), file.name);
  } catch (err) {
    toast(err instanceof Error ? err.message : "Could not open that file.");
  }
});

$("save").addEventListener("click", () => {
  const { workspace } = readWorkspace(bw, sourceOf);
  if (!workspace) return toast("Add an Engine block first.");
  const name = toCrateName(workspace.engine.name);
  const entries: Record<string, Uint8Array> = {
    "workspace.json": strToU8(`${JSON.stringify(workspace, null, 2)}\n`),
  };
  for (const [id, src] of Object.entries(workspace.customBlocks ?? {})) entries[`blocks/${id}.block.rs`] = strToU8(src);
  download(`${name}.cfs`, zipSync(entries, { level: 6 }), "application/zip");
  toast(`Saved ${name}.cfs`);
});

exportBtn.addEventListener("click", () => {
  if (!current) return;
  const project = toCrateName(current.engine.name);
  const entries: Record<string, Uint8Array> = {};
  for (const f of generateProject(current)) entries[`${project}/${f.path}`] = strToU8(f.contents);
  download(`${project}.zip`, zipSync(entries, { level: 6 }), "application/zip");
  toast(`Exported ${project}.zip`);
});

$("copy").addEventListener("click", async () => {
  const file = files.find((f) => f.path === activeFile);
  if (!file) return;
  try {
    await navigator.clipboard.writeText(file.contents);
    toast(`Copied ${activeFile}`);
  } catch {
    toast("Copy is not available here.");
  }
});

// Start ---------------------------------------------------------------------

updateCustomBlocks();
if (restore()) {
  showEngineTop();
  refresh();
  suppressTour = false;
} else {
  load(starterWorkspace());
}
