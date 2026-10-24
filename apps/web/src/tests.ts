// The Tests panel: play two branches against each other with fastchess until
// an SPRT decides, see which changes were measured, then keep or delete the
// branch. The timeline of all tests is saved with the workbench, so it can
// be read on the website too; running tests needs the desktop app.

import {
  BOOKS,
  PRESETS,
  branchList,
  checkTestOptions,
  defaultTestOptions,
  describeChanges,
  diffWorkspaces,
  emptyProgress,
  eloTimeline,
  fastchessArgs,
  formatElo,
  readFastchessLine,
  saveTest,
  statusOf,
  type BuiltinBookId,
  type PresetId,
  type TestOptions,
  type TestRecord,
  type Workbench,
  type Workspace,
} from "@cfs/codegen";
import { DESKTOP_DOWNLOAD_URL, desktop } from "./platform";
import { lineChart, pentaChart } from "./charts";
import { diffText, renderDiff, workspaceDiff } from "./codediff";
import { preserving } from "./ui";
import { buildBranch, ignoresClock } from "./build";
import { LiveGamesView } from "./livegames";

export { projectName, ignoresClock } from "./build";

export interface TestsHost {
  workbench(): Workbench;
  /** Stores the editor's latest state in the open branch. */
  sync(): void;
  /** The workbench changed: save it. */
  changed(): void;
  toast(message: string): void;
  /** Opens the Keep review of a branch (the Branches panel). */
  keepBranch(id: string): void;
  /** Asks, then deletes a branch (the Branches panel). */
  deleteBranch(id: string): void;
  /** The Tests view was shown (true) or hidden (false): the editor hides or shows itself. */
  shown(visible: boolean): void;
}

const OPTIONS_KEY = "cfs.test.options";
const CHART_KEY = "cfs.test.eloChart";
const WATCH_KEY = "cfs.test.watch";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, title: string, cls = "btn"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.title = title;
  return b;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

function loadOptions(): TestOptions {
  const base = defaultTestOptions(typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2);
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<TestOptions> | null;
    return saved ? { ...base, ...saved, sprt: { ...base.sprt, ...saved.sprt } } : base;
  } catch {
    return base;
  }
}

function storeOptions(o: TestOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o));
  } catch {
    /* convenience */
  }
}

/** Fastchess names: no spaces, and never the same for both. */
function engineName(name: string, other?: string): string {
  const n = name.replace(/[^\w+.-]+/g, "_").replace(/^_+|_+$/g, "") || "engine";
  return n === other ? `${n}_base` : n;
}

const STATUS_TEXT: Record<TestRecord["status"], string> = {
  running: "running",
  passed: "passed",
  failed: "failed",
  stopped: "no result",
  error: "error",
};

export class TestsPanel {
  private readonly body: HTMLElement;
  private options = loadOptions();
  private newId = "";
  private baseId = "";
  /** The test being run now (also in the workbench). */
  private run: TestRecord | null = null;
  /** The test shown on its own page (from the timeline), by id. */
  private viewing: string | null = null;
  private step = "";
  private log: string[] = [];
  private stopping = false;
  private renderTimer: number | undefined;
  private saveTimer = 0;
  /** The boards of the running test, when watching. */
  private live: LiveGamesView | null = null;
  private watch = readFlag(WATCH_KEY, false);

  constructor(
    private readonly root: HTMLElement,
    private readonly host: TestsHost,
  ) {
    root.classList.add("tests-view");
    root.hidden = true;
    this.body = el("div", "ts-page");
    root.append(this.body);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get running(): boolean {
    return this.run?.status === "running";
  }

  open(): void {
    this.host.sync();
    if (!this.running) {
      this.options = loadOptions();
      this.watch = readFlag(WATCH_KEY, false);
    }
    if (this.root.hidden) {
      this.root.hidden = false;
      this.host.shown(true);
    }
    this.render();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.host.shown(false);
  }

  refresh(): void {
    if (this.isOpen) this.render();
  }

  /** Shows one test on its own page. */
  show(id: string | null): void {
    this.viewing = id;
    this.open();
    this.root.scrollTop = 0;
  }

  private scheduleRender(): void {
    if (!this.isOpen || this.renderTimer !== undefined) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = undefined;
      this.render();
    }, 250);
  }

  private render(): void {
    // Redraws keep what the user opened (details, logs) as it was.
    preserving(this.body, () => this.draw());
  }

  private draw(): void {
    const wb = this.host.workbench();
    this.body.replaceChildren();
    this.body.classList.remove("ts-detail-page");
    const viewed = this.viewing ? (this.viewing === this.run?.id ? this.run : wb.tests?.find((t) => t.id === this.viewing)) : null;
    if (viewed) {
      const back = button("← All tests", "Back to the tests and the timeline", "btn ts-back");
      back.addEventListener("click", () => this.show(null));
      this.body.append(back, this.renderDetail(wb, viewed));
      this.body.classList.add("ts-detail-page");
      return;
    }
    const head = el("div", "ts-head");
    head.append(el("h2", undefined, "Tests"));
    head.append(
      el(
        "p",
        "br-lead",
        "Is a change really better? The two versions play many fast games against each other until the result is clear (an SPRT, as OpenBench does). Then keep the branch or delete it.",
      ),
    );
    this.body.append(head);
    // Wide screens: the test and the form on the left, the timeline beside them.
    const main = el("div", "ts-main");
    if (this.run) main.append(this.renderDetail(wb, this.run));
    if (!this.running) main.append(this.renderNew(wb));
    const side = el("div", "ts-side");
    side.append(this.renderTimeline(wb));
    const cols = el("div", "ts-cols");
    cols.append(main, side);
    this.body.append(cols);
  }

  // New test ----------------------------------------------------------------------------------

  private renderNew(wb: Workbench): HTMLElement {
    const card = el("section", "ts-card ts-new");
    card.append(el("h3", undefined, "New test"));
    if (!desktop) {
      const box = el("div", "dock-notice ts-notice");
      box.innerHTML = `<p><b>Running tests needs the desktop app.</b> It builds both versions, gets fastchess and an opening book for you, and plays the games on your computer. The timeline below is saved with your project, so you can read it here too.</p>`;
      const a = el("a", "btn primary", "Get the desktop app");
      a.href = DESKTOP_DOWNLOAD_URL;
      a.target = "_blank";
      a.rel = "noopener";
      box.append(a);
      card.append(box);
      return card;
    }
    const branches = branchList(wb);
    if (branches.length < 2) {
      card.append(el("p", "br-hint", "A test plays two branches against each other. Open ⑂ Branches and clone your engine first, then change the copy."));
      return card;
    }
    if (!wb.branches[this.newId] || this.newId === this.baseId) {
      this.newId = wb.current !== wb.main ? wb.current : (branches.find((b) => b.id !== wb.main)?.id ?? "");
    }
    if (!wb.branches[this.baseId] || this.baseId === this.newId) this.baseId = wb.main !== this.newId ? wb.main : (branches.find((b) => b.id !== this.newId)?.id ?? "");

    const pick = (label: string, value: string, set: (v: string) => void, cls: string) => {
      const l = el("label", `ts-field ${cls}`);
      l.append(el("span", undefined, label));
      const s = el("select");
      for (const b of branches) {
        const o = el("option", undefined, b.name);
        o.value = b.id;
        o.selected = b.id === value;
        s.append(o);
      }
      s.addEventListener("change", () => {
        set(s.value);
        this.render();
      });
      l.append(s);
      return l;
    };
    const row = el("div", "ts-row");
    row.append(
      pick("New version", this.newId, (v) => (this.newId = v), "ts-new-branch"),
      el("span", "ts-vs", "against"),
      pick("Base version", this.baseId, (v) => (this.baseId = v), "ts-base-branch"),
    );
    card.append(row);

    const a = wb.branches[this.baseId]?.workspace;
    const b = wb.branches[this.newId]?.workspace;
    if (a && b) {
      const changes = describeChanges(diffWorkspaces(a, b));
      const what = el("div", "ts-what");
      what.append(el("strong", undefined, changes.length ? "What is tested:" : "These two versions are the same."));
      if (changes.length) {
        const ul = el("ul", "br-changes");
        for (const c of changes) ul.append(el("li", undefined, c));
        what.append(ul);
      }
      card.append(what);
      const slow = [
        [this.newId, b],
        [this.baseId, a],
      ].filter(([, ws]) => ignoresClock(ws as Workspace)).map(([id]) => wb.branches[id as string]!.name);
      if (slow.length) {
        card.append(
          el("p", "br-warn ts-clock", `${slow.map((n) => `"${n}"`).join(" and ")} ${slow.length > 1 ? "have" : "has"} no Iterative deepening: a fixed-depth search ignores the clock and loses games on time. Add Iterative deepening to both versions first.`),
        );
      }
    }

    // Presets and options.
    const presets = el("div", "ts-presets");
    for (const [id, p] of Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]) {
      const active = p.options.tc === this.options.tc && JSON.stringify(p.options.sprt) === JSON.stringify(this.options.sprt);
      const chip = button(p.label, p.description, `ts-preset${active ? " active" : ""}`);
      chip.dataset.preset = id;
      chip.addEventListener("click", () => {
        this.options = { ...this.options, ...p.options };
        storeOptions(this.options);
        this.render();
      });
      presets.append(chip);
    }
    card.append(presets);
    const activePreset = Object.values(PRESETS).find((p) => p.options.tc === this.options.tc && JSON.stringify(p.options.sprt) === JSON.stringify(this.options.sprt));
    card.append(el("p", "br-hint", activePreset ? activePreset.description : "Your own settings."));

    const grid = el("div", "ts-grid");
    const field = (label: string, title: string, input: HTMLElement) => {
      const l = el("label", "ts-field");
      l.title = title;
      l.append(el("span", undefined, label), input);
      grid.append(l);
    };
    const text = (value: string, on: (v: string) => void, cls = "") => {
      const i = el("input", cls);
      i.value = value;
      i.addEventListener("change", () => {
        on(i.value);
        storeOptions(this.options);
        this.render();
      });
      return i;
    };
    const number = (value: number, on: (v: number) => void, step = "1") => {
      const i = text(String(value), (v) => on(Number(v)));
      i.type = "number";
      i.step = step;
      return i;
    };
    field("Time control", "Seconds per game + seconds added per move", text(this.options.tc, (v) => (this.options.tc = v), "ts-tc"));
    field("Games at once", "Concurrency: how many games run at the same time (one per processor core is the most)", number(this.options.concurrency, (v) => (this.options.concurrency = v)));
    field("Hash (MB)", "Transposition table size for engines that have one", number(this.options.hash, (v) => (this.options.hash = v)));
    field("Threads", "Threads per engine", number(this.options.threads, (v) => (this.options.threads = v)));
    field("Max games", "Stop here even without a result", number(this.options.maxGames, (v) => (this.options.maxGames = v)));
    const book = el("select");
    for (const [id, bk] of Object.entries(BOOKS)) {
      const o = el("option", undefined, `${bk.label}, ${bk.size}`);
      o.value = id;
      o.selected = this.options.book.kind === "builtin" && this.options.book.id === id;
      book.append(o);
    }
    const own = el("option", undefined, this.options.book.kind === "file" ? `Your book: ${this.options.book.path.split(/[\\/]/).pop()}` : "Your own book…");
    own.value = "file";
    own.selected = this.options.book.kind === "file";
    const none = el("option", undefined, "No book (not recommended)");
    none.value = "none";
    none.selected = this.options.book.kind === "none";
    book.append(own, none);
    book.addEventListener("change", async () => {
      if (book.value === "file") {
        const path = await desktop!.pickOpenFile({ name: "Opening book", extensions: ["epd", "pgn"] });
        if (path) this.options.book = { kind: "file", path };
      } else if (book.value === "none") this.options.book = { kind: "none" };
      else this.options.book = { kind: "builtin", id: book.value as BuiltinBookId };
      storeOptions(this.options);
      this.render();
    });
    field("Opening book", "Every game pair starts from a random opening, played once with each color", book);
    card.append(grid);

    const watch = el("label", "ts-watch");
    const box = el("input");
    box.type = "checkbox";
    box.checked = this.watch;
    box.addEventListener("change", () => {
      this.watch = box.checked;
      writeFlag(WATCH_KEY, this.watch);
      this.render();
    });
    watch.append(box, el("span", undefined, "Watch the games live, one board per game"));
    card.append(watch);
    if (this.watch) {
      card.append(
        el(
          "p",
          "br-warn ts-watchwarn",
          "Watching costs speed: fastchess writes every engine message to a log for the boards, and drawing many boards keeps your computer busy. Results stay valid, but the test runs slower; with many games at once it can cause time losses at very short time controls.",
        ),
      );
    }

    const adv = el("details", "ts-adv");
    adv.dataset.key = "adv";
    adv.append(el("summary", undefined, `SPRT bounds [${this.options.sprt.elo0}, ${this.options.sprt.elo1}], alpha ${this.options.sprt.alpha}, beta ${this.options.sprt.beta}; adjudication ${this.options.adjudicate ? "on" : "off"}`));
    const grid2 = el("div", "ts-grid");
    const f2 = (label: string, title: string, input: HTMLElement) => {
      const l = el("label", "ts-field");
      l.title = title;
      l.append(el("span", undefined, label), input);
      grid2.append(l);
    };
    f2("elo0", "H0: the new version is not better than this (normalized Elo)", number(this.options.sprt.elo0, (v) => (this.options.sprt = { ...this.options.sprt, elo0: v }), "0.5"));
    f2("elo1", "H1: the new version is better by at least this (normalized Elo)", number(this.options.sprt.elo1, (v) => (this.options.sprt = { ...this.options.sprt, elo1: v }), "0.5"));
    f2("alpha", "Chance of passing a change that is not better", number(this.options.sprt.alpha, (v) => (this.options.sprt = { ...this.options.sprt, alpha: v }), "0.01"));
    f2("beta", "Chance of failing a change that is better", number(this.options.sprt.beta, (v) => (this.options.sprt = { ...this.options.sprt, beta: v }), "0.01"));
    const adj = el("input");
    adj.type = "checkbox";
    adj.checked = this.options.adjudicate;
    adj.addEventListener("change", () => {
      this.options.adjudicate = adj.checked;
      storeOptions(this.options);
      this.render();
    });
    f2("Adjudicate", "End clearly won games (score above 600 for 3 moves) and dead draws (after move 40) early, as OpenBench does", adj);
    adv.append(grid2);
    card.append(adv);

    const problem = this.newId && this.baseId && this.newId !== this.baseId ? checkTestOptions(this.options) : "Pick two different branches.";
    const foot = el("div", "ts-foot");
    if (problem) foot.append(el("span", "ts-problem", problem));
    const start = button("▶ Start test", "Build both versions and play", "btn primary ts-start");
    start.disabled = !!problem;
    start.addEventListener("click", () => void this.start());
    foot.append(start);
    card.append(foot);
    return card;
  }

  // Running ---------------------------------------------------------------------------------

  private say(line: string): void {
    this.log.push(line);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.scheduleRender();
  }

  private setStep(text: string): void {
    this.step = text;
    this.say(`— ${text}`);
  }

  private persist(force = false): void {
    if (!this.run) return;
    const now = Date.now();
    if (!force && now - this.saveTimer < 3000) return;
    this.saveTimer = now;
    saveTest(this.host.workbench(), this.run);
    this.host.changed();
  }

  async start(): Promise<void> {
    if (!desktop || this.running) return;
    const d = desktop;
    this.host.sync();
    const wb = this.host.workbench();
    const nb = wb.branches[this.newId];
    const bb = wb.branches[this.baseId];
    if (!nb || !bb) return;
    const options: TestOptions = JSON.parse(JSON.stringify(this.options)) as TestOptions;
    const newName = engineName(nb.name);
    const baseName = engineName(bb.name, newName);
    const run: TestRecord = {
      id: `t${Date.now().toString(36)}`,
      started: new Date().toISOString(),
      status: "running",
      newBranch: { id: nb.id, name: nb.name },
      baseBranch: { id: bb.id, name: bb.name },
      changes: describeChanges(diffWorkspaces(bb.workspace, nb.workspace)),
      options,
      result: emptyProgress(options.sprt),
      newWorkspace: JSON.parse(JSON.stringify(nb.workspace)) as Workspace,
      baseWorkspace: JSON.parse(JSON.stringify(bb.workspace)) as Workspace,
    };
    this.run = run;
    this.log = [];
    this.stopping = false;
    this.persist(true);
    this.render();
    const fail = (message: string) => {
      void d.stopWatching().catch(() => undefined);
      run.status = "error";
      run.message = message;
      run.finished = new Date().toISOString();
      this.say(`Error: ${message}`);
      saveTest(this.host.workbench(), run);
      this.host.changed();
      this.render();
    };
    try {
      // fastchess, found or downloaded once.
      this.setStep("Looking for fastchess");
      let fastchess = await d.findFastchess();
      if (!fastchess) {
        this.setStep("Downloading fastchess (once)");
        fastchess = await d.installFastchess((l) => this.say(l));
      }
      if (this.stopping) return this.stopped();
      // The opening book.
      let book: { path: string; format: "epd" | "pgn" } | null = null;
      if (options.book.kind === "builtin") {
        const bk = BOOKS[options.book.id];
        this.setStep(`Getting the opening book ${bk.file}`);
        book = { path: await d.getBook(bk.file, bk.url, (l) => this.say(l)), format: bk.format };
      } else if (options.book.kind === "file") {
        book = { path: options.book.path, format: options.book.path.toLowerCase().endsWith(".pgn") ? "pgn" : "epd" };
      }
      // Both engines, each in its own folder.
      const engines: { program: string; hash: boolean }[] = [];
      run.bench = { new: null, base: null };
      for (const [which, b] of [
        ["new", nb],
        ["base", bb],
      ] as const) {
        if (this.stopping) return this.stopped();
        this.setStep(`Building "${b.name}"`);
        let built;
        try {
          built = await buildBranch(d, wb, b.id, b.workspace, (l) => this.say(l));
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
        const program = built.program;
        this.setStep(`bench of "${b.name}"`);
        const out = await d.runBench(program);
        const nodes = out.match(/(\d+)\s+nodes/);
        run.bench[which] = nodes ? Number(nodes[1]) : null;
        this.say(out.trim().split("\n").pop() ?? "");
        engines.push({ program, hash: built.hash });
      }
      if (run.bench.new !== null && run.bench.new === run.bench.base && run.changes.length) {
        this.say("Note: both versions have the same bench. The change may not change how the engine searches.");
      }
      if (this.stopping) return this.stopped();
      this.persist(true);
      // Play.
      this.setStep("Playing");
      const testsDir = await d.defaultProjectDir("tests");
      let liveLog: string | undefined;
      if (this.watch) {
        liveLog = `${testsDir}${testsDir.includes("\\") ? "\\" : "/"}live.log`;
        this.live?.clear();
        this.live = new LiveGamesView();
        const view = this.live;
        await d.watchGames(liveLog, (lines) => view.feed(lines));
      } else this.live = null;
      const args = fastchessArgs(options, { name: newName, ...engines[0]! }, { name: baseName, ...engines[1]! }, book, liveLog);
      this.say(`fastchess ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}`);
      await new Promise<void>((resolve, reject) => {
        d.startTest(fastchess!, args, testsDir, (e) => {
          if (e.kind === "line") {
            if (readFastchessLine(run.result, e.text, newName)) {
              this.persist();
              this.scheduleRender();
            }
            if (!/^(Started|Finished) game/.test(e.text)) this.say(e.text);
          } else resolve();
        }).catch(reject);
      });
      if (liveLog) await d.stopWatching();
      run.finished = new Date().toISOString();
      run.status = this.stopping ? "stopped" : statusOf(run.result);
      if (run.result.games === 0 && !this.stopping) {
        if (this.log.some((l) => l.includes("Concurrency exceeds"))) {
          return fail(`"Games at once" (${options.concurrency}) is more than your computer's processor cores. Lower it and start again.`);
        }
        return fail(`fastchess played no games. The last lines: ${this.log.slice(-3).join(" / ")}`);
      }
      saveTest(this.host.workbench(), run);
      this.host.changed();
      this.step = "";
      this.host.toast(run.status === "passed" ? `"${nb.name}" passed: ${formatElo(run.result.elo, run.result.eloError)} Elo.` : `"${nb.name}" ${run.status}.`);
      this.render();
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }

  private stopped(): void {
    if (!this.run) return;
    void desktop?.stopWatching().catch(() => undefined);
    this.run.status = "stopped";
    this.run.finished = new Date().toISOString();
    saveTest(this.host.workbench(), this.run);
    this.host.changed();
    this.render();
  }

  async stop(): Promise<void> {
    if (!desktop || !this.running) return;
    this.stopping = true;
    this.setStep("Stopping");
    await desktop.stopTest();
  }

  /** One test: result, graphs, settings, what was tested and its code diff. Live while it runs. */
  private renderDetail(wb: Workbench, t: TestRecord): HTMLElement {
    const live = t.id === this.run?.id;
    // Its own page and the card on the main page remember open sections separately.
    const ctx = this.viewing === t.id ? "page" : "card";
    const card = el("section", `ts-card ts-run ts-${t.status}`);
    card.dataset.test = t.id;
    const head = el("div", "ts-runhead");
    head.append(el("h3", undefined, `${t.newBranch.name}  vs  ${t.baseBranch.name}`));
    head.append(el("span", `ts-badge ts-${t.status}`, t.status === "running" ? this.step || "running" : STATUS_TEXT[t.status]));
    if (live && this.viewing !== t.id) {
      const full = button("Open", "This test on its own page", "btn small ts-open");
      full.addEventListener("click", () => this.show(t.id));
      head.append(full);
    }
    card.append(head);
    card.append(this.renderResult(t));
    if (t.result.problems) {
      card.append(el("p", "br-warn", `${t.result.problems} game${t.result.problems > 1 ? "s" : ""} ended by time loss, crash or illegal move. Check the engines with Run.`));
    }
    if (t.message) card.append(el("p", "br-warn", t.message));

    // Graphs: Elo and LLR as the games went by, and the game pairs.
    const graphs = el("div", "ts-graphs");
    const samples = t.result.samples ?? [];
    graphs.append(
      lineChart({
        title: "Elo of the new version",
        xLabel: "games",
        error: "band",
        points: samples.filter((p) => p.elo !== null).map((p) => ({ x: p.games, y: p.elo!, err: p.error ?? undefined })),
        rules: [{ y: 0, label: "", tone: "zero" }],
      }),
      lineChart({
        title: "LLR (the test's progress)",
        xLabel: "games",
        digits: 2,
        points: samples.filter((p) => p.llr !== null).map((p) => ({ x: p.games, y: p.llr! })),
        rules: [
          { y: t.result.upper, label: "passes", tone: "pass" },
          { y: t.result.lower, label: "fails", tone: "fail" },
          { y: 0, label: "", tone: "zero" },
        ],
      }),
    );
    if (t.result.penta) graphs.append(pentaChart(t.result.penta));
    card.append(graphs);

    // The games on boards, while they are played (the same boards across redraws).
    if (live && this.live) {
      const games = el("details", "ts-live");
      games.dataset.key = `${ctx}-live`;
      games.open = true;
      games.append(el("summary", undefined, t.status === "running" ? `Live games${this.live.count ? ` (${this.live.count})` : ""}` : "Last positions of the games"));
      games.append(this.live.el);
      card.append(games);
    }

    const actions = el("div", "ts-foot");
    if (t.status === "running") {
      const stop = button("■ Stop", "Stop the test; the result so far is kept", "btn ts-stop");
      stop.addEventListener("click", () => void this.stop());
      actions.append(stop);
    } else {
      const still = wb.branches[t.newBranch.id] && t.newBranch.id !== wb.main;
      if (still && t.status === "passed") {
        const keep = button(`Keep "${t.newBranch.name}"`, "Make it the main version (you see every change first)", "btn primary ts-keep");
        keep.addEventListener("click", () => this.host.keepBranch(t.newBranch.id));
        actions.append(keep);
      }
      if (still) {
        const del = button(`Delete "${t.newBranch.name}"`, "Throw the branch away", t.status === "failed" ? "btn primary ts-delete" : "btn ts-delete");
        del.addEventListener("click", () => this.host.deleteBranch(t.newBranch.id));
        actions.append(del);
      }
      if (t.decision) actions.append(el("span", "br-meta", `Branch ${t.decision}.`));
      if (live) {
        const dismiss = button("Done", "Close this result (it stays in the timeline)");
        dismiss.addEventListener("click", () => {
          this.run = null;
          if (this.viewing === t.id) this.viewing = null;
          this.render();
        });
        actions.append(dismiss);
      }
    }
    card.append(actions);

    // Settings.
    const o = t.options;
    const book = o.book.kind === "builtin" ? BOOKS[o.book.id].file : o.book.kind === "file" ? o.book.path.split(/[\\/]/).pop()! : "none";
    const rows: [string, string][] = [
      ["Time control", o.tc],
      ["SPRT", `[${o.sprt.elo0}, ${o.sprt.elo1}] normalized Elo, alpha ${o.sprt.alpha}, beta ${o.sprt.beta}`],
      ["Opening book", book],
      ["Games at once", String(o.concurrency)],
      ["Hash / Threads", `${o.hash} MB / ${o.threads}`],
      ["Max games", String(o.maxGames)],
      ["Adjudication", o.adjudicate ? "on (resign at 600 for 3 moves, draw after move 40)" : "off"],
      ["bench new / base", t.bench ? `${t.bench.new ?? "?"} / ${t.bench.base ?? "?"}` : "—"],
      ["Started", when(t.started)],
      ["Finished", t.finished ? `${when(t.finished)} (${duration(t.started, t.finished)})` : "—"],
    ];
    if (t.result.nElo !== null) rows.splice(2, 0, ["nElo", formatElo(t.result.nElo, t.result.nEloError)]);
    const settings = el("details", "ts-settings");
    settings.dataset.key = `${ctx}-settings-${t.id}`;
    settings.open = this.viewing === t.id;
    settings.append(el("summary", undefined, `Settings: ${o.tc}, [${o.sprt.elo0}, ${o.sprt.elo1}], ${book}`));
    const table = el("table", "ts-table");
    for (const [k, v] of rows) {
      const tr = el("tr");
      tr.append(el("th", undefined, k), el("td", undefined, v));
      table.append(tr);
    }
    settings.append(table);
    card.append(settings);

    // What was tested, and its code diff (from the engines as they were then).
    const what = el("details", "ts-whatwas");
    what.dataset.key = `${ctx}-what-${t.id}`;
    what.open = this.viewing === t.id;
    what.append(el("summary", undefined, t.changes.length ? `What was tested: ${t.changes.length} change${t.changes.length > 1 ? "s" : ""}` : "What was tested: no changes"));
    if (t.changes.length) {
      const ul = el("ul", "br-changes");
      for (const c of t.changes) ul.append(el("li", undefined, c));
      what.append(ul);
    }
    if (t.newWorkspace && t.baseWorkspace) {
      const before = t.baseWorkspace;
      const after = t.newWorkspace;
      const code = el("details", "br-code");
      code.dataset.key = `${ctx}-code-${t.id}`;
      const sum = el("summary", undefined, "Code changes");
      code.append(sum);
      code.addEventListener("toggle", () => {
        if (!code.open || code.dataset.filled) return;
        code.dataset.filled = "1";
        const diff = workspaceDiff(before, after);
        if ("problem" in diff) return void code.append(el("p", "br-hint", diff.problem));
        sum.textContent = `Code changes · +${diff.reduce((n, f) => n + f.added, 0)} −${diff.reduce((n, f) => n + f.removed, 0)}`;
        const copy = button("Copy as diff", "Copy these changes as a git diff", "btn small");
        copy.addEventListener("click", () => void navigator.clipboard.writeText(diffText(diff)).then(() => this.host.toast("Copied the diff.")));
        code.append(copy, renderDiff(diff));
      });
      what.append(code);
    } else {
      what.append(el("p", "br-hint", "This test was run before tests kept the engines' code, so there is no code diff."));
    }
    card.append(what);

    if (live || t.result.recent.length) {
      const log = el("details", "ts-log");
      log.dataset.key = `${ctx}-log-${t.id}`;
      log.append(el("summary", undefined, live ? "Output" : "Last games"));
      if (t.result.recent.length) log.append(el("pre", "ts-recent", t.result.recent.join("\n")));
      if (live) {
        const pre = el("pre", "ts-out", this.log.join("\n"));
        pre.dataset.scroll = `${ctx}-out-${t.id}`;
        log.append(pre);
      }
      card.append(log);
    }
    return card;
  }

  /** Elo, games, W/D/L and the LLR bar. */
  private renderResult(t: TestRecord): HTMLElement {
    const r = t.result;
    const box = el("div", "ts-result");
    const stat = (label: string, value: string, cls = "") => {
      const s = el("div", `ts-stat ${cls}`);
      s.append(el("b", undefined, value), el("span", undefined, label));
      box.append(s);
    };
    stat("Elo", formatElo(r.elo, r.eloError), "ts-elo");
    stat("games", String(r.games));
    stat("wins / draws / losses", `${r.wins} / ${r.draws} / ${r.losses}`);
    if (t.bench) stat("bench new / base", `${t.bench.new ?? "?"} / ${t.bench.base ?? "?"}`);
    const llr = el("div", "ts-llr");
    const span = r.upper - r.lower;
    const at = r.llr === null ? 0.5 : Math.min(1, Math.max(0, (r.llr - r.lower) / span));
    llr.innerHTML = `<div class="ts-llr-bar"><div class="ts-llr-zero"></div><div class="ts-llr-mark"></div></div><div class="ts-llr-labels"><span>fails at ${r.lower.toFixed(2)}</span><span>LLR ${r.llr === null ? "—" : r.llr.toFixed(2)}</span><span>passes at ${r.upper.toFixed(2)}</span></div>`;
    (llr.querySelector(".ts-llr-mark") as HTMLElement).style.left = `${at * 100}%`;
    (llr.querySelector(".ts-llr-zero") as HTMLElement).style.left = `${((0 - r.lower) / span) * 100}%`;
    box.append(llr);
    return box;
  }

  // Timeline --------------------------------------------------------------------------------

  private renderTimeline(wb: Workbench): HTMLElement {
    const card = el("section", "ts-card ts-timeline");
    const tests = [...(wb.tests ?? [])].reverse();
    card.append(el("h3", undefined, `Timeline${tests.length ? ` (${tests.length} test${tests.length > 1 ? "s" : ""})` : ""}`));
    if (!tests.length) {
      card.append(el("p", "br-hint", "No tests yet. Every test you run is listed here, with what it measured and what you did with it."));
      return card;
    }
    const points = eloTimeline(wb.tests ?? []);
    if (points.length >= 2) {
      const last = points[points.length - 1]!;
      const chart = el("details", "ts-elochart");
      chart.dataset.key = "elo-chart";
      chart.open = readFlag(CHART_KEY, true);
      chart.addEventListener("toggle", () => writeFlag(CHART_KEY, chart.open));
      chart.append(el("summary", undefined, `Elo of the main version: ${formatElo(last.elo, last.error)} from ${points.length - 1} kept change${points.length > 2 ? "s" : ""}`));
      chart.append(
        lineChart({
          title: "Elo gained by kept changes (error bars: 95%)",
          xLabel: "",
          error: "whiskers",
          xNames: points.map((p) => p.label),
          points: points.map((p, i) => ({ x: i, y: p.elo, err: p.error || undefined, title: `${p.label}: ${formatElo(p.elo, p.error || null)} Elo (${when(p.at)})` })),
          rules: [{ y: 0, label: "", tone: "zero" }],
        }),
      );
      card.append(chart);
    }
    const list = el("ul", "ts-list");
    for (const t of tests) {
      const li = el("li", `ts-item ts-${t.status}`);
      li.dataset.test = t.id;
      li.tabIndex = 0;
      li.title = "Open this test: result, graphs, settings and code diff";
      li.addEventListener("click", () => this.show(t.id));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter") this.show(t.id);
      });
      const top = el("div", "ts-itop");
      top.append(el("span", `ts-badge ts-${t.status}`, STATUS_TEXT[t.status]));
      top.append(el("span", "ts-iname", `${t.newBranch.name} vs ${t.baseBranch.name}`));
      top.append(el("span", "ts-ielo", formatElo(t.result.elo, t.result.eloError)));
      top.append(el("span", "br-meta", `${t.result.games} games · ${t.options.tc}${t.decision ? ` · ${t.decision}` : ""}`));
      top.append(el("time", "br-meta ts-when", when(t.started)));
      li.append(top);
      if (t.changes.length) li.append(el("div", "ts-ichanges", t.changes.join(", ")));
      if (t.message) li.append(el("div", "ts-problem", t.message));
      list.append(li);
    }
    card.append(list);
    return card;
  }
}

function duration(from: string, to: string): string {
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* convenience */
  }
}
