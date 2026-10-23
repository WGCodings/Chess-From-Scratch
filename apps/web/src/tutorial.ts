/**
 * The beginner tutorial: build a first engine (a random mover) from an empty
 * canvas, read its code, open it in VS Code or export it, build it with cargo
 * and play against it. Optional: offered once, and always in the top bar.
 */

import type { Workspace } from "@cfs/codegen";

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
  {
    title: "8. Get the project onto your computer",
    target: "#link-folder:not([hidden]), #export",
    body: (h) =>
      `${
        h.canLinkFolders()
          ? `<p><b>With VS Code (recommended):</b> click <b>Link folder</b> at the top and pick an empty folder. The app writes the project there and keeps it in sync: open that folder in VS Code (<i>File &gt; Open Folder</i>), and changes you save there come back here as blocks.</p><p><b>Or:</b> click <b>Export Rust project</b> to download a zip, and unzip it.</p>`
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
  {
    title: "Done: you built a chess engine",
    body: () =>
      `<p>Next steps, one block at a time:</p>
       <ul><li>Swap Random mover for <b>Negamax search</b> and plug in a <b>Hand-crafted evaluation</b> with <b>Material</b>: now it looks ahead and counts pieces.</li>
       <li>Add <b>Iterative deepening</b>, then <b>Alpha-beta pruning</b>, and watch the engine get stronger; right-click any block and choose <i>Explain this block</i>.</li>
       <li>After each change, build again (step 10) and let the new version play the old one.</li></ul>
       <p>The <a href="guide.html#Home" target="_blank" rel="noopener">guide</a> shows how to change blocks, make your own and build on them. Stuck, or have an idea? Click <b>Feedback</b> at the top.</p>`,
  },
];

const KEY = "cfs.tutorial.step";
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
  private card: HTMLElement | null = null;
  private pointed: Element | null = null;

  constructor(private readonly host: TutorialHost) {}

  get running(): boolean {
    return this.index >= 0;
  }

  /** Continues a tutorial left open before a reload, or offers it once to new visitors. */
  resumeOrOffer(): void {
    const saved = Number(store.get(KEY));
    if (store.get(KEY) !== null && saved >= 0 && saved < STEPS.length) return this.go(saved);
    if (store.get(SEEN)) return;
    store.set(SEEN, "1");
    this.offer();
  }

  start(): void {
    store.set(SEEN, "1");
    this.go(0);
  }

  stop(): void {
    this.index = -1;
    store.set(KEY, null);
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
    store.set(KEY, String(index));
    this.host.clearLines();
    STEPS[index]!.enter?.(this.host);
    this.render(true);
  }

  private render(fresh: boolean): void {
    const step = STEPS[this.index]!;
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
    const last = this.index === STEPS.length - 1;
    card.innerHTML = `<div class="tut-head"><span>Tutorial · ${this.index + 1} of ${STEPS.length}</span><button type="button" class="tut-x" title="Close the tutorial" aria-label="Close the tutorial">×</button></div>
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
    if (this.index >= STEPS.length - 1) return this.stop();
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
