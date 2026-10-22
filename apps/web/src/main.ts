import * as Blockly from "blockly";
import { strToU8, zipSync } from "fflate";
import {
  GenerateError,
  emptyWorkspace,
  generateProject,
  referenceWorkspace,
  starterWorkspace,
  toCrateName,
  validate,
  type GeneratedFile,
  type Issue,
  type Workspace,
} from "@cfs/codegen";
import { COLOURS, ENGINE, defineBlocks, maxInstances, toolbox } from "./blocks";
import { loadWorkspace, parseWorkspaceFile, readWorkspace } from "./convert";
import { describeCode, diffLines, explain, lineRegions, splitSections, type Hunk } from "./diff";
import { renderCode } from "./highlight";
import { infoForBlockType, infoForKey, placedKeys, type BlockInfo } from "./info";
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
      b.addEventListener("click", () => showFile(path));
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
  // During a tour, removed lines are shown in red above the code that replaced them.
  const removed = tour
    ? tour.hunks.flatMap((h, k) =>
        h.file === path && h.removedLines?.length ? [{ at: h.start, lines: h.removedLines, current: k === tour!.index }] : [],
      )
    : [];
  codeEl.innerHTML = file ? renderCode(file.contents, lineClasses(path), removed) : "";
  renderTree();
  if (scrollTo !== undefined) {
    const rows = codeEl.querySelectorAll<HTMLElement>(".ln:not(.removed)");
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
    .filter((h) => h.file !== "workspace.json") // bookkeeping, not engine code
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

function refresh(): void {
  const { workspace, problems } = readWorkspace(bw);
  current = workspace;
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

  if (!blocking && files !== before) {
    const keys = placedKeys(workspace);
    const added = [...keys].filter((k) => !lastKeys.has(k)).map(infoForKey).filter((i): i is BlockInfo => !!i);
    const removed = [...lastKeys].filter((k) => !keys.has(k)).map(infoForKey).filter((i): i is BlockInfo => !!i);
    lastKeys = keys;

    if (!suppressTour && added.length > 0) {
      const old = new Map(before.map((f) => [f.path, f.contents.replace(/\n$/, "").split("\n")]));
      const hunks = files
        .flatMap((f) => diffLines(f.path, old.get(f.path) ?? [], f.contents.replace(/\n$/, "").split("\n")))
        .flatMap((h) => (h.end > h.start ? sectionHunks(h.file, h.start, h.end, h.removed, h.removedLines) : [h]));
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

// Persistence ---------------------------------------------------------------

function save(): void {
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
  load(make());
  toast("New engine created");
});

$("open").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    load(parseWorkspaceFile(await file.text()));
    toast(`Opened ${file.name}`);
  } catch (err) {
    toast(err instanceof Error ? err.message : "Could not open that file.");
  }
});

$("save").addEventListener("click", () => {
  const { workspace } = readWorkspace(bw);
  if (!workspace) return toast("Add an Engine block first.");
  download("workspace.json", `${JSON.stringify(workspace, null, 2)}\n`, "application/json");
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

if (restore()) {
  showEngineTop();
  refresh();
  suppressTour = false;
} else {
  load(starterWorkspace());
}
