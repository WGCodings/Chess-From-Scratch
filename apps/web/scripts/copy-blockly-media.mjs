// Copies Blockly's UI media (cursors, trashcan sprite, sounds) next to the app
// so the editor never fetches it from Google's CDN at runtime.
import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const blocklyDir = dirname(require.resolve("blockly"));
const here = dirname(fileURLToPath(import.meta.url));
cpSync(join(blocklyDir, "media"), join(here, "..", "public", "blockly-media"), { recursive: true });
