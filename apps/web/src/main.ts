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
import { COLOURS, ENGINE, TIME, TT, defineBlocks, maxInstances, toolbox } from "./blocks";
import { loadWorkspace, parseWorkspaceFile, readWorkspace } from "./convert";
import { renderCode } from "./highlight";
import "./style.css";

const STORAGE_KEY = "cfs.blockly.v1";
/** Files the user builds come first; the machinery follows alphabetically. */
const PRIMARY = ["src/search.rs", "src/eval.rs", "src/params.rs", "src/main.rs"];
type Tab = string;

function tabOrder(paths: string[]): Tab[] {
  const rust = paths.filter((p) => p.startsWith("src/") && !PRIMARY.includes(p)).sort();
  return [...PRIMARY.filter((p) => paths.includes(p)), ...rust, "Cargo.toml"];
}

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

// Blocks not connected to an Engine block are greyed out and ignored.
bw.addChangeListener(Blockly.Events.disableOrphans);

// DOM -----------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const codeEl = $<HTMLPreElement>("code");
const pathEl = $("code-path");
const tabsEl = $("tabs");
const issuesEl = $<HTMLUListElement>("issues");
const exportBtn = $<HTMLButtonElement>("export");
const fileInput = $<HTMLInputElement>("file");
const toastEl = $("toast");

let activeTab: Tab = "src/search.rs";
let files: GeneratedFile[] = [];
let current: Workspace | null = null;
let focusRegion: string | null = null;

let tabs: Tab[] = [];

/** Rebuilds the tab bar when the set of generated files changes. */
function renderTabs(): void {
  const next = tabOrder(files.map((f) => f.path));
  if (next.join() === tabs.join()) return;
  tabs = next;
  tabsEl.replaceChildren(
    ...tabs.map((tab) => {
      const b = document.createElement("button");
      b.className = "tab";
      b.type = "button";
      b.role = "tab";
      b.textContent = tab.replace("src/", "");
      b.dataset.tab = tab;
      b.addEventListener("click", () => showTab(tab));
      return b;
    }),
  );
  if (!tabs.includes(activeTab)) activeTab = "src/search.rs";
}

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 2200);
}

// Preview -------------------------------------------------------------------

function showTab(tab: Tab, scroll = false): void {
  activeTab = tab;
  for (const b of tabsEl.querySelectorAll<HTMLButtonElement>(".tab")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  }
  pathEl.textContent = tab;
  const file = files.find((f) => f.path === tab);
  codeEl.innerHTML = file ? renderCode(file.contents) : "";
  applyFocus(scroll);
}

function applyFocus(scroll: boolean): void {
  let first: HTMLElement | null = null;
  for (const ln of codeEl.querySelectorAll<HTMLElement>(".ln")) {
    const on = focusRegion !== null && ln.dataset.region === focusRegion;
    ln.classList.toggle("focus", on);
    if (on && !first) first = ln;
  }
  if (scroll && first) first.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** The template region a Blockly block corresponds to. */
function regionOf(type: string): string | null {
  if (type === ENGINE) return "engine";
  if (type === TIME) return "time_management";
  if (type === TT) return "transposition_table";
  if (type.startsWith("cfs_search_")) return type.slice("cfs_search_".length);
  if (type.startsWith("cfs_eval_")) return `eval_${type.slice("cfs_eval_".length)}`;
  return null;
}

function focusBlock(block: Blockly.Block | null): void {
  focusRegion = block ? regionOf(block.type) : null;
  if (!focusRegion) return applyFocus(false);
  const marker = `// @block ${focusRegion}`;
  const has = (path: string) => files.find((f) => f.path === path)?.contents.includes(marker);
  // Stay on the current file if it has the block, else jump to the first that does.
  const tab = has(activeTab) ? activeTab : tabs.find(has);
  if (tab) showTab(tab, true);
  else applyFocus(false);
}

// Status --------------------------------------------------------------------

function renderIssues(issues: Issue[]): void {
  issuesEl.replaceChildren();
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length === 0) {
    const li = document.createElement("li");
    li.className = "ok";
    li.textContent = current
      ? `Ready: ${current.engine.name} compiles as a ${toCrateName(current.engine.name)} Cargo project.`
      : "Ready.";
    issuesEl.append(li);
  }
  for (const issue of issues) {
    const li = document.createElement("li");
    li.className = issue.level;
    li.textContent = issue.message;
    issuesEl.append(li);
  }
}

function refresh(): void {
  const { workspace, problems } = readWorkspace(bw);
  current = workspace;
  const issues: Issue[] = problems.map((message) => ({ level: "error", message }));
  if (workspace) issues.push(...validate(workspace));

  const blocking = issues.some((i) => i.level === "error");
  if (workspace && !issues.some((i) => i.level === "error" && !problems.includes(i.message))) {
    try {
      files = generateProject(workspace);
    } catch (err) {
      if (!(err instanceof GenerateError)) throw err;
    }
  }
  codeEl.classList.toggle("stale", blocking);
  exportBtn.disabled = blocking;
  renderIssues(issues);
  renderTabs();
  showTab(activeTab);
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

function load(ws: Workspace): void {
  loadWorkspace(bw, ws);
  showEngineTop();
  refresh();
  save();
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
  const file = files.find((f) => f.path === activeTab);
  if (!file) return;
  try {
    await navigator.clipboard.writeText(file.contents);
    toast(`Copied ${activeTab}`);
  } catch {
    toast("Copy is not available here.");
  }
});

// Start ---------------------------------------------------------------------

if (restore()) showEngineTop();
else load(starterWorkspace());
refresh();
