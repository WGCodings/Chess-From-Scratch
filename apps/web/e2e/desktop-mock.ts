// A fake desktop app for browser tests and screenshots: a pretend cargo, a
// pretend engine that answers UCI with a scripted game, a pretend fastchess.
// It runs inside the page (passed to addInitScript as source), so it must not
// use anything from outside its own body.

/** A fake desktop app: a pretend cargo and a pretend engine that answers UCI. */
export function desktopMock(): void {
  const calls: unknown[][] = [];
  type OnEvent = ((e: { kind: string; text: string }) => void) | null;
  const onEvent: OnEvent = null;
  let onTerm: ((d: string) => void) | null = null;
  const disk: Record<string, Uint8Array> = {};
  const engines: Record<string, { cb: (e: { kind: string; text: string }) => void; moves: number }> = {};
  let watchCb: ((lines: string[]) => void) | null = null;
  (window as unknown as { __calls: unknown[][] }).__calls = calls;
  (window as unknown as { __cfsDesktopMock: unknown }).__cfsDesktopMock = {
    defaultProjectDir: async (name: string) => `/data/engines/${name}`,
    writeProject: async (dir: string, files: { path: string }[]) => void calls.push(["write", dir, files.map((f) => f.path)]),
    rustVersion: async () => "cargo 1.90.0",
    buildEngine: async (dir: string, onLine: (l: string) => void) => {
      calls.push(["build", dir]);
      onLine("   Compiling cozy-chess v0.3.4");
      onLine("    Finished `release` profile [optimized] target(s)");
      return `${dir}/target/release/engine`;
    },
    startEngine: async (id: string, program: string, _dir: string, cb: typeof onEvent) => {
      calls.push(["start", program, id]);
      engines[id] = { cb: cb!, moves: 0 };
    },
    sendEngine: async (id: string, line: string) => {
      calls.push(["send", line, id]);
      const e = engines[id];
      if (!e) throw new Error("The engine is not running.");
      const say = (t: string) => setTimeout(() => e.cb({ kind: "line", text: t }), 5);
      if (line === "uci") (say("id name Mock"), say("uciok"));
      else if (line === "isready") say("readyok");
      else if (line.startsWith("position")) e.moves = (line.split(" moves ")[1] ?? "").split(" ").filter(Boolean).length;
      else if (line.startsWith("go")) {
        // A scripted game: Scholar's mate.
        const script = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];
        const move = script[e.moves] ?? "e2e4";
        say(`info depth 5 seldepth 7 score cp ${e.moves % 2 ? -20 : 25} nodes 12345 nps 500000 pv ${move}`);
        setTimeout(() => e.cb({ kind: "line", text: `bestmove ${move}` }), 40);
      }
    },
    stopEngine: async (id: string) => {
      calls.push(["stop", id]);
      delete engines[id];
    },
    openTerminal: async (dir: string, _c: number, _r: number, cb: (d: string) => void) => {
      calls.push(["term", dir]);
      onTerm = cb;
      cb(`${dir}$ `);
      return 1;
    },
    writeTerminal: async (_id: number, data: string) => onTerm?.(data === "\r" ? "\r\n" : data),
    resizeTerminal: async () => {},
    closeTerminal: async () => {},
    revealFolder: async (dir: string) => void calls.push(["reveal", dir]),
    openUrl: async (url: string) => void calls.push(["url", url]),
    pickFolder: async () => null,
    pickSaveFile: async (name: string) => `/home/me/${name}`,
    pickOpenFile: async () => "/home/me/my-engine.cfs",
    writeFile: async (path: string, data: Uint8Array) => {
      calls.push(["writeFile", path, data.length]);
      disk[path] = data;
    },
    findFastchess: async () => (disk["fastchess"] ? "/tools/fastchess" : null),
    installFastchess: async (onLine: (l: string) => void) => {
      onLine("Downloading fastchess");
      disk["fastchess"] = new Uint8Array(1);
      calls.push(["installFastchess"]);
      return "/tools/fastchess";
    },
    getBook: async (file: string) => {
      calls.push(["getBook", file]);
      return `/tools/books/${file}`;
    },
    runBench: async (program: string) => {
      calls.push(["bench", program]);
      return program.includes("renamed") ? "40000 nodes 800000 nps" : "35000 nodes 700000 nps";
    },
    startTest: async (program: string, args: string[], _dir: string, cb: (e: { kind: string; text: string }) => void) => {
      calls.push(["startTest", program, args]);
      const lines = [
        "Started game 1 of 200 (a vs b)",
        "Results of a vs b (5+0.05, 1t, 16MB, UHO_4060_v2.epd):",
        "Elo: 30.10 +/- 12.40, nElo: 40.00 +/- 15.00",
        "Games: 120, Wins: 50, Losses: 40, Draws: 30, Points: 65.0 (54.17 %)",
        "Ptnml(0-2): [5, 10, 20, 15, 10], WL/DD Ratio: 0.50",
        "LLR: 1.20 (40.8%) (-2.94, 2.94) [0.00, 10.00]",
        "Elo: 28.00 +/- 10.00, nElo: 38.00 +/- 13.00",
        "Games: 200, Wins: 80, Losses: 64, Draws: 56, Points: 108.0 (54.00 %)",
        "Ptnml(0-2): [8, 16, 34, 26, 16], WL/DD Ratio: 0.50",
        "LLR: 2.95 (100.2%) (-2.94, 2.94) [0.00, 10.00]",
        "SPRT ([0.00, 10.00]) completed - H1 was accepted",
      ];
      lines.forEach((text, i) => setTimeout(() => cb({ kind: "line", text }), 250 * (i + 1)));
      // With watching on, the engine log shows two games being played.
      if (args.some((a) => a === "-log")) {
        const log = (t: string, n: string, msg: string) => `[Engine] [t] <     ${t}>  ${n} <--- ${msg}`;
        const steps = [
          [log("1", "a", "position startpos moves e2e4 e7e5"), log("2", "b", "position startpos moves d2d4")],
          [log("1", "a", "go wtime 9000 btime 9000 winc 100 binc 100"), log("1", "b", "position startpos moves e2e4 e7e5 g1f3")],
        ];
        steps.forEach((lines, i) => setTimeout(() => watchCb?.(lines), 100 + 150 * i));
      }
      setTimeout(() => cb({ kind: "exit", text: "fastchess finished." }), 250 * (lines.length + 2));
    },
    stopTest: async () => void calls.push(["stopTest"]),
    watchGames: async (path: string, cb: (lines: string[]) => void) => {
      calls.push(["watch", path]);
      watchCb = cb;
    },
    stopWatching: async () => {
      calls.push(["stopWatching"]);
      watchCb = null;
    },
    readFile: async (path: string) => {
      if (!disk[path]) throw new Error(`no file ${path}`);
      return disk[path];
    },
  };
}
