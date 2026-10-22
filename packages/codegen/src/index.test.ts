import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GenerateError,
  KNOWN_REGIONS,
  TemplateError,
  emptyWorkspace,
  enabledRegions,
  generateCargoToml,
  generateParams,
  generateProject,
  referenceWorkspace,
  renderTemplate,
  starterWorkspace,
  toCrateName,
  validate,
} from "./index";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("toCrateName", () => {
  it("slugifies display names", () => {
    expect(toCrateName("My Cool Engine!")).toBe("my-cool-engine");
  });
  it("falls back for empty names", () => {
    expect(toCrateName("  ")).toBe("my-engine");
  });
  it("does not start with a digit", () => {
    expect(toCrateName("42 Bot")).toBe("engine-42-bot");
  });
});

describe("renderTemplate", () => {
  const known = new Set(["a", "b"]);
  const src = ["x", "// @block a", "on", "// @else", "off", "// @end a", "y", ""].join("\n");

  it("keeps enabled regions with markers", () => {
    expect(renderTemplate(src, new Set(["a"]), known)).toBe(
      ["x", "// @block a", "on", "// @end a", "y", ""].join("\n"),
    );
  });
  it("emits the fallback for disabled regions", () => {
    expect(renderTemplate(src, new Set(), known)).toBe(["x", "off", "y", ""].join("\n"));
  });
  it("collapses blank lines left by removed regions", () => {
    const s = ["x", "", "// @block b", "z", "// @end b", "", "y"].join("\n");
    expect(renderTemplate(s, new Set(), known)).toBe("x\n\ny\n");
  });
  it("rejects unknown and unbalanced regions", () => {
    expect(() => renderTemplate("// @block nope\n// @end nope", new Set(), known)).toThrow(TemplateError);
    expect(() => renderTemplate("// @block a\n", new Set(), known)).toThrow(TemplateError);
    expect(() => renderTemplate("// @block a\n// @end b", new Set(), known)).toThrow(TemplateError);
  });
});

describe("validate", () => {
  it("accepts the built-in workspaces", () => {
    for (const ws of [referenceWorkspace(), starterWorkspace()]) {
      expect(validate(ws).filter((i) => i.level === "error")).toEqual([]);
    }
  });
  it("requires a TT for TT move ordering", () => {
    const ws = referenceWorkspace();
    ws.engine.transpositionTable = null;
    expect(validate(ws).some((i) => i.message.includes("needs a Transposition table"))).toBe(true);
  });
  it("rejects blocks in the wrong slot and duplicates", () => {
    const ws = referenceWorkspace();
    const nmp = ws.search.slots.pruning.find((b) => b.type === "null_move_pruning")!;
    ws.search.slots.root.push(nmp);
    const messages = validate(ws).map((i) => i.message);
    expect(messages.some((m) => m.includes("cannot go in the root slot"))).toBe(true);
    expect(messages.some((m) => m.includes("more than once"))).toBe(true);
  });
  it("rejects out-of-range parameters", () => {
    const ws = referenceWorkspace();
    ws.search.slots.pruning[0]!.params.margin = -5;
    expect(() => generateProject(ws)).toThrow(GenerateError);
  });
  it("warns about an empty evaluation", () => {
    expect(validate(emptyWorkspace()).some((i) => i.level === "warning")).toBe(true);
  });
});

describe("generateProject", () => {
  it("reproduces the reference engine byte for byte", () => {
    const files = generateProject(referenceWorkspace());
    for (const name of ["main.rs", "search.rs", "eval.rs", "params.rs"]) {
      const generated = files.find((f) => f.path === `src/${name}`)!.contents;
      const reference = readFileSync(join(repo, "crates/cfs-reference/src", name), "utf8").replace(/\r\n/g, "\n");
      expect(generated, `src/${name} differs; run npm run gen:reference`).toBe(reference);
    }
  });

  it("vendors the runtime crate", () => {
    const paths = generateProject(starterWorkspace()).map((f) => f.path);
    expect(paths).toContain("runtime/Cargo.toml");
    expect(paths).toContain("runtime/src/lib.rs");
    expect(paths).toContain("runtime/LICENSE");
  });

  it("drops disabled blocks and their parameters", () => {
    const files = generateProject(starterWorkspace());
    const search = files.find((f) => f.path === "src/search.rs")!.contents;
    expect(search).not.toContain("@block null_move_pruning");
    expect(search).toContain("@block quiescence");
    expect(generateParams(starterWorkspace())).not.toContain("NMP_");
  });

  it("emits the non-PVS fallback when PVS is not placed", () => {
    const ws = referenceWorkspace();
    ws.search.slots.move_loop = [];
    const search = generateProject(ws).find((f) => f.path === "src/search.rs")!.contents;
    expect(search).not.toContain("-alpha - 1");
  });

  it("round-trips the workspace", () => {
    const ws = referenceWorkspace();
    const json = generateProject(ws).find((f) => f.path === "workspace.json")!.contents;
    expect(JSON.parse(json)).toEqual(ws);
  });

  it("escapes engine names in Rust and TOML", () => {
    const ws = starterWorkspace();
    ws.engine.name = 'Quote " and \\ slash';
    expect(generateParams(ws)).toContain('"Quote \\" and \\\\ slash"');
    expect(generateCargoToml(ws)).toContain('name = "quote-and-slash"');
  });

  it("only uses known regions", () => {
    expect(enabledRegions(referenceWorkspace())).toEqual(new Set(KNOWN_REGIONS));
  });
});
