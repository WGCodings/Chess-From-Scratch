// Building a branch's engine in the desktop app: write its project into its
// own folder, cargo build it, and hand back the program. Tests and Play
// both use this; Run (the dock) builds the open canvas the same way.

import { generateProject, toCrateName, type Workbench, type Workspace } from "@cfs/codegen";
import type { Desktop } from "./platform";

/** The folder a branch's engine is built in: `<crate>` for main, `<crate>-<branch>` for the others. */
export function projectName(wb: Workbench, branchId: string, ws: Workspace): string {
  return `${toCrateName(ws.engine.name)}${branchId === wb.main ? "" : `-${branchId}`}`;
}

/** Negamax without Iterative deepening searches a fixed depth and ignores the clock. */
export function ignoresClock(ws: Workspace): boolean {
  if (ws.search.kind !== "negamax") return false;
  return !Object.values(ws.search.slots)
    .flat()
    .some((b) => b.type === "iterative_deepening" || /^\/\/! base: iterative_deepening$/m.test(ws.customBlocks?.[b.type] ?? ""));
}

export interface BuiltEngine {
  program: string;
  dir: string;
  /** The engine has a Hash option (a transposition table). */
  hash: boolean;
}

/** Writes and builds the engine of `ws` (branch `branchId`); build output goes to `onLine`. */
export async function buildBranch(d: Desktop, wb: Workbench, branchId: string, ws: Workspace, onLine: (line: string) => void): Promise<BuiltEngine> {
  let files;
  try {
    files = generateProject(ws);
  } catch (err) {
    const name = wb.branches[branchId]?.name ?? branchId;
    throw new Error(`"${name}" is not a complete engine: ${err instanceof Error ? err.message : String(err)}`);
  }
  const dir = await d.defaultProjectDir(projectName(wb, branchId, ws));
  await d.writeProject(
    dir,
    files.map((f) => ({ path: f.path, contents: f.contents })),
  );
  const program = await d.buildEngine(dir, onLine);
  return { program, dir, hash: !!ws.engine.transpositionTable };
}
