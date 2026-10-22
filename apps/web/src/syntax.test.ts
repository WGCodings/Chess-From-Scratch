import { describe, expect, it } from "vitest";
import { EXAMPLE_BLOCKS, generateProject, referenceWorkspace } from "@cfs/codegen";
import { rustSyntaxErrors } from "./syntax";

describe("rustSyntaxErrors", () => {
  it("accepts every generated file of the reference engine plus the examples", () => {
    const ws = referenceWorkspace();
    ws.customBlocks = { ...EXAMPLE_BLOCKS };
    ws.search.slots.extensions.push({ type: "check_extension", params: {} });
    ws.search.slots.ordering.push({ type: "cutoff_table", params: {} });
    ws.eval.terms.push({ type: "tempo", params: {} });
    for (const f of generateProject(ws).filter((f) => f.path.endsWith(".rs") && !f.path.startsWith("blocks/"))) {
      expect(rustSyntaxErrors(f.contents), f.path).toEqual([]);
    }
  });
  it("finds a missing brace and a broken statement", () => {
    expect(rustSyntaxErrors("fn a() {\n    let x = ;\n}\n")[0]?.line).toBe(1);
    expect(rustSyntaxErrors("fn a() {\n    if x {\n}\n").length).toBeGreaterThan(0);
  });
});
