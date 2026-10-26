// Makes the pictures and GIFs in the README (docs/media) from the real
// editor, with a fake desktop so Run, Tests and Play work without cargo:
//
//   npm run media -w @cfs/web
//
// Needs Chrome (or CHROMIUM_PATH) and ffmpeg on PATH for the GIFs.

import { createServer } from "vite";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { Chess } from "chess.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopMock } from "../e2e/desktop-mock";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "..", "..", "docs", "media");
mkdirSync(out, { recursive: true });
const only = process.argv[2];

const server = await createServer({ root, logLevel: "error", server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls!.local[0]!;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chrome" });
const VIEW = { width: 1440, height: 860 };

// Data for the fake engines: a real opening for Play, and games for the live boards.
const toUci = (sans: string[]) => {
  const c = new Chess();
  return sans.map((s) => {
    const m = c.move(s);
    return `${m.from}${m.to}${m.promotion ?? ""}`;
  });
};
const RUY = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 Nbd2 Bb7 Bc2 Re8 Nf1 Bf8 Ng3 g6 a4 c5 d5 c4 Bg5 h6 Be3 Nc5 Qd2 h5 Bg5 Be7".split(" ");
const OPENINGS = [
  "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6",
  "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7",
  "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7 f4 O-O Nf3 c5",
  "c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3 O-O",
  "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O",
  "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5",
  "Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3 Nbd7 Nbd2 e5 e4 dxe4 dxe4 Bc5",
  "e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 cxd4 Nxd4 Ne7 c4 Nbc6",
].map((o) => {
  // Each opening, then more legal moves picked with a fixed seed, so every board keeps moving.
  const c = new Chess();
  for (const s of o.split(" ")) c.move(s);
  let seed = o.length;
  while (c.history().length < 70 && !c.isGameOver()) {
    const moves = c.moves({ verbose: true });
    const caps = moves.filter((m) => m.captured);
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const pool = caps.length && seed % 3 === 0 ? caps : moves;
    c.move(pool[seed % pool.length]!);
  }
  return c.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ""}`);
});
const DATA = { ruy: toUci(RUY), live: OPENINGS };

/** Runs after the fake desktop: longer games, a realistic test, moving live boards. */
function mediaMock(data: { ruy: string[]; live: string[][] }): void {
  const d = (window as unknown as { __cfsDesktopMock: Record<string, unknown> }).__cfsDesktopMock;
  const engines: Record<string, { cb: (e: { kind: string; text: string }) => void; moves: number }> = {};
  let watch: ((lines: string[]) => void) | null = null;
  d.startEngine = async (id: string, _p: string, _d: string, cb: (e: { kind: string; text: string }) => void) => {
    engines[id] = { cb, moves: 0 };
  };
  d.stopEngine = async (id: string) => void delete engines[id];
  d.sendEngine = async (id: string, line: string) => {
    const e = engines[id];
    if (!e) return;
    const say = (t: string, ms = 5) => setTimeout(() => e.cb({ kind: "line", text: t }), ms);
    if (line === "uci") (say("id name My Engine"), say("id author me"), say("option name Threads type spin default 1 min 1 max 1"), say("uciok"));
    else if (line === "isready") say("readyok");
    else if (line.startsWith("position")) e.moves = (line.split(" moves ")[1] ?? "").split(" ").filter(Boolean).length;
    else if (line.startsWith("go")) {
      const n = e.moves;
      const move = data.ruy[n] ?? data.ruy[data.ruy.length - 1]!;
      const cp = Math.round(20 + 12 * Math.sin(n / 3) + n * 1.5) * (n % 2 ? -1 : 1);
      const pv = data.ruy.slice(n, n + 6).join(" ");
      say(`info depth ${8 + (n % 4)} seldepth ${13 + (n % 5)} score cp ${cp} nodes ${180000 + n * 9137} nps 1450000 pv ${pv}`, 200);
      say(`bestmove ${move}`, 650);
    }
  };
  d.watchGames = async (_path: string, cb: (lines: string[]) => void) => void (watch = cb);
  d.stopWatching = async () => void (watch = null);
  let testNo = 0;
  d.startTest = async (_program: string, args: string[], _dir: string, cb: (e: { kind: string; text: string }) => void) => {
    const watching = args.includes("-log");
    // Each next change gains less, as in real engine work.
    const target = [46, 31, 19, 12][testNo++ % 4]!;
    const steps = 42;
    let pentaTotal = [0, 0, 0, 0, 0];
    for (let k = 1; k <= steps; k++) {
      setTimeout(() => {
        const games = k * 20;
        const elo = target + (30 / Math.sqrt(k)) * Math.sin(k * 1.7);
        const err = 260 / Math.sqrt(games / 2);
        const llr = Math.min(2.96, k * 0.0705 + 0.08 * Math.sin(k + target));
        const w = Math.round(games * (0.355 + target / 700));
        const l = Math.round(games * (0.355 - target / 700));
        pentaTotal = [Math.round(k * 0.6), Math.round(k * 1.6), Math.round(k * 3.4), Math.round(k * 2.6), Math.round(k * 1.8)];
        const lines = [
          `Results of new vs base (5+0.05, 1t, 16MB, UHO_4060_v2.epd):`,
          `Elo: ${elo.toFixed(2)} +/- ${err.toFixed(2)}, nElo: ${(elo * 1.3).toFixed(2)} +/- ${(err * 1.3).toFixed(2)}`,
          `Games: ${games}, Wins: ${w}, Losses: ${l}, Draws: ${games - w - l}, Points: 0 (0 %)`,
          `Ptnml(0-2): [${pentaTotal.join(", ")}], WL/DD Ratio: 0.50`,
          `LLR: ${llr.toFixed(2)} (${((llr / 2.94) * 100).toFixed(1)}%) (-2.94, 2.94) [0.00, 10.00]`,
        ];
        for (const text of lines) cb({ kind: "line", text });
        if (k === steps) {
          cb({ kind: "line", text: "SPRT ([0.00, 10.00]) completed - H1 was accepted" });
          setTimeout(() => cb({ kind: "exit", text: "fastchess finished." }), 50);
        }
      }, (watching ? 400 : 120) * k);
    }
    if (watching) {
      const names = ["new", "base"];
      let ply = 8;
      const tick = setInterval(() => {
        if (!watch) return clearInterval(tick);
        ply++;
        const lines: string[] = [];
        data.live.forEach((g, i) => {
          const n = Math.min(ply - (i % 3), g.length);
          const who = names[(n + i) % 2]!;
          lines.push(`[Engine] [t] <     ${1000 + i}>  ${who} <--- position startpos moves ${g.slice(0, n).join(" ")}`);
          const t = Math.max(500, 9000 - n * 90 - i * 300);
          lines.push(`[Engine] [t] <     ${1000 + i}>  ${who} <--- go wtime ${t} btime ${t - 400} winc 50 binc 50`);
        });
        watch(lines);
      }, 260);
    }
  };
}

async function context(video = false): Promise<BrowserContext> {
  const dir = video ? mkdtempSync(join(tmpdir(), "cfs-video-")) : undefined;
  const ctx = await browser.newContext({ viewport: VIEW, ...(dir ? { recordVideo: { dir, size: VIEW } } : {}) });
  await ctx.addInitScript(() => localStorage.setItem("cfs.tutorial.seen", "1"));
  await ctx.addInitScript(`var __name = (f) => f; (${desktopMock.toString()})();`);
  await ctx.addInitScript(`var __name = (f) => f; (${mediaMock.toString()})(${JSON.stringify(DATA)});`);
  return ctx;
}

async function open(ctx: BrowserContext): Promise<Page> {
  const p = await ctx.newPage();
  p.on("dialog", (d) => void d.accept());
  await p.goto(url);
  await p.waitForSelector(".blocklyToolboxCategory");
  await p.waitForTimeout(400);
  return p;
}

const template = async (p: Page, name: string) => {
  await p.click("#menu-btn");
  await p.click("#template-toggle");
  await p.click(`#menu [data-template="${name}"]`);
  await p.waitForTimeout(700);
};

/** Connects a new block under a parent block's input, as if dragged there. */
const place = (p: Page, type: string, parent: string, input: string) =>
  p.evaluate(
    ([t, par, inp]) => {
      const bw = (window as unknown as { __cfsWorkspace: import("blockly").WorkspaceSvg }).__cfsWorkspace;
      const host = bw.getBlocksByType(par!, false)[0]!;
      const b = bw.newBlock(t!) as import("blockly").BlockSvg;
      b.initSvg();
      b.render();
      let conn = host.getInput(inp!)!.connection!;
      while (conn.targetBlock()) conn = conn.targetBlock()!.nextConnection!;
      conn.connect(b.previousConnection!);
      b.select();
    },
    [type, parent, input],
  );

/** Turns a recording into a GIF: `from` seconds in, `length` seconds long. */
function gif(video: string, name: string, from: number, length: number, width = 1100): void {
  const target = join(out, name);
  const filter = `fps=8,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(from), "-t", String(length), "-i", video, "-vf", filter, target]);
  console.log(`${name}: ${(statSync(target).size / 1e6).toFixed(1)} MB`);
}

async function record(name: string, work: (p: Page, mark: () => number) => Promise<{ from: number; length: number; width?: number }>): Promise<void> {
  if (only && !name.includes(only)) return;
  const ctx = await context(true);
  // The video starts with the page.
  const t0 = Date.now();
  const p = await open(ctx);
  const r = await work(p, () => (Date.now() - t0) / 1000);
  const video = await p.video()!.path();
  await ctx.close();
  gif(video, name, r.from, r.length, r.width);
  rmSync(dirname(video), { recursive: true, force: true });
}

async function shot(name: string, work: (p: Page) => Promise<void>, clip?: string): Promise<void> {
  if (only && !name.includes(only)) return;
  const ctx = await context();
  const p = await open(ctx);
  await work(p);
  await p.addStyleTag({ content: "#toast { display: none !important; }" });
  await p.mouse.move(0, VIEW.height - 1);
  if (clip) await p.locator(clip).screenshot({ path: join(out, name) });
  else await p.screenshot({ path: join(out, name) });
  console.log(`${name}: ${(statSync(join(out, name)).size / 1e6).toFixed(2)} MB`);
  await ctx.close();
}

// 1. Blocks and code: each block placed shows the code it adds.
await record("blocks.gif", async (p, mark) => {
  await template(p, "starter");
  await p.addStyleTag({ content: "#toast { display: none !important; }" });
  await p.locator('.tree-file[data-path="src/search.rs"]').click();
  await p.waitForTimeout(600);
  const from = mark();
  await place(p, "cfs_eval_material", "cfs_hce", "TERMS");
  await p.waitForTimeout(2600);
  await place(p, "cfs_search_iterative_deepening", "cfs_negamax", "ROOT");
  await p.waitForTimeout(2600);
  await place(p, "cfs_search_alpha_beta", "cfs_negamax", "MOVE_LOOP");
  await p.waitForTimeout(2600);
  await place(p, "cfs_search_mvv_lva", "cfs_negamax", "ORDERING");
  await p.waitForTimeout(2800);
  return { from: from + 0.3, length: mark() - from - 0.3 };
});

// 2. A test with the games watched live.
await record("tests-live.gif", async (p, mark) => {
  await template(p, "starter");
  await place(p, "cfs_search_iterative_deepening", "cfs_negamax", "ROOT");
  await p.click("#branch-btn");
  await p.fill(".br-new input", "+ alpha-beta");
  await p.locator(".br-new button").click();
  await p.keyboard.press("Escape");
  await place(p, "cfs_search_alpha_beta", "cfs_negamax", "MOVE_LOOP");
  await p.waitForTimeout(500);
  await p.click("#tests-btn");
  await p.locator('.ts-preset[data-preset="quick"]').click();
  await p.locator(".ts-watch input").check();
  await p.addStyleTag({ content: "#toast { display: none !important; }" });
  await p.click(".ts-start");
  // Start the GIF once the boards and the first results are there.
  await p.waitForFunction(() => document.querySelectorAll(".lg-card").length >= 6);
  await p.waitForTimeout(1200);
  const from = mark();
  await p.waitForTimeout(8000);
  return { from, length: mark() - from };
});

// 3. Tests: three changes tested one after the other, the first two kept.
await shot("tests.png", async (p) => {
  await template(p, "starter");
  await place(p, "cfs_search_iterative_deepening", "cfs_negamax", "ROOT");
  await place(p, "cfs_eval_material", "cfs_hce", "TERMS");
  await p.waitForTimeout(400);
  const steps: [string, string, string][] = [
    ["+ alpha-beta", "cfs_search_alpha_beta", "MOVE_LOOP"],
    ["+ mvv-lva", "cfs_search_mvv_lva", "ORDERING"],
    ["+ killers", "cfs_search_killers", "ORDERING"],
  ];
  for (const [k, [name, type, input]] of steps.entries()) {
    await p.click("#engine-btn");
    await p.click("#branch-btn");
    await p.fill(".br-new input", name);
    await p.locator(".br-new button").click();
    await p.keyboard.press("Escape");
    await place(p, type, "cfs_negamax", input);
    await p.waitForTimeout(300);
    await p.click("#tests-btn");
    await p.locator('.ts-preset[data-preset="quick"]').click();
    await p.click(".ts-start");
    await p.waitForSelector(".ts-run .ts-badge.ts-passed", { timeout: 20000 });
    if (k < steps.length - 1) {
      await p.click(".ts-keep");
      await p.locator(".br .keep-confirm").click();
      await p.waitForTimeout(300);
      await p.keyboard.press("Escape");
    }
  }
  await p.click("#tests-btn");
  await p.waitForTimeout(500);
});

// 4. Playing a branch: board, clocks, what the engine thinks.
await shot("play.png", async (p) => {
  await template(p, "starter");
  await place(p, "cfs_search_iterative_deepening", "cfs_negamax", "ROOT");
  await p.click("#branch-btn");
  await p.fill(".br-new input", "+ alpha-beta");
  await p.locator(".br-new button").click();
  await p.keyboard.press("Escape");
  await place(p, "cfs_search_alpha_beta", "cfs_negamax", "MOVE_LOOP");
  await p.evaluate(() =>
    localStorage.setItem("cfs.play.setup", JSON.stringify({ mode: "engines", white: "main", black: "alpha-beta", time: { kind: "clock", minutes: 3, increment: 2 }, fen: "" })),
  );
  await p.click("#play-btn");
  await p.click(".pl-start");
  await p.waitForFunction(() => document.querySelectorAll(".pl-san").length >= 27, undefined, { timeout: 40000 });
  await p.waitForTimeout(250);
});

// 5. Keep: every changed line, like git diff.
await shot(
  "keep-diff.png",
  async (p) => {
    await template(p, "starter");
    await p.click("#branch-btn");
    await p.fill(".br-new input", "+ alpha-beta");
    await p.locator(".br-new button").click();
    await p.keyboard.press("Escape");
    await place(p, "cfs_search_alpha_beta", "cfs_negamax", "MOVE_LOOP");
    await p.waitForTimeout(600);
    await p.click("#branch-btn");
    await p.locator('.br-item[data-branch="alpha-beta"] .keep').click();
    await p.waitForSelector(".br-review .cd-file");
    // Show the search file first, with its changes.
    await p.evaluate(() => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>(".br-review .cd-file")) d.open = (d.querySelector(".cd-path")?.textContent ?? "").includes("search.rs");
    });
    await p.waitForTimeout(300);
  },
  ".br",
);

// 6. Run: the engine answering UCI in the console.
await shot("run.png", async (p) => {
  await template(p, "starter");
  await place(p, "cfs_search_iterative_deepening", "cfs_negamax", "ROOT");
  await place(p, "cfs_eval_material", "cfs_hce", "TERMS");
  await p.waitForTimeout(500);
  await p.click("#run-btn");
  await p.waitForSelector("#dock .out-engine:has-text('uciok')");
  await p.locator("#dock .dock-chip", { hasText: "go depth" }).click();
  await p.waitForSelector("#dock .out-engine:has-text('bestmove')");
  await p.locator(".tour .tour-x, .tour button[title*='Close'], .tour .tour-close").first().click().catch(() => undefined);
  await p.locator('.tree-file[data-path="src/search.rs"]').click();
});

await browser.close();
await server.close();
