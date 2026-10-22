/**
 * Where custom blocks live in the browser: the project's own blocks (the
 * ones placed in the current engine) and the personal library ("My blocks"),
 * which keeps every block you save for future projects.
 */

import { EXAMPLE_BLOCKS } from "@cfs/codegen";

const LIBRARY_KEY = "cfs.library.v1";
const PROJECT_KEY = "cfs.projectBlocks.v1";

function load(key: string): Record<string, string> {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? "{}") as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    }
  } catch {
    // Unavailable or corrupt storage: start empty.
  }
  return {};
}

function store(key: string, value: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode).
  }
}

/** Saved blocks, id → block file text. */
export const library: Record<string, string> = load(LIBRARY_KEY);
/** Blocks of the current project, id → block file text. */
export let project: Record<string, string> = load(PROJECT_KEY);

export function saveLibrary(): void {
  store(LIBRARY_KEY, library);
}

export function setProject(blocks: Record<string, string>): void {
  project = { ...blocks };
  store(PROJECT_KEY, project);
}

/** The text of a block: the project's version, then the library's, then an example. */
export function sourceOf(id: string): string | undefined {
  return project[id] ?? library[id] ?? EXAMPLE_BLOCKS[id];
}

/** Every custom block id known anywhere. */
export function allIds(): string[] {
  return [...new Set([...Object.keys(project), ...Object.keys(library), ...Object.keys(EXAMPLE_BLOCKS)])];
}
