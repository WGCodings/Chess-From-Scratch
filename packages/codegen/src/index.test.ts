import { describe, expect, it } from "vitest";
import { generateCargoToml, toCrateName } from "./index";

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

describe("generateCargoToml", () => {
  it("depends on the vendored runtime crate", () => {
    const file = generateCargoToml({ name: "Pawnstar", author: "WG" });
    expect(file.path).toBe("Cargo.toml");
    expect(file.contents).toContain('name = "pawnstar"');
    expect(file.contents).toContain('cfs-runtime = { path = "runtime" }');
  });
});
