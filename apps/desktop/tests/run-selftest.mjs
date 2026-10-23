// Runs the debug desktop app with tests/selftest.js (on Linux without a
// screen, through xvfb-run). Exits with the app's exit code.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const exe = join(here, "..", "src-tauri", "target", "debug", process.platform === "win32" ? "chess-from-scratch.exe" : "chess-from-scratch");
const env = { ...process.env, CFS_SELFTEST: join(here, "selftest.js"), WEBKIT_DISABLE_DMABUF_RENDERER: "1" };
const headless = process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const r = headless
  ? spawnSync("xvfb-run", ["-a", "-s", "-screen 0 1600x1000x24", exe], { env, stdio: "inherit" })
  : spawnSync(exe, { env, stdio: "inherit" });
process.exit(r.status ?? 1);
