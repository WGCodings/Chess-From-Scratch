// Regenerates crates/cfs-reference/src from the templates using the
// reference workspace (every block, default parameters), keeping the unit
// tests so `cargo test` covers all template code.
//
//   npm run gen:reference -w @cfs/codegen

import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateProject, referenceWorkspace } from "../src/index";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const target = join(repo, "crates", "cfs-reference");

const files = generateProject(referenceWorkspace(), { includeTests: true }).filter((f) =>
  f.path.startsWith("src/"),
);
const keep = new Set(files.map((f) => f.path));
for (const name of readdirSync(join(target, "src"))) {
  if (!keep.has(`src/${name}`)) rmSync(join(target, "src", name));
}
for (const file of files) {
  writeFileSync(join(target, file.path), file.contents);
  console.log(`wrote crates/cfs-reference/${file.path}`);
}
