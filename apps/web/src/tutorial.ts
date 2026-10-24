/**
 * The beginner tutorial: build a first engine (a random mover) from an empty
 * canvas, read its code, open it in VS Code or export it, build it with cargo
 * and play against it. Optional: offered once, and always in the top bar.
 */

import type { Workspace } from "@cfs/codegen";
import { isDesktop } from "./platform";

export interface TutorialHost {
  workspace(): Workspace | null;
  /** An Engine block is on the canvas. */
  hasEngine(): boolean;
  engineName(): string;
  /** The Cargo name of the engine, which is also the program's name. */
  crateName(): string;
  activeFile(): string;
  folderLinked(): boolean;
  canLinkFolders(): boolean;
  exported(): boolean;
  /** Empties the canvas (asks first when there is something on it). Returns false when cancelled. */
  clearCanvas(): boolean;
  /** Opens a file and highlights lines `from` (text on the first line) for `count` lines. */
  showLines(path: string, from: string, count: number): void;
  /** Removes the code highlight. */
  clearLines(): void;
  /** Desktop app: builds and starts the engine (▶ Run). */
  runEngine(): void;
  /** Desktop app: the engine is running. */
  engineRunning(): boolean;
  /** Desktop app: the engine has answered a `go` with a bestmove. */
  engineAnswered(): boolean;
  /** The open branch is not the main version. */
  onBranch(): boolean;
  /** The Branches panel is open. */
  branchesOpen(): boolean;
  /** The Tests view is open. */
  testsOpen(): boolean;
  /** Status of the newest test ("running", "passed", ...), if any. */
  lastTestStatus(): string | null;
  /** The newest test was of the open branch. */
  lastTestIsOfBranch(): boolean;
  /** The main version (not a branch). */
  mainWorkspace(): Workspace | null;
  /** Starts over from a random mover (asks first when there is work). Returns false when cancelled. */
  startFromRandomMover(): Promise<boolean>;
}

interface Step {
  title: string;
  /** HTML. */
  body: (h: TutorialHost) => string;
  /** Element to point at (CSS selector), if any. */
  target?: string;
  /** The step is done when this is true; without it, Next is always enabled. */
  done?: (h: TutorialHost) => boolean;
  /** What to do when the step opens (open a file, highlight code). */
  enter?: (h: TutorialHost) => void;
  /** A button that does something for the user. */
  action?: { label: string; run: (h: TutorialHost) => void };
}

const code = (lines: string) => `<pre class="tut-cmd"><button type="button" class="tut-copy" title="Copy">Copy</button><code>${lines}</code></pre>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** On the website: export the project and build it in a terminal. */
const WEB_RUN: Step[] = [
  {
    title: "8. Get the project onto your computer",
    target: "#link-folder:not([hidden]), #export",
    body: (h) =>
      `${
        h.canLinkFolders()
          ? `<p><b>With VS Code (recommended):</b> open the <b>☰</b> menu, click <b>Link folder</b> and pick an empty folder. The app writes the project there and keeps it in sync: open that folder in VS Code (<i>File &gt; Open Folder</i>), and changes you save there come back here as blocks.</p><p><b>Or:</b> click <b>Export Rust project</b> to download a zip, and unzip it.</p>`
          : `<p>Click <b>Export Rust project</b> to download a zip, and unzip it. (In Chrome or Edge you could also <b>Link folder</b> to keep a folder in sync for VS Code.)</p>`
      }`,
    done: (h) => h.folderLinked() || h.exported(),
  },
  {
    title: "9. Install Rust (once)",
    body: () =>
      `<p>To build the engine you need Rust. If <code>cargo --version</code> already works in a terminal, skip this step.</p>
       <p>Otherwise install it from <a href="https://rustup.rs" target="_blank" rel="noopener">rustup.rs</a> (on Windows, run <code>rustup-init.exe</code> and accept the defaults), then open a <b>new</b> terminal and check:</p>
       ${code("cargo --version")}`,
  },
  {
    title: "10. Build it",
    body: (h) =>
      `<p>Open a terminal in the project folder (in VS Code: <i>Terminal &gt; New Terminal</i>) and build the fast version:</p>
       ${code("cargo build --release")}
       <p>The first build downloads cozy-chess and takes a minute. Your engine is then <code>target/release/${esc(h.crateName())}</code> (on Windows <code>target\\release\\${esc(h.crateName())}.exe</code>).</p>`,
  },
  {
    title: "11. Talk to it",
    body: (h) =>
      `<p>Start your engine and type the UCI commands a chess program would send, one per line:</p>
       ${code(`cargo run --release
uci
position startpos
go
quit`)}
       <p>It answers <code>id name ${esc(h.engineName())}</code> and <code>uciok</code> to <code>uci</code>, and a random <code>bestmove</code> such as <code>bestmove g1f3</code> to <code>go</code>. You can also start the program directly: <code>./target/release/${esc(h.crateName())}</code>.</p>`,
  },
  {
    title: "12. Play against it",
    body: (h) =>
      `<p>Add the engine to a chess program and play it:</p>
       <ul><li><a href="https://encroissant.org" target="_blank" rel="noopener">En Croissant</a>: <i>Engines &gt; Add new &gt; Local</i>, pick the file from step 10;</li>
       <li><a href="https://cutechess.com" target="_blank" rel="noopener">Cute Chess</a>: <i>Tools &gt; Settings &gt; Engines &gt; +</i>, then <i>Game &gt; New</i>;</li>
       <li>Arena: <i>Engines &gt; Install New Engine</i>.</li></ul>
       <p>The file is <code>${esc(h.crateName())}</code> in <code>target/release</code>. It should be easy to beat!</p>`,
  },
];

/** In the desktop app: Run builds and starts it. */
const DESKTOP_RUN: Step[] = [
  {
    title: "8. Install Rust (once)",
    body: () =>
      `<p>The app builds your engine with Rust. If you installed it before, skip this step.</p>
       <p>Otherwise install it from <a href="https://rustup.rs" target="_blank" rel="noopener">rustup.rs</a> (on Windows, run <code>rustup-init.exe</code> and accept the defaults), then close and open Chess From Scratch again.</p>`,
  },
  {
    title: "9. Run it",
    target: "#run-btn",
    body: () =>
      `<p>Click <b>▶ Run</b> at the top. The panel at the bottom opens: the app writes your project to a folder, builds it with <code>cargo build --release</code> and starts it.</p>
       <p>The first build downloads the chess library and takes a minute. When your engine answers <code>uciok</code>, it is running.</p>`,
    action: { label: "Run it for me", run: (h) => h.runEngine() },
    done: (h) => h.engineRunning(),
  },
  {
    title: "10. Talk to it",
    target: "#dock .dock-quick",
    body: (h) =>
      `<p>A chess program talks to your engine with UCI commands. Try them with the buttons, or type them in the box at the bottom:</p>
       <ul><li><b>position startpos</b>: the starting position;</li><li><b>go depth</b>: find a move. ${esc(h.engineName())} answers with a random <code>bestmove</code>, such as <code>bestmove g1f3</code>.</li></ul>
       <p>Paste a FEN in the long box and click <b>Set position</b> to try any position.</p>`,
    done: (h) => h.engineAnswered(),
  },
  {
    title: "11. Its folder",
    target: "#terminal-btn",
    body: (h) =>
      `<p>Your engine is a normal Rust project in a folder. <b>Folder</b> in the panel shows it; <b>Terminal</b> at the top opens a terminal there.</p>
       <p>The program is <code>target/release/${esc(h.crateName())}</code> in that folder (on Windows with <code>.exe</code>). Open the folder in VS Code to read and change the code.</p>`,
  },
  {
    title: "12. Play against it",
    body: (h) =>
      `<p>Add the engine to a chess program and play it:</p>
       <ul><li><a href="https://encroissant.org" target="_blank" rel="noopener">En Croissant</a>: <i>Engines &gt; Add new &gt; Local</i>;</li>
       <li><a href="https://cutechess.com" target="_blank" rel="noopener">Cute Chess</a>: <i>Tools &gt; Settings &gt; Engines &gt; +</i>, then <i>Game &gt; New</i>;</li>
       <li>Arena: <i>Engines &gt; Install New Engine</i>.</li></ul>
       <p>Pick <code>${esc(h.crateName())}</code> in the <code>target/release</code> folder from step 11. It should be easy to beat!</p>`,
  },
];

const STEPS: Step[] = [
  {
    title: "Your first chess engine",
    body: () =>
      `<p>In about ten minutes you build a real chess engine from nothing: one that plays a random legal move. It is the simplest engine there is, and every engine you make later should beat it.</p>
       <p>You will drag blocks, read the Rust code they make, build the engine with <code>cargo</code> and play against it in a chess program.</p>
       <p>The tutorial starts from an empty canvas. Save your current work first if you want to keep it.</p>`,
    action: { label: "Empty the canvas and start", run: (h) => h.clearCanvas() },
    done: (h) => !h.hasEngine() && !h.workspace(),
  },
  {
    title: "1. The Engine block",
    target: "#cat_engine",
    body: () =>
      `<p>Every engine starts with an <b>Engine</b> block. Click <b>Engine</b> in the drawer on the left and drag the <b>Engine</b> block onto the canvas.</p>
       <p>The drawer stays open while you drag; click the category again (or press Esc) to close it.</p>`,
    done: (h) => h.hasEngine(),
  },
  {
    title: "2. Give it a name",
    body: (h) =>
      `<p>Click the name field on the Engine block (it says <i>My Engine</i>) and type a name for your engine, and your own name as author.</p>
       <p>The name becomes the name of the program you will build: right now that is <code>${esc(h.crateName())}</code>.</p>`,
    done: (h) => h.engineName() !== "My Engine" && h.engineName().trim() !== "",
  },
  {
    title: "3. Plug in a search",
    target: "#cat_search",
    body: () =>
      `<p>An engine needs a way to pick a move. Open <b>Search</b> in the drawer and drag <b>Random mover</b> into the <b>search</b> slot of your Engine block, until it clicks into place.</p>
       <p>When it fits, Status on the right turns green: your engine is complete, and the code on the right changes with it.</p>`,
    done: (h) => h.workspace()?.search.kind === "random_mover",
  },
  {
    title: "4. Your engine is Rust code",
    target: '.tree-file[data-path="src/search.rs"]',
    body: () =>
      `<p>Everything you build here is real Rust, shown on the right as a project: the same files you will build in a moment.</p>
       <p>Click <code>src/search.rs</code> in the file tree to open the file that holds your Random mover.</p>`,
    done: (h) => h.activeFile() === "src/search.rs",
  },
  {
    title: "5. How it picks a move",
    enter: (h) => h.showLines("src/search.rs", "fn search(", 22),
    body: () =>
      `<p>The highlighted function runs when a chess program says <code>go</code>:</p>
       <ul><li><code>generate_moves</code> asks the <a href="https://docs.rs/cozy-chess" target="_blank" rel="noopener">cozy-chess</a> library for every legal move;</li>
       <li><code>self.next()</code> draws a random number, and the move at that position in the list is the <code>best_move</code>.</li></ul>
       <p>Lines between <code>// @block random_mover</code> and <code>// @end random_mover</code> belong to the Random mover block: remove the block and they are gone.</p>`,
  },
  {
    title: "6. How it talks to a chess program",
    enter: (h) => h.showLines("src/uci.rs", '"go" => {', 12),
    body: () =>
      `<p>Chess programs talk to engines in a text protocol called <b>UCI</b>. <code>src/uci.rs</code> reads their commands line by line: <code>uci</code>, <code>isready</code>, <code>position</code> and the highlighted <code>go</code>, which calls your search and answers <code>bestmove</code>.</p>
       <p>You will type these commands yourself in a minute.</p>`,
  },
  {
    title: "7. Where it starts",
    enter: (h) => h.showLines("src/main.rs", "fn main() {", 10),
    body: () =>
      `<p><code>src/main.rs</code> is where the program starts: the <code>mod</code> lines list its files, and <code>main</code> runs either <code>bench</code> (a speed test) or the UCI loop.</p>
       <p><code>Cargo.toml</code> names the program and its one library, cozy-chess. That is the whole project.</p>`,
  },
...(isDesktop ? DESKTOP_RUN : WEB_RUN),
  {
    title: "Done: you built a chess engine",
    body: () =>
      `<p>Next steps, one block at a time:</p>
       <ul><li>Swap Random mover for <b>Negamax search</b> and plug in a <b>Hand-crafted evaluation</b> with <b>Material</b>: now it looks ahead and counts pieces.</li>
       <li>Add <b>Iterative deepening</b>, then <b>Alpha-beta pruning</b>, and watch the engine get stronger; right-click any block and choose <i>Explain this block</i>.</li>
       <li>After each change, ${isDesktop ? "click <b>↻ Rebuild</b>" : "build again (step 10)"} and let the new version play the old one.</li></ul>
       <p>Next, the <b>branches and tests</b> tutorial (in the <b>☰</b> menu) turns this random mover into a real search, step by step, and proves it is stronger.</p>
       <p>The <a href="guide.html#Home" target="_blank" rel="noopener">guide</a> shows how to change blocks, make your own and build on them. Stuck, or have an idea? Click <b>Feedback</b> in the <b>☰</b> menu.</p>`,
  },
];

const searchBlocks = (ws: Workspace | null) => (ws ? Object.values(ws.search.slots).flat().map((b) => b.type) : []);

/** The second tutorial: from the random mover, a branch with Negamax and Material, tested and kept. */
const BRANCH_STEPS: Step[] = [
  {
    title: "Branches and tests",
    body: () =>
      `<p>Your random mover works, but it plays random moves. In this tutorial you make a better version <b>next to it</b>, in a branch, prove with a test that it is stronger, and keep it.</p>
       <p>That is how engine developers work: one idea at a time, each one tested.</p>
       ${isDesktop ? "" : "<p>On the website you can do everything except run the test: that needs the desktop app. You can follow along and skip that step.</p>"}`,
    action: { label: "Start from a random mover", run: (h) => void h.startFromRandomMover() },
    done: (h) => !h.onBranch() && h.workspace()?.search.kind === "random_mover",
  },
  {
    title: "1. Open Branches",
    target: "#branch-btn",
    body: () => `<p>Click <b>⑂ main</b> at the top. <i>main</i> is your engine as it is now. A branch is a copy you can change without touching it.</p>`,
    done: (h) => h.branchesOpen() || h.onBranch(),
  },
  {
    title: "2. Clone it",
    target: ".br-new",
    body: () => `<p>Type a name for the idea, for example <code>+ negamax</code>, and click <b>Clone "main"</b>.</p><p>You are now on the branch: the button at the top shows its name. <i>main</i> keeps the random mover.</p>`,
    done: (h) => h.onBranch(),
  },
  {
    title: "3. Search instead of guessing",
    target: ".blocklyToolboxCategory",
    body: () =>
      `<p>Close the panel (<b>Esc</b>). On the canvas, drag the <b>Random mover</b> block to the bin.</p>
       <p>Then open <b>Search</b> in the drawer and drag <b>Negamax search</b> into the empty search slot of the Engine block. Negamax looks a few moves ahead.</p>`,
    done: (h) => h.onBranch() && h.workspace()?.search.kind === "negamax",
  },
  {
    title: "4. Count the pieces",
    body: () =>
      `<p>Negamax needs to know who is better at the end of its search. Open <b>Evaluation</b> and drag <b>Hand-crafted evaluation</b> into the evaluation slot.</p>
       <p>Then drag <b>Material</b> into it: now the engine counts pieces, so it takes free pieces and keeps its own.</p>`,
    done: (h) => h.onBranch() && h.workspace()?.eval.kind === "hce" && !!h.workspace()?.eval.terms.some((t) => t.type === "material"),
  },
  {
    title: "5. Mind the clock",
    body: () =>
      `<p>Tests play fast games with a clock. Drag <b>Iterative deepening</b> (under <b>Search</b>) into the search's first slot: it searches 1 move deep, then 2, then 3… and stops in time.</p>
       <p>Without it the engine would search a fixed depth and lose games on time.</p>`,
    done: (h) => h.onBranch() && searchBlocks(h.workspace()).includes("iterative_deepening"),
  },
  {
    title: "6. What changed",
    target: "#branch-btn",
    body: () =>
      `<p>Open <b>⑂</b> again. Your branch lists what it changed: <code>− Random mover</code>, <code>+ Negamax search</code>, <code>+ Hand-crafted evaluation</code>, <code>+ Material</code>, <code>+ Iterative deepening</code>.</p>
       <p><b>Code changes</b> under it shows every line of Rust that changed, like a git diff.</p>`,
    done: (h) => h.onBranch() && h.branchesOpen(),
  },
  {
    title: "7. Open Tests",
    target: "#tests-btn",
    body: () => `<p>Close the panel and click <b>Tests</b> at the top. It is its own view; <b>Engine</b> takes you back to the blocks.</p>`,
    done: (h) => h.testsOpen(),
  },
  {
    title: "8. Start the test",
    target: ".ts-start",
    body: () =>
      isDesktop
        ? `<p>The test plays your branch (<b>New version</b>) against <i>main</i> (<b>Base version</b>). <i>What is tested</i> lists your changes.</p>
           <p>Pick <b>VSTC</b>: very short games, made for big changes like this one. Then click <b>▶ Start test</b>. The first time, the app downloads fastchess and an opening book.</p>`
        : `<p>In the desktop app you would pick <b>VSTC</b> and click <b>▶ Start test</b>: both versions are built and play each other. On the website, read the next step and click <b>Skip</b>.</p>`,
    done: (h) => h.lastTestIsOfBranch() && h.lastTestStatus() !== null,
  },
  {
    title: "9. Watch it",
    body: () =>
      `<p>Both versions are built, then the games start. Watch:</p>
       <ul><li><b>Elo</b>: how much stronger your branch is, ± its margin.</li>
       <li><b>The bar</b> and the <b>LLR</b> graph: the test passes at the right end.</li>
       <li><b>Game pairs</b>: each opening is played twice, once with each color. Bars on the right are pairs your branch won.</li></ul>
       <p>A random mover loses almost every game, so this test passes quickly.</p>`,
    done: (h) => h.lastTestIsOfBranch() && h.lastTestStatus() === "passed",
  },
  {
    title: "10. Keep it",
    target: ".ts-keep",
    body: () =>
      `<p>It passed. Click <b>Keep</b>: you see every changed line, then <b>Keep it</b>. The branch becomes your main version.</p>
       <p>A failed test would mean: delete the branch, or improve it and test again.</p>`,
    done: (h) => !h.onBranch() && h.mainWorkspace()?.search.kind === "negamax",
  },
  {
    title: "Done: tested and kept",
    body: () =>
      `<p>The <b>Timeline</b> in Tests now lists your test, and the chart shows the Elo your main version gained.</p>
       <p>Keep going the same way, one idea per branch:</p>
       <ul><li>Clone, add <b>Alpha-beta pruning</b>, test, keep.</li>
       <li>Then <b>PSQT</b> in the evaluation, <b>MVV-LVA</b> move ordering, a <b>Transposition table</b>… right-click any block and pick <i>Explain this block</i>.</li></ul>
       <p>Small changes need more games: use <b>STC</b> once the big gains are done. The guide page <a href="guide.html#Testing-Changes" target="_blank" rel="noopener">Testing your changes</a> explains every setting.</p>`,
  },
];

export type CourseId = "first" | "branches";

const COURSES: Record<CourseId, { steps: Step[]; key: string; label: string }> = {
  first: { steps: STEPS, key: "cfs.tutorial.step", label: "Tutorial" },
  branches: { steps: BRANCH_STEPS, key: "cfs.tutorial2.step", label: "Branches tutorial" },
};

const SEEN = "cfs.tutorial.seen";

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      // Storage can be unavailable; the tutorial then starts over after a reload.
    }
  },
};

export class Tutorial {
  private index = -1;
  private course: CourseId = "first";
  private card: HTMLElement | null = null;
  private pointed: Element | null = null;
  private timer: number | undefined;

  constructor(private readonly host: TutorialHost) {}

  private get steps(): Step[] {
    return COURSES[this.course].steps;
  }

  get courseId(): CourseId | null {
    return this.index >= 0 ? this.course : null;
  }

  get running(): boolean {
    return this.index >= 0;
  }

  /** Continues a tutorial left open before a reload, or offers it once to new visitors. */
  resumeOrOffer(): void {
    for (const [id, c] of Object.entries(COURSES) as [CourseId, (typeof COURSES)[CourseId]][]) {
      const saved = Number(store.get(c.key));
      if (store.get(c.key) !== null && saved >= 0 && saved < c.steps.length) {
        this.course = id;
        return this.go(saved);
      }
    }
    if (store.get(SEEN)) return;
    store.set(SEEN, "1");
    this.offer();
  }

  start(course: CourseId = "first"): void {
    store.set(SEEN, "1");
    if (this.index >= 0 && this.course !== course) store.set(COURSES[this.course].key, null);
    this.course = course;
    this.go(0);
  }

  stop(): void {
    this.index = -1;
    window.clearInterval(this.timer);
    this.timer = undefined;
    store.set(COURSES[this.course].key, null);
    this.point(null);
    this.host.clearLines();
    this.card?.remove();
    this.card = null;
  }

  /** Call when the workspace, the open file, the folder or an export changed. */
  update(): void {
    if (this.index >= 0) this.render(false);
  }

  private offer(): void {
    const card = this.frame();
    card.classList.add("tut-offer");
    card.innerHTML = `<div class="tut-head"><span>New here?</span></div>
      <strong class="tut-title">Build your first chess engine</strong>
      <p>A 10-minute tutorial: from an empty canvas to an engine you build and play against.</p>
      <div class="tut-foot"><span class="tut-spacer"></span><button type="button" class="btn" data-act="later">Not now</button><button type="button" class="btn primary" data-act="start">Start the tutorial</button></div>`;
    card.querySelector('[data-act="later"]')!.addEventListener("click", () => this.stop());
    card.querySelector('[data-act="start"]')!.addEventListener("click", () => this.start());
  }

  private frame(): HTMLElement {
    this.card?.remove();
    const card = document.createElement("section");
    card.className = "tut";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Tutorial");
    document.body.append(card);
    this.card = card;
    return card;
  }

  private go(index: number): void {
    this.index = index;
    store.set(COURSES[this.course].key, String(index));
    this.host.clearLines();
    this.steps[index]!.enter?.(this.host);
    this.render(true);
    // Steps that wait on panels and tests check again now and then.
    this.timer ??= window.setInterval(() => this.update(), 600);
  }

  private render(fresh: boolean): void {
    const step = this.steps[this.index]!;
    const done = step.done ? step.done(this.host) : true;
    if (!fresh && this.card?.dataset.step === String(this.index) && this.card.dataset.done === String(done)) {
      // Only the dynamic text (names) may have changed, or the element pointed at was redrawn.
      const body = this.card.querySelector(".tut-body");
      const html = step.body(this.host);
      if (body && body.innerHTML.length !== html.length) body.innerHTML = html;
      if (!done && step.target && !this.pointed?.isConnected) this.point(step.target);
      return;
    }
    const card = this.card && !this.card.classList.contains("tut-offer") ? this.card : this.frame();
    card.dataset.step = String(this.index);
    card.dataset.done = String(done);
    const last = this.index === this.steps.length - 1;
    card.innerHTML = `<div class="tut-head"><span>${COURSES[this.course].label} · ${this.index + 1} of ${this.steps.length}</span><button type="button" class="tut-x" title="Close the tutorial" aria-label="Close the tutorial">×</button></div>
      <strong class="tut-title">${step.title}</strong>
      <div class="tut-body">${step.body(this.host)}</div>
      ${step.done ? `<p class="tut-state ${done ? "ok" : ""}">${done ? "✓ Done" : "Waiting for you…"}</p>` : ""}
      <div class="tut-foot">
        ${this.index > 0 ? '<button type="button" class="btn" data-act="back">Back</button>' : ""}
        <span class="tut-spacer"></span>
        ${step.action && !done ? `<button type="button" class="btn" data-act="action">${step.action.label}</button>` : ""}
        ${step.done && !done ? '<button type="button" class="btn link" data-act="skip">Skip</button>' : ""}
        <button type="button" class="btn primary" data-act="next" ${done ? "" : "disabled"}>${last ? "Finish" : "Next"}</button>
      </div>`;
    card.querySelector(".tut-x")!.addEventListener("click", () => this.stop());
    card.querySelector('[data-act="back"]')?.addEventListener("click", () => this.go(this.index - 1));
    card.querySelector('[data-act="skip"]')?.addEventListener("click", () => this.next());
    card.querySelector('[data-act="next"]')!.addEventListener("click", () => this.next());
    card.querySelector('[data-act="action"]')?.addEventListener("click", () => {
      step.action!.run(this.host);
      this.render(false);
      window.setTimeout(() => this.render(false), 300);
    });
    card.querySelectorAll<HTMLButtonElement>(".tut-copy").forEach((b) =>
      b.addEventListener("click", () => {
        const text = b.nextElementSibling?.textContent ?? "";
        void navigator.clipboard?.writeText(text).then(
          () => (b.textContent = "Copied"),
          () => undefined,
        );
      }),
    );
    this.point(done ? null : (step.target ?? null));
  }

  private next(): void {
    if (this.index >= this.steps.length - 1) return this.stop();
    this.go(this.index + 1);
  }

  /** Makes the element the step talks about pulse. */
  private point(selector: string | null): void {
    this.pointed?.classList.remove("tut-target");
    this.pointed = selector ? document.querySelector(selector) : null;
    this.pointed?.classList.add("tut-target");
  }
}

/** Number of steps, for tests. */
export const TUTORIAL_STEPS = STEPS.length;
