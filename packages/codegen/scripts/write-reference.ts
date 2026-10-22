// Regenerates crates/cfs-reference/src from the templates using the
// reference workspace (every block, default parameters).
//
//   npm run gen:reference -w @cfs/codegen

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateProject, referenceWorkspace } from "../src/index";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const target = join(repo, "crates", "cfs-reference");

for (const file of generateProject(referenceWorkspace())) {
  if (file.path.startsWith("src/")) {
    writeFileSync(join(target, file.path), file.contents);
    console.log(`wrote crates/cfs-reference/${file.path}`);
  }
}
