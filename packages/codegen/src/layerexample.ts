/**
 * A chain of blocks that build on each other, for tests and the compile
 * check: your alpha-beta, PVS on it, LMR on PVS.
 */
import { enabledRegions, forkBlock, starterWorkspace, type Workspace } from "./index";

export const MY_PVS = [
  "//! ---",
  "//! id: my_pvs",
  "//! label: My PVS",
  "//! slot: move_loop",
  "//! requires: my_alpha_beta",
  "//! ---",
  "",
  '// @replace search.rs "let score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);"',
  "// The first move gets the full window, the others a zero window first.",
  "let mut score;",
  "if i == 0 {",
  "    score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);",
  "} else {",
  "    score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);",
  "    if score > alpha && score < beta {",
  "        score = -self.negamax(pos, new_depth, ply + 1, -beta, -alpha);",
  "    }",
  "}",
  "",
].join("\n");

export const MY_LMR = [
  "//! ---",
  "//! id: my_lmr",
  "//! label: My LMR",
  "//! slot: move_loop",
  "//! requires: my_pvs",
  "//! params:",
  "//!   MY_LMR_DEPTH: i32 = 3 (1..20)",
  "//! ---",
  "",
  '// @insert search.rs before "score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);"',
  "// Late quiet moves first get a search one ply shallower.",
  "let r = if depth >= MY_LMR_DEPTH && i >= 3 && quiet {",
  "    1",
  "} else {",
  "    0",
  "};",
  "",
  '// @replace search.rs "score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);"',
  "score = -self.negamax(pos, new_depth - r, ply + 1, -alpha - 1, -alpha);",
  "if score > alpha && r > 0 {",
  "    score = -self.negamax(pos, new_depth, ply + 1, -alpha - 1, -alpha);",
  "}",
  "",
].join("\n");

export function layeredEngine(...blocks: [string, string][]): Workspace {
  const ws = starterWorkspace();
  ws.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
  const ab = forkBlock("alpha_beta", "my_alpha_beta", undefined, enabledRegions(ws));
  ws.search.slots.move_loop = [{ type: "my_alpha_beta", params: {} }];
  ws.customBlocks = { my_alpha_beta: ab };
  for (const [id, src] of blocks) {
    ws.customBlocks[id] = src;
    ws.search.slots.move_loop.push({ type: id, params: {} });
  }
  return ws;
}

