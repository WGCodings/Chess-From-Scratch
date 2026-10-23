import { describe, expect, it } from "vitest";
import {
  collapseBuiltins,
  enabledRegions,
  expandBuiltins,
  forkBlock,
  generateProject,
  parseBlockFile,
  referenceWorkspace,
  starterWorkspace,
  type SkeletonType,
  type Workspace,
} from "./index";

/**
 * Rust files of a project, by path (workspace.json and block files left out),
 * with the region markers of your versions named after the blocks they replace.
 */
function rust(ws: Workspace): Record<string, string> {
  const names = new Map<string, string>([["my_ab", "alpha_beta"], ["my_killers", "killers"], ["my_negamax", "negamax"], ["my_engine", "engine"], ["my_hce", "hce"]]);
  const rename = (text: string) =>
    text.replace(/(\/\/ @(?:block|end) )([\w|]+)/g, (_, head: string, list: string) =>
      head + list.split("|").map((n) => names.get(n) ?? n).join("|"),
    );
  return Object.fromEntries(
    generateProject(ws)
      .filter((f) => f.path.endsWith(".rs") && !f.path.startsWith("blocks/"))
      // Your versions' parameters have no doc comments in params.rs.
      .map((f) => [f.path, rename(f.path === "src/params.rs" ? f.contents.replace(/^\/\/\/.*\n/gm, "") : f.contents)]),
  );
}

/** Uses `id` (a version of the built-in search block `base`) in place of `base`. */
function useVersion(ws: Workspace, base: string, id: string, src: string): Workspace {
  const out = structuredClone(ws);
  out.customBlocks = { ...out.customBlocks, [id]: src };
  for (const list of Object.values(out.search.slots)) for (const b of list) if (b.type === base) b.type = id;
  return out;
}

function useSkeleton(ws: Workspace, base: SkeletonType, id: string, src: string): Workspace {
  const out = structuredClone(ws);
  out.customBlocks = { ...out.customBlocks, [id]: src };
  out.versions = { ...out.versions, [base]: id };
  return out;
}

const withAlphaBeta = () => {
  const ws = starterWorkspace();
  ws.search.slots.move_loop.push({ type: "alpha_beta", params: {} });
  return ws;
};

describe("@builtin lines", () => {
  it("collapse regions that are off and keep the ones that are on", () => {
    const lines = [
      "a();",
      "// @block killers",
      "killer();",
      "// @end killers",
      "// @block transposition_table",
      "tt();",
      "// @else",
      "no_tt();",
      "// @end transposition_table",
      "// @block history",
      "history();",
      "// @else",
      "no_history();",
      "// @end history",
    ];
    expect(collapseBuiltins(lines, new Set(["history"]))).toEqual([
      "a();",
      "// @builtin killers",
      "// @until transposition_table",
      "no_tt();",
      "// @end transposition_table",
      "// @block history",
      "history();",
      "// @end history",
    ]);
    // Expanding gives back exactly the original lines.
    const short = collapseBuiltins(lines, new Set(["history"]));
    expect(expandBuiltins(short, lines).map((e) => e.line)).toEqual(lines);
  });

  it("expand back to the original code", () => {
    const original = ["x();", "    // @block killers", "    killer();", "    // @end killers", "// @block tt", "tt();", "// @else", "no();", "// @end tt"];
    const body = ["x();", "    // @builtin killers", "// @block tt", "// @builtin", "// @else", "mine();", "// @end tt"];
    const out = expandBuiltins(body, original).map((e) => e.line);
    expect(out).toEqual(["x();", "    // @block killers", "    killer();", "    // @end killers", "// @block tt", "tt();", "// @else", "mine();", "// @end tt"]);
  });

  it("a fresh version of Alpha-beta shows only the code of blocks in the engine", () => {
    const ws = withAlphaBeta();
    const src = forkBlock("alpha_beta", "my_ab", undefined, enabledRegions(ws));
    const code = parseBlockFile(src)
      .block!.sections.map((s) => s.body)
      .join("\n");
    for (const word of ["killers.push", "history.update", "LMR_MIN", "zero-window", "best_move = Some"]) {
      expect(code).not.toContain(word);
    }
    expect(code).toContain("// @builtin killers");
    expect(code.split("\n").length).toBeLessThan(forkBlock("alpha_beta", "x").split("\n").length - 30);
  });

  it("a version made early still works when the other blocks are added later", () => {
    const early = withAlphaBeta();
    const src = forkBlock("alpha_beta", "my_ab", undefined, enabledRegions(early));
    expect(rust(useVersion(early, "alpha_beta", "my_ab", src))).toEqual(rust(early));
    // Every block, with the version made when only alpha-beta was there.
    const full = referenceWorkspace();
    expect(rust(useVersion(full, "alpha_beta", "my_ab", src))).toEqual(rust(full));
  });

  it("versions of the skeleton made from the starter keep working in the full engine", () => {
    const starter = starterWorkspace();
    const full = referenceWorkspace();
    for (const base of ["negamax", "engine", "hce"] as SkeletonType[]) {
      const src = forkBlock(base, `my_${base}`, undefined, enabledRegions(starter));
      expect(src).toContain("// @builtin");
      expect(rust(useSkeleton(starter, base, `my_${base}`, src))).toEqual(rust(starter));
      expect(rust(useSkeleton(full, base, `my_${base}`, src))).toEqual(rust(full));
    }
  });

  it("a version of an inner block works inside a version of the outer one", () => {
    const full = referenceWorkspace();
    const negamax = forkBlock("negamax", "my_negamax", undefined, enabledRegions(starterWorkspace()));
    const killers = forkBlock("killers", "my_killers").replace("self.killers.push(ply, mv);", "self.killers.push(ply, mv); // mine");
    let ws = useSkeleton(full, "negamax", "my_negamax", negamax);
    ws = useVersion(ws, "killers", "my_killers", killers);
    expect(rust(ws)["src/search.rs"]).toContain("self.killers.push(ply, mv); // mine");
  });
});
