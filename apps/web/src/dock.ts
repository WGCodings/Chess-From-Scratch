// The dock under the canvas: run the engine and talk to it (Engine tab), and
// a terminal in the engine's folder (Terminal tab). Both need the desktop
// app; on the website the dock says so and offers the download.

import { DESKTOP_DOWNLOAD_URL, desktop, type EngineEvent, type ProjectFile } from "./platform";

export interface DockHost {
  /** The engine's crate name and files, or why there are none yet. */
  project(): { name: string; files: ProjectFile[] } | { problem: string };
  /** Called when the dock opens, closes or changes height. */
  layoutChanged(): void;
  /** Called when the engine starts, stops or answers. */
  stateChanged(): void;
  toast(message: string): void;
}

type Tab = "engine" | "terminal";
type LineKind = "build" | "engine" | "sent" | "note" | "error";

const HISTORY_KEY = "cfs.console.history";
const HEIGHT_KEY = "cfs.dock.height";
const MAX_LINES = 5000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(text: string, title: string, cls = "dock-btn"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.title = title;
  return b;
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage is a convenience */
  }
}

export class Dock {
  private readonly root: HTMLElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly panes = new Map<Tab, HTMLElement>();
  private readonly status: HTMLElement;
  private readonly output: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly folderBtn: HTMLButtonElement;
  private readonly termHost: HTMLElement;
  private tab: Tab = "engine";
  private dir: string | null = null;
  private running = false;
  private busy = false;
  private answered = false;
  private history: string[] = load(HISTORY_KEY, []);
  private historyAt = -1;
  private terminal: { id: number; fit: () => void; focus: () => void; dispose: () => void } | null = null;
  private terminalOpening: Promise<void> | null = null;

  constructor(
    root: HTMLElement,
    private readonly host: DockHost,
  ) {
    this.root = root;
    root.classList.add("dock");
    root.style.height = `${load(HEIGHT_KEY, 280)}px`;

    const grip = el("div", "dock-grip");
    grip.title = "Drag to resize";
    this.dragToResize(grip);

    const head = el("div", "dock-head");
    for (const [tab, label] of [
      ["engine", "Engine"],
      ["terminal", "Terminal"],
    ] as const) {
      const t = button(label, tab === "engine" ? "Build, run and talk to your engine" : "A terminal in your engine's folder", "dock-tab");
      t.dataset.tab = tab;
      t.addEventListener("click", () => this.show(tab));
      this.tabs.set(tab, t);
      head.append(t);
    }
    this.status = el("span", "dock-status");
    this.runBtn = button("▶ Run", "Build the engine with cargo and start it", "dock-btn run");
    this.runBtn.addEventListener("click", () => void this.run());
    this.stopBtn = button("■ Stop", "Stop the engine");
    this.stopBtn.addEventListener("click", () => void this.stop());
    this.folderBtn = button("Folder", "Show the engine's project folder");
    this.folderBtn.addEventListener("click", () => void this.revealFolder());
    const close = button("✕", "Close the panel", "dock-btn close");
    close.addEventListener("click", () => this.close());
    head.append(this.status, this.runBtn, this.stopBtn, this.folderBtn, close);

    // Engine tab: output, quick commands, a command line.
    const enginePane = el("div", "dock-pane engine-pane");
    this.output = el("pre", "dock-output");
    this.output.setAttribute("aria-live", "polite");
    const quick = el("div", "dock-quick");
    const depth = el("input", "dock-num");
    depth.type = "number";
    depth.min = "1";
    depth.max = "64";
    depth.value = "6";
    depth.title = "Depth for go depth";
    const movetime = el("input", "dock-num");
    movetime.type = "number";
    movetime.min = "10";
    movetime.step = "100";
    movetime.value = "1000";
    movetime.title = "Milliseconds for go movetime";
    const fen = el("input", "dock-fen");
    fen.placeholder = "FEN, e.g. r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    fen.spellcheck = false;
    const send = (cmd: () => string, title: string, label?: string) => {
      const b = button(label ?? cmd(), title, "dock-chip");
      b.addEventListener("click", () => void this.send(cmd()));
      return b;
    };
    quick.append(
      send(() => "uci", "Ask the engine its name and options"),
      send(() => "isready", "Check the engine is ready"),
      send(() => "ucinewgame", "Start a new game (clears the hash table)"),
      send(() => "position startpos", "Set the start position"),
      send(() => "d", "Draw the current board"),
      send(() => `go depth ${depth.value || "6"}`, "Search to this depth", "go depth"),
      depth,
      send(() => `go movetime ${movetime.value || "1000"}`, "Search for this many milliseconds", "go movetime"),
      movetime,
      send(() => "stop", "Stop the search"),
      send(() => "bench", "Search a set of positions and print the node count and speed"),
    );
    const fenRow = el("div", "dock-quick");
    const setFen = button("Set position", "Send position fen … for this FEN", "dock-chip");
    setFen.addEventListener("click", () => {
      const f = fen.value.trim();
      if (f) void this.send(`position fen ${f}`);
    });
    fen.addEventListener("keydown", (e) => {
      if (e.key === "Enter") setFen.click();
    });
    fenRow.append(fen, setFen);

    const line = el("div", "dock-line");
    const prompt = el("span", "dock-prompt", ">");
    this.input = el("input", "dock-input");
    this.input.placeholder = "Type a UCI command, e.g. go wtime 60000 btime 60000, then Enter (↑ for earlier ones)";
    this.input.spellcheck = false;
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    line.append(prompt, this.input);
    enginePane.append(this.output, quick, fenRow, line);

    const termPane = el("div", "dock-pane terminal-pane");
    this.termHost = el("div", "dock-terminal");
    termPane.append(this.termHost);

    this.panes.set("engine", enginePane);
    this.panes.set("terminal", termPane);
    root.append(grip, head, enginePane, termPane);

    if (!desktop) this.showWebNotice();
    this.update();
    this.show("engine", false);

    new ResizeObserver(() => this.terminal?.fit()).observe(this.termHost);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** The engine has answered a search with a bestmove. */
  get hasAnswered(): boolean {
    return this.answered;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(tab: Tab = this.tab): void {
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    this.show(tab);
    if (wasHidden) this.host.layoutChanged();
  }

  close(): void {
    this.root.hidden = true;
    this.host.layoutChanged();
  }

  toggle(tab: Tab): void {
    if (this.isOpen && this.tab === tab) this.close();
    else this.open(tab);
  }

  /** Builds the engine and starts it. */
  async run(): Promise<void> {
    this.open("engine");
    if (!desktop) return;
    if (this.busy) return;
    const project = this.host.project();
    if ("problem" in project) {
      this.print(`Can't run yet: ${project.problem}`, "error");
      return;
    }
    this.busy = true;
    this.update();
    try {
      try {
        const version = await desktop.rustVersion();
        this.print(`Using ${version}`, "note");
      } catch (err) {
        this.print(String(err), "error");
        this.print("After installing Rust, restart Chess From Scratch and click Run again.", "note");
        return;
      }
      if (this.running) await this.stop();
      const dir = await this.projectDir(project.name);
      await desktop.writeProject(dir, project.files);
      this.print(`Building ${project.name} in ${dir} …`, "note");
      this.setStatus("Building…");
      const program = await desktop.buildEngine(dir, (l) => this.print(l, "build"));
      this.print("Built. Starting the engine…", "note");
      await desktop.startEngine(program, dir, (e) => this.onEngine(e));
      this.running = true;
      await this.send("uci");
      this.input.focus();
    } catch (err) {
      this.print(String(err), "error");
    } finally {
      this.busy = false;
      this.update();
    }
  }

  async stop(): Promise<void> {
    if (!desktop || !this.running) return;
    await desktop.stopEngine();
    this.running = false;
    this.update();
  }

  /** Sends a command to the engine and remembers it. */
  async send(command: string): Promise<void> {
    if (!desktop) return;
    const cmd = command.trim();
    if (!cmd) return;
    if (!this.running) {
      this.print("The engine is not running. Click ▶ Run first.", "error");
      return;
    }
    this.print(cmd, "sent");
    if (this.history[this.history.length - 1] !== cmd) {
      this.history.push(cmd);
      this.history = this.history.slice(-100);
      store(HISTORY_KEY, this.history);
    }
    this.historyAt = -1;
    try {
      await desktop.sendEngine(cmd);
    } catch (err) {
      this.print(String(err), "error");
      this.running = false;
      this.update();
    }
  }

  private async projectDir(name: string): Promise<string> {
    if (!desktop) throw new Error("No desktop");
    this.dir = await desktop.defaultProjectDir(name);
    return this.dir;
  }

  private onEngine(e: EngineEvent): void {
    if (e.kind === "line") {
      this.print(e.text, "engine");
      if (!this.answered && e.text.startsWith("bestmove")) {
        this.answered = true;
        this.host.stateChanged();
      }
    } else {
      this.print(e.text, "note");
      this.running = false;
      this.update();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      const v = this.input.value;
      this.input.value = "";
      void this.send(v);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!this.history.length) return;
      e.preventDefault();
      if (e.key === "ArrowUp") this.historyAt = this.historyAt < 0 ? this.history.length - 1 : Math.max(0, this.historyAt - 1);
      else this.historyAt = this.historyAt < 0 ? -1 : this.historyAt + 1;
      if (this.historyAt >= this.history.length) this.historyAt = -1;
      this.input.value = this.historyAt < 0 ? "" : this.history[this.historyAt]!;
    }
  }

  private print(text: string, kind: LineKind): void {
    const atBottom = this.output.scrollHeight - this.output.scrollTop - this.output.clientHeight < 24;
    const line = el("div", `out-${kind}`, kind === "sent" ? `> ${text}` : text);
    this.output.append(line);
    while (this.output.childElementCount > MAX_LINES) this.output.firstElementChild!.remove();
    if (atBottom || kind === "sent") this.output.scrollTop = this.output.scrollHeight;
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private update(): void {
    this.runBtn.disabled = this.busy || !desktop;
    this.runBtn.textContent = this.running ? "↻ Rebuild" : "▶ Run";
    this.runBtn.title = this.running ? "Build the engine again with your latest blocks and restart it" : "Build the engine with cargo and start it";
    this.stopBtn.disabled = !this.running;
    this.folderBtn.disabled = !desktop;
    this.input.disabled = !desktop;
    this.setStatus(!desktop ? "Desktop app only" : this.busy ? "Building…" : this.running ? "Running" : "Stopped");
    this.root.dataset.state = this.busy ? "busy" : this.running ? "running" : "stopped";
    this.host.stateChanged();
  }

  private show(tab: Tab, focus = true): void {
    this.tab = tab;
    for (const [t, b] of this.tabs) b.classList.toggle("active", t === tab);
    for (const [t, p] of this.panes) p.hidden = t !== tab;
    if (tab === "terminal" && !this.root.hidden) void this.openTerminal().then(() => focus && this.terminal?.focus());
    else if (focus && !this.root.hidden) this.input.focus();
  }

  private async revealFolder(): Promise<void> {
    if (!desktop) return;
    const project = this.host.project();
    const dir = this.dir ?? ("name" in project ? await this.projectDir(project.name) : null);
    if (!dir) return this.host.toast("Add an Engine block first.");
    if ("files" in project) await desktop.writeProject(dir, project.files);
    await desktop.revealFolder(dir).catch((err) => this.host.toast(String(err)));
  }

  private openTerminal(): Promise<void> {
    if (!desktop || this.terminal) return Promise.resolve();
    this.terminalOpening ??= this.startTerminal().finally(() => (this.terminalOpening = null));
    return this.terminalOpening;
  }

  private async startTerminal(): Promise<void> {
    if (!desktop) return;
    const d = desktop;
    const project = this.host.project();
    // The terminal starts in the engine's folder, with its files written there.
    let dir = this.dir;
    if ("name" in project) {
      dir = await this.projectDir(project.name);
      await d.writeProject(dir, project.files).catch(() => undefined);
    }
    if (!dir) {
      this.termHost.textContent = "Add an Engine block first: the terminal opens in your engine's folder.";
      return;
    }
    this.termHost.textContent = "";
    const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
    await import("@xterm/xterm/css/xterm.css");
    const term = new Terminal({
      fontFamily: 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: "#1f2420", foreground: "#e4e6df" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(this.termHost);
    fit.fit();
    const id = await d.openTerminal(dir, term.cols, term.rows, (data) => term.write(data));
    term.onData((data) => void d.writeTerminal(id, data));
    term.onResize(({ cols, rows }) => void d.resizeTerminal(id, cols, rows));
    this.terminal = {
      id,
      fit: () => {
        if (!this.termHost.offsetParent) return;
        fit.fit();
      },
      focus: () => term.focus(),
      dispose: () => {
        void d.closeTerminal(id);
        term.dispose();
      },
    };
  }

  private showWebNotice(): void {
    const notice = (what: string) => {
      const box = el("div", "dock-notice");
      box.innerHTML = `<strong>${what} needs the desktop app</strong>
        <p>The website is the demo: build engines and export them. The free Chess From Scratch app for Windows, macOS and Linux also
        builds, runs and tests your engine, with a terminal, and works offline.</p>
        <p>On the website, use <b>Export Rust project</b> and build it yourself: see the guide page <i>Build, test and play</i>.</p>`;
      const a = el("a", "btn primary", "Get the desktop app");
      a.href = DESKTOP_DOWNLOAD_URL;
      a.target = "_blank";
      a.rel = "noopener";
      box.append(a);
      return box;
    };
    this.panes.get("engine")!.replaceChildren(notice("Running your engine"));
    this.termHost.replaceChildren(notice("The terminal"));
  }

  private dragToResize(grip: HTMLElement): void {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = this.root.getBoundingClientRect().height;
      const move = (ev: PointerEvent) => {
        const h = Math.max(140, Math.min(window.innerHeight - 160, startH + startY - ev.clientY));
        this.root.style.height = `${h}px`;
        this.host.layoutChanged();
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        store(HEIGHT_KEY, Math.round(this.root.getBoundingClientRect().height));
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });
  }
}
