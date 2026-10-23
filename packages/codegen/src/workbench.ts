/**
 * The workbench: several versions ("branches") of one engine, kept together
 * with their history so work can continue over weeks. A branch is cloned
 * from another one, changed, and then kept (it becomes the main version) or
 * deleted. Every branch remembers the workspace it started from, so it can
 * say exactly what it changed: blocks added or removed, parameters, code.
 */

import {
  EVAL_TERMS,
  NEGAMAX_PARAMS,
  TIME_BLOCKS,
  TRANSPOSITION_TABLE,
  evalSpec,
  searchSpec,
  skeletonSpec,
  type ParamSpec,
  type ParamValue,
  type SkeletonType,
} from "./blocks";
import { parseBlockFile } from "./blockfile";
import { normalizeWorkspace, type Params, type Workspace } from "./workspace";

export const WORKBENCH_FORMAT_VERSION = 1;

export interface Branch {
  id: string;
  name: string;
  /** The branch it was cloned from (absent for the first one). */
  parent?: string;
  /** The workspace when it was cloned: what its changes are measured against. */
  base?: Workspace;
  workspace: Workspace;
  /** The editor's canvas (block positions and loose blocks), as the editor saved it. */
  canvas?: unknown;
  created: string;
  updated: string;
}

export type HistoryKind = "created" | "cloned" | "kept" | "deleted" | "renamed" | "test";

export interface HistoryEvent {
  at: string;
  kind: HistoryKind;
  /** The branch's name at that moment. */
  branch: string;
  /** e.g. the branch it was cloned from, the old name, the test result. */
  detail?: string;
  /** What the branch had changed, one line each (kept and deleted branches). */
  changes?: string[];
}

export interface Workbench {
  format: typeof WORKBENCH_FORMAT_VERSION;
  /** The main version: the one branches are kept into. */
  main: string;
  /** The branch open in the editor. */
  current: string;
  branches: Record<string, Branch>;
  /** Oldest first. */
  history: HistoryEvent[];
  /** Engine test results (Sprint 8); kept as they are. */
  tests?: unknown[];
}

export const MAIN_BRANCH_NAME = "main";

const now = () => new Date().toISOString();
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function freeBranchId(wb: Pick<Workbench, "branches">, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "branch";
  let id = base;
  for (let i = 2; wb.branches[id]; i++) id = `${base}-${i}`;
  return id;
}

/** A workbench with one branch, "main", holding `ws`. */
export function newWorkbench(ws: Workspace, at = now()): Workbench {
  return {
    format: WORKBENCH_FORMAT_VERSION,
    main: "main",
    current: "main",
    branches: { main: { id: "main", name: MAIN_BRANCH_NAME, workspace: copy(ws), created: at, updated: at } },
    history: [{ at, kind: "created", branch: MAIN_BRANCH_NAME }],
  };
}

export class WorkbenchError extends Error {}

function branch(wb: Workbench, id: string): Branch {
  const b = wb.branches[id];
  if (!b) throw new WorkbenchError(`There is no branch "${id}".`);
  return b;
}

/** Stores the editor's workspace in the open branch. */
export function updateCurrent(wb: Workbench, ws: Workspace, at = now()): void {
  const b = branch(wb, wb.current);
  if (JSON.stringify(b.workspace) === JSON.stringify(ws)) return;
  b.workspace = copy(ws);
  b.updated = at;
}

/** Clones branch `from` into a new branch called `name` and returns its id. Does not open it. */
export function cloneBranch(wb: Workbench, from: string, name: string, at = now()): string {
  const src = branch(wb, from);
  const clean = name.trim() || `${src.name} copy`;
  if (Object.values(wb.branches).some((b) => b.name === clean)) throw new WorkbenchError(`There is already a branch called "${clean}".`);
  const id = freeBranchId(wb, clean);
  wb.branches[id] = { id, name: clean, parent: from, base: copy(src.workspace), workspace: copy(src.workspace), created: at, updated: at };
  if (src.canvas !== undefined) wb.branches[id]!.canvas = copy(src.canvas);
  wb.history.push({ at, kind: "cloned", branch: clean, detail: src.name });
  return id;
}

export function renameBranch(wb: Workbench, id: string, name: string, at = now()): void {
  const b = branch(wb, id);
  const clean = name.trim();
  if (!clean || clean === b.name) return;
  if (Object.values(wb.branches).some((o) => o.id !== id && o.name === clean)) throw new WorkbenchError(`There is already a branch called "${clean}".`);
  wb.history.push({ at, kind: "renamed", branch: clean, detail: b.name });
  b.name = clean;
}

/** What branch `id` changed since it was cloned (nothing for the main branch's first version). */
export function branchChanges(wb: Workbench, id: string): Change[] {
  const b = branch(wb, id);
  return b.base ? diffWorkspaces(b.base, b.workspace) : [];
}

/**
 * The main version changed after this branch was cloned from it: keeping
 * the branch replaces those changes. Returns what main changed, or [].
 */
export function mainChangedSince(wb: Workbench, id: string): Change[] {
  const b = branch(wb, id);
  if (id === wb.main || b.parent !== wb.main || !b.base) return [];
  return diffWorkspaces(b.base, branch(wb, wb.main).workspace);
}

/**
 * Keeps branch `id`: its engine becomes the main version and the branch is
 * gone. Branches cloned from it now come from main. Opens main when the
 * kept branch was open.
 */
export function keepBranch(wb: Workbench, id: string, at = now()): void {
  if (id === wb.main) throw new WorkbenchError("This is already the main version.");
  const b = branch(wb, id);
  const main = branch(wb, wb.main);
  const changes = describeChanges(diffWorkspaces(b.base ?? main.workspace, b.workspace));
  main.workspace = copy(b.workspace);
  if (b.canvas !== undefined) main.canvas = copy(b.canvas);
  else delete main.canvas;
  main.updated = at;
  for (const o of Object.values(wb.branches)) if (o.parent === id) o.parent = wb.main;
  delete wb.branches[id];
  if (wb.current === id) wb.current = wb.main;
  wb.history.push({ at, kind: "kept", branch: b.name, changes });
}

/** Deletes branch `id` (not the main version). Opens main when it was open. */
export function deleteBranch(wb: Workbench, id: string, at = now()): void {
  if (id === wb.main) throw new WorkbenchError("The main version can't be deleted.");
  const b = branch(wb, id);
  const changes = describeChanges(branchChanges(wb, id));
  for (const o of Object.values(wb.branches)) if (o.parent === id) o.parent = b.parent ?? wb.main;
  delete wb.branches[id];
  if (wb.current === id) wb.current = wb.main;
  wb.history.push({ at, kind: "deleted", branch: b.name, changes });
}

/** Branches in a stable order: main first, then oldest first. */
export function branchList(wb: Workbench): Branch[] {
  return Object.values(wb.branches).sort((a, b) =>
    a.id === wb.main ? -1 : b.id === wb.main ? 1 : a.created.localeCompare(b.created) || a.name.localeCompare(b.name),
  );
}

/** Reads a workbench, or a single workspace (which becomes a workbench with one branch). */
export function parseWorkbench(value: unknown): Workbench {
  const v = value as Partial<Workbench> & { format?: unknown };
  if (v && typeof v === "object" && "branches" in v && v.branches && typeof v.branches === "object") {
    const branches: Record<string, Branch> = {};
    for (const [id, b] of Object.entries(v.branches as Record<string, Branch>)) {
      branches[id] = {
        ...b,
        id,
        workspace: normalizeWorkspace(b.workspace),
        base: b.base ? normalizeWorkspace(b.base) : undefined,
      };
    }
    const main = typeof v.main === "string" && branches[v.main] ? v.main : Object.keys(branches)[0];
    if (!main) throw new WorkbenchError("This workbench has no branches.");
    const current = typeof v.current === "string" && branches[v.current] ? v.current : main;
    return {
      format: WORKBENCH_FORMAT_VERSION,
      main,
      current,
      branches,
      history: Array.isArray(v.history) ? v.history : [],
      ...(Array.isArray(v.tests) ? { tests: v.tests } : {}),
    };
  }
  return newWorkbench(normalizeWorkspace(value as Workspace));
}

// What changed ---------------------------------------------------------------------------------

export type Change =
  | { kind: "added" | "removed"; block: string }
  | { kind: "param"; block: string; param: string; from: string; to: string }
  | { kind: "code"; block: string }
  | { kind: "setting"; setting: string; from: string; to: string };

/** One line per change, for lists and the history. */
export function describeChange(c: Change): string {
  switch (c.kind) {
    case "added":
      return `+ ${c.block}`;
    case "removed":
      return `− ${c.block}`;
    case "param":
      return `${c.block}: ${c.param} ${c.from} → ${c.to}`;
    case "code":
      return `${c.block}: code changed`;
    case "setting":
      return `${c.setting}: ${c.from} → ${c.to}`;
  }
}

export function describeChanges(changes: Change[]): string[] {
  return changes.map(describeChange);
}

/** A short name for a set of changes, e.g. "+ Killers, LMR: base 0.75 → 0.8". */
export function summarizeChanges(changes: Change[], max = 3): string {
  if (!changes.length) return "no changes";
  const lines = describeChanges(changes);
  return lines.length > max ? `${lines.slice(0, max).join(", ")} and ${lines.length - max} more` : lines.join(", ");
}

interface Placed {
  label: string;
  params: Params;
  specs: ParamSpec[];
  /** Custom block id, when the block is one of yours. */
  custom?: string;
}

function formatValue(v: ParamValue | undefined): string {
  if (v === undefined) return "default";
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  if (v.length === 2 && typeof v[0] === "number") return `S(${v[0]}, ${v[1]})`;
  return `[${(v as [number, number][]).map((s) => `S(${s[0]}, ${s[1]})`).join(", ")}]`;
}

function customInfo(ws: Workspace, id: string): { label: string; specs: ParamSpec[] } {
  const src = ws.customBlocks?.[id];
  const parsed = src ? parseBlockFile(src).block : null;
  return { label: parsed?.label ?? id, specs: parsed?.params ?? [] };
}

/** Every placed block of a workspace by a stable key, with its label and parameters. */
function placed(ws: Workspace): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const add = (key: string, p: Placed) => {
    let k = key;
    for (let i = 2; out.has(k); i++) k = `${key}#${i}`;
    out.set(k, p);
  };
  const skeleton = (type: SkeletonType, builtinParams: Params, builtinSpecs: ParamSpec[]) => {
    const version = ws.versions?.[type];
    if (version) {
      const info = customInfo(ws, version);
      add(`skeleton:${type}`, { label: info.label, params: ws.versionParams?.[type] ?? builtinParams, specs: info.specs, custom: version });
    } else {
      add(`skeleton:${type}`, { label: skeletonSpec(type)?.label ?? type, params: builtinParams, specs: builtinSpecs });
    }
  };
  if (ws.search.kind !== "none") skeleton(ws.search.kind, ws.search.params, ws.search.kind === "negamax" ? NEGAMAX_PARAMS : []);
  if (ws.eval.kind === "hce") skeleton("hce", {}, []);
  if (ws.eval.kind === "hce" && ws.eval.taper) skeleton("taper", {}, []);
  if (ws.engine.timeManagement) {
    const t = ws.engine.timeManagement.type;
    skeleton(t, ws.engine.timeManagement.params, TIME_BLOCKS[t].params);
  }
  if (ws.engine.transpositionTable) skeleton("transposition_table", ws.engine.transpositionTable, TRANSPOSITION_TABLE.params);
  if (ws.versions?.engine) skeleton("engine", {}, []);
  for (const blocks of Object.values(ws.search.slots)) {
    for (const b of blocks) {
      const spec = searchSpec(b.type);
      if (spec) add(`search:${b.type}`, { label: spec.label, params: b.params, specs: spec.params });
      else {
        const info = customInfo(ws, b.type);
        add(`custom:${b.type}`, { label: info.label, params: b.params, specs: info.specs, custom: b.type });
      }
    }
  }
  for (const t of ws.eval.terms) {
    const spec = evalSpec(t.type);
    if (spec) add(`eval:${t.type}`, { label: spec.label, params: t.params, specs: EVAL_TERMS[t.type as keyof typeof EVAL_TERMS].params });
    else {
      const info = customInfo(ws, t.type);
      add(`custom:${t.type}`, { label: info.label, params: t.params, specs: info.specs, custom: t.type });
    }
  }
  return out;
}

const sameText = (a: string | undefined, b: string | undefined) => (a ?? "").replace(/\r\n?/g, "\n").trimEnd() === (b ?? "").replace(/\r\n?/g, "\n").trimEnd();

/** What `after` changed compared to `before`: blocks added or removed, parameters, code and engine settings. */
export function diffWorkspaces(before: Workspace, after: Workspace): Change[] {
  const changes: Change[] = [];
  const setting = (name: string, a: unknown, b: unknown) => {
    if (a !== b) changes.push({ kind: "setting", setting: name, from: String(a), to: String(b) });
  };
  setting("Engine name", before.engine.name, after.engine.name);
  setting("Author", before.engine.author, after.engine.author);
  setting("Bench depth", before.engine.benchDepth, after.engine.benchDepth);

  const a = placed(before);
  const b = placed(after);
  for (const [key, p] of a) if (!b.has(key)) changes.push({ kind: "removed", block: p.label });
  for (const [key, p] of b) {
    const old = a.get(key);
    if (!old) {
      changes.push({ kind: "added", block: p.label });
      continue;
    }
    // A built-in block swapped for your own version of it (or back) reads as one replacing the other.
    if (old.custom !== p.custom) {
      changes.push({ kind: "removed", block: old.label }, { kind: "added", block: p.label });
      continue;
    }
    for (const spec of p.specs) {
      const from = old.params[spec.key] ?? spec.default;
      const to = p.params[spec.key] ?? spec.default;
      if (JSON.stringify(from) !== JSON.stringify(to)) {
        changes.push({ kind: "param", block: p.label, param: spec.label || spec.key, from: formatValue(from), to: formatValue(to) });
      }
    }
    if (p.custom && !sameText(before.customBlocks?.[p.custom], after.customBlocks?.[p.custom])) {
      changes.push({ kind: "code", block: p.label });
    }
  }
  return changes;
}
