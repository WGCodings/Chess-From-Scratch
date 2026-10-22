import { describe, expect, it } from "vitest";
import { codeToBlocks, generateProject, validate, viewOf } from "./index";
import { runScenario, scenarios } from "./scenarios";

describe("user scenarios", () => {
  for (const s of scenarios()) {
    it(s.name, () => {
      const { result, ws } = runScenario(s);
      if (s.errors) {
        expect(result.errors.map((e) => e.message)).toEqual(s.errors.map((e) => expect.stringMatching(e)));
        return;
      }
      expect(result.errors).toEqual([]);
      s.expect?.(result, ws);
      // Every block file it made is valid.
      expect(validate(ws).filter((i) => i.level === "error").map((i) => i.message)).toEqual([]);
      const files = generateProject(ws);

      if (!s.edits) return;
      const before = generateProject(s.start());
      for (const [path, fn] of Object.entries(s.edits)) {
        const original = viewOf(before.find((f) => f.path === path)!).lines;
        const edited = [...original];
        fn(edited);
        // What you typed is what you get: every new line shows up in the regenerated file.
        const now = viewOf(files.find((f) => f.path === path)!).lines.map((l) => l.trim());
        const typed = edited.filter((l) => !original.includes(l) && l.trim() !== "");
        for (const line of typed) expect(now, `${path}: ${line}`).toContain(line.trim());
      }
      // Saving again without changes changes nothing.
      const again = codeToBlocks(
        ws,
        files,
        Object.keys(s.edits).map((path) => ({ path, text: viewOf(files.find((f) => f.path === path)!).lines.join("\n") })),
      );
      expect(again).toEqual({ sources: {}, created: [], forks: [], errors: [] });
    });
  }
});
