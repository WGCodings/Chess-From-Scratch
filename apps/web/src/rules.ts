/**
 * Which blocks need which: blocks whose requirements are missing are greyed
 * out in the drawer, and a block that needs another block of the same slot
 * only snaps in below it (Principal variation search under Alpha-beta).
 */

import * as Blockly from "blockly";
import {
  enabledRegions,
  evalSpec,
  isCustomSlot,
  parseBlock,
  searchSpec,
  skeletonSpec,
  type BlockFile,
  type Workspace,
} from "@cfs/codegen";
import { CUSTOM_PREFIX, TAPER } from "./blocks";

export { NEEDS_REASON } from "./blocks";

let sourceOf: (id: string) => string | undefined = () => undefined;

/** Tells the rules where custom blocks live. */
export function setRuleSources(fn: (id: string) => string | undefined): void {
  sourceOf = fn;
}

const customOf = (type: string): BlockFile | null => {
  if (!type.startsWith(CUSTOM_PREFIX)) return null;
  const src = sourceOf(type.slice(CUSTOM_PREFIX.length));
  return src === undefined ? null : parseBlock(src).block;
};

/** What a block counts as for requirements: the built-in type, or the base of your version. */
function kindOf(type: string): string | null {
  if (type.startsWith("cfs_search_")) return type.slice("cfs_search_".length);
  const b = customOf(type);
  return b ? (b.base ?? b.id) : null;
}

/** The slot a block (built-in type or custom id) goes in. */
function slotOf(kind: string): string | null {
  const spec = searchSpec(kind);
  if (spec) return spec.slot;
  const b = sourceOf(kind) !== undefined ? parseBlock(sourceOf(kind)!).block : null;
  return b && isCustomSlot(b.slot) ? b.slot : null;
}

/** Blocks a Blockly block type needs: built-in types, custom ids, `negamax` or `hce`. */
export function requirementsOf(type: string): string[] {
  if (type.startsWith("cfs_search_")) {
    const spec = searchSpec(type.slice("cfs_search_".length));
    return ["negamax", ...(spec?.requires ?? [])];
  }
  if (type.startsWith("cfs_eval_") || type === TAPER) return ["hce"];
  const b = customOf(type);
  if (!b) return [];
  const base = b.base ? (searchSpec(b.base)?.requires ?? []) : [];
  const parent = !isCustomSlot(b.slot) ? [] : b.slot === "eval" ? ["hce"] : ["negamax"];
  return [...new Set([...parent, ...base, ...b.requires])];
}

/** A readable name for a requirement. */
export function requirementLabel(r: string): string {
  if (r === "transposition_table") return "a Transposition table";
  const label = searchSpec(r)?.label ?? evalSpec(r)?.label ?? skeletonSpec(r)?.label;
  if (label) return label;
  const src = sourceOf(r);
  return (src !== undefined ? parseBlock(src).block?.label : undefined) ?? r;
}

/** Blocks and skeleton parts an engine has, for `missingFor`. */
export function presentIn(ws: Workspace | null): Set<string> {
  return ws ? enabledRegions(ws) : new Set<string>();
}

/** The requirements of a block type that the engine (see `presentIn`) does not have yet. */
export function missingFor(type: string, present: ReadonlySet<string>): string[] {
  return requirementsOf(type).filter((r) => !present.has(r));
}

/** Requirements a block must sit below in its own stack. */
function stackRequirements(type: string): string[] {
  const kind = kindOf(type);
  const slot = kind ? slotOf(kind) : null;
  if (!slot) return [];
  return requirementsOf(type).filter((r) => r !== "negamax" && r !== "hce" && slotOf(r) === slot);
}

/** The blocks of a stack, top to bottom, starting at `b`. */
function chainFrom(b: Blockly.Block | null): Blockly.Block[] {
  const out: Blockly.Block[] = [];
  for (let x = b; x; x = x.getNextBlock()) if (!x.isInsertionMarker()) out.push(x);
  return out;
}

/** The blocks above `b` in its stack (not its parent), top first. */
function above(b: Blockly.Block): Blockly.Block[] {
  const out: Blockly.Block[] = [];
  let cur = b;
  for (let p = cur.getPreviousBlock(); p && p.getNextBlock() === cur; p = cur.getPreviousBlock()) {
    if (!p.isInsertionMarker()) out.unshift(p);
    cur = p;
  }
  return out;
}

/** The first block in `stack` whose same-slot requirement is not above it, with that requirement. */
export function misplaced(stack: Blockly.Block[]): { block: Blockly.Block; needs: string } | null {
  const seen = new Set<string>();
  for (const b of stack) {
    for (const r of stackRequirements(b.type)) if (!seen.has(r)) return { block: b, needs: r };
    const kind = kindOf(b.type);
    if (kind) seen.add(kind);
    const custom = customOf(b.type);
    if (custom) seen.add(custom.id);
  }
  return null;
}

/** The stack a statement connection would make, or null when it is not a statement join. */
function stackAfter(a: Blockly.Connection, b: Blockly.Connection): Blockly.Block[] | null {
  const moving = a.getSourceBlock();
  const target = b.getSourceBlock();
  if (a.type === Blockly.ConnectionType.PREVIOUS_STATEMENT && b.type === Blockly.ConnectionType.NEXT_STATEMENT) {
    const dragged = chainFrom(moving);
    if (b === target.nextConnection) {
      // Below `target`: the blocks above it, it, the dragged stack, then what was below it.
      const rest = chainFrom(target.getNextBlock()).filter((x) => !dragged.includes(x));
      return [...above(target), target, ...dragged, ...rest];
    }
    // At the top of a statement input.
    return [...dragged, ...chainFrom(b.targetBlock()).filter((x) => !dragged.includes(x))];
  }
  if (a.type === Blockly.ConnectionType.NEXT_STATEMENT && b.type === Blockly.ConnectionType.PREVIOUS_STATEMENT) {
    // The dragged stack goes on top of `target`.
    return [...chainFrom(moving), ...chainFrom(target)];
  }
  return null;
}

/** Keeps dependent blocks below the block they need. */
export class RulesChecker extends Blockly.ConnectionChecker {
  override doDragChecks(a: Blockly.RenderedConnection, b: Blockly.RenderedConnection, distance: number): boolean {
    if (!super.doDragChecks(a, b, distance)) return false;
    const stack = stackAfter(a, b);
    return !stack || !misplaced(stack);
  }
}

Blockly.registry.register(Blockly.registry.Type.CONNECTION_CHECKER, "cfsRules", RulesChecker, true);
