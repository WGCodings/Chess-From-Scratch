/**
 * What each block is, in words: label, explanation, CPW link and colour,
 * plus the code region it owns in the generated files.
 */

import { EVAL_TERMS, SEARCH_BLOCKS, SKELETON_INFO, TIME_BLOCKS, TRANSPOSITION_TABLE, type Workspace } from "@cfs/codegen";
import { BASIC_TIME_BLOCK, COLOURS, ENGINE, HCE, NEGAMAX, TIME, TT } from "./blocks";

export interface BlockInfo {
  /** Key used to detect added/removed blocks and to find the code region. */
  key: string;
  label: string;
  info: string;
  cpw: string;
  colour: string;
}

/** Info for a Blockly block type, or null for non-CFS blocks. */
export function infoForBlockType(type: string): BlockInfo | null {
  if (type === ENGINE) return { key: "engine", ...SKELETON_INFO.engine, colour: COLOURS.engine };
  if (type === NEGAMAX) return { key: "negamax", ...SKELETON_INFO.negamax, colour: COLOURS.skeleton };
  if (type === HCE) return { key: "hce", ...SKELETON_INFO.hce, colour: COLOURS.eval };
  if (type === TT) return infoForKey("transposition_table");
  if (type === TIME) return infoForKey("time_management");
  if (type === BASIC_TIME_BLOCK) return infoForKey("basic_time");
  if (type.startsWith("cfs_search_")) return infoForKey(type.slice("cfs_search_".length));
  if (type.startsWith("cfs_eval_")) return infoForKey(`eval_${type.slice("cfs_eval_".length)}`);
  return null;
}

/** Info for a block key (the same names as the template regions). */
export function infoForKey(key: string): BlockInfo | null {
  if (key === "transposition_table") {
    return { key, label: TRANSPOSITION_TABLE.label, info: TRANSPOSITION_TABLE.info, cpw: TRANSPOSITION_TABLE.cpw, colour: COLOURS.setting };
  }
  if (key === "time_management" || key === "basic_time") {
    const spec = TIME_BLOCKS[key];
    return { key, label: spec.label, info: spec.info, cpw: spec.cpw, colour: COLOURS.setting };
  }
  if (key in SEARCH_BLOCKS) {
    const spec = SEARCH_BLOCKS[key as keyof typeof SEARCH_BLOCKS];
    return { key, label: spec.label, info: spec.info, cpw: spec.cpw, colour: COLOURS[spec.slot] };
  }
  if (key.startsWith("eval_")) {
    const spec = EVAL_TERMS[key.slice(5) as keyof typeof EVAL_TERMS];
    if (spec) return { key, label: spec.label, info: spec.info, cpw: spec.cpw, colour: COLOURS.evalTerm };
  }
  return null;
}

/** Keys of every feature block placed in a workspace. */
export function placedKeys(ws: Workspace | null): Set<string> {
  const keys = new Set<string>();
  if (!ws) return keys;
  if (ws.engine.timeManagement) keys.add(ws.engine.timeManagement.type);
  if (ws.engine.transpositionTable) keys.add("transposition_table");
  for (const blocks of Object.values(ws.search.slots)) for (const b of blocks) keys.add(b.type);
  for (const t of ws.eval.terms) keys.add(`eval_${t.type}`);
  return keys;
}
