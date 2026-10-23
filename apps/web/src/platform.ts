// What the editor can do beyond a browser. On the website `desktop` is null
// and these features explain the desktop app instead; in the desktop app
// (Tauri) they call the Rust commands in apps/desktop/src-tauri. Everything
// else is the same code for both.

export interface ProjectFile {
  path: string;
  contents: string;
}

export type EngineEvent = { kind: "line"; text: string } | { kind: "exit"; text: string };

export interface Desktop {
  /** `<app data>/engines/<name>`: where an engine's project is written. */
  defaultProjectDir(name: string): Promise<string>;
  writeProject(dir: string, files: ProjectFile[]): Promise<void>;
  /** `cargo --version`; rejects when Rust is not installed. */
  rustVersion(): Promise<string>;
  /** `cargo build --release`; resolves with the program's path. */
  buildEngine(dir: string, onLine: (line: string) => void): Promise<string>;
  startEngine(program: string, dir: string, onEvent: (e: EngineEvent) => void): Promise<void>;
  sendEngine(line: string): Promise<void>;
  stopEngine(): Promise<void>;
  openTerminal(dir: string, cols: number, rows: number, onData: (data: string) => void): Promise<number>;
  writeTerminal(id: number, data: string): Promise<void>;
  resizeTerminal(id: number, cols: number, rows: number): Promise<void>;
  closeTerminal(id: number): Promise<void>;
  /** Shows a folder in the file manager. */
  revealFolder(dir: string): Promise<void>;
  /** Opens a web page in the user's browser. */
  openUrl(url: string): Promise<void>;
  /** Lets the user pick a folder; null when they cancel. */
  pickFolder(title: string): Promise<string | null>;
  /** Asks where to save a file; null when they cancel. */
  pickSaveFile(defaultName: string, filter: FileFilter): Promise<string | null>;
  /** Asks for a file to open; null when they cancel. */
  pickOpenFile(filter: FileFilter): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** A yes/no question in a native dialog (window.confirm when absent). */
  ask?(message: string, title: string): Promise<boolean>;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    /** Tests put a fake desktop here before the page loads. */
    __cfsDesktopMock?: Desktop;
  }
}

function tauriDesktop(): Desktop {
  const core = () => import("@tauri-apps/api/core");
  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => (await core()).invoke<T>(cmd, args);
  const channel = async <T>(fn: (v: T) => void) => {
    const { Channel } = await core();
    const ch = new Channel<T>();
    ch.onmessage = fn;
    return ch;
  };
  return {
    defaultProjectDir: (name) => call("default_project_dir", { name }),
    writeProject: (dir, files) => call("write_project", { dir, files }),
    rustVersion: () => call("rust_version"),
    buildEngine: async (dir, onLine) => call("build_engine", { dir, onLine: await channel(onLine) }),
    startEngine: async (program, dir, onEvent) => call("start_engine", { program, dir, onEvent: await channel(onEvent) }),
    sendEngine: (line) => call("send_engine", { line }),
    stopEngine: () => call("stop_engine"),
    openTerminal: async (dir, cols, rows, onData) => call("open_terminal", { dir, cols, rows, onData: await channel(onData) }),
    writeTerminal: (id, data) => call("write_terminal", { id, data }),
    resizeTerminal: (id, cols, rows) => call("resize_terminal", { id, cols, rows }),
    closeTerminal: (id) => call("close_terminal", { id }),
    revealFolder: async (dir) => (await import("@tauri-apps/plugin-opener")).revealItemInDir(dir),
    openUrl: async (url) => (await import("@tauri-apps/plugin-opener")).openUrl(url),
    pickSaveFile: async (defaultPath, filter) => (await import("@tauri-apps/plugin-dialog")).save({ defaultPath, filters: [filter] }),
    pickOpenFile: async (filter) => {
      const picked = await (await import("@tauri-apps/plugin-dialog")).open({ multiple: false, filters: [filter] });
      return typeof picked === "string" ? picked : null;
    },
    readFile: async (path) => new Uint8Array(await call<ArrayBuffer>("read_file", { path })),
    writeFile: (path, data) => call("write_file", { path, data: Array.from(data) }),
    ask: async (message, title) => (await import("@tauri-apps/plugin-dialog")).ask(message, { title, kind: "warning" }),
    pickFolder: async (title) => {
      const picked = await (await import("@tauri-apps/plugin-dialog")).open({ directory: true, title });
      return typeof picked === "string" ? picked : null;
    },
  };
}

/** The desktop app's extra powers, or null on the website. */
export const desktop: Desktop | null =
  typeof window === "undefined"
    ? null
    : window.__cfsDesktopMock ?? (window.__TAURI_INTERNALS__ ? tauriDesktop() : null);

export const isDesktop = desktop !== null;

export const DESKTOP_DOWNLOAD_URL = "https://github.com/WGCodings/Chess-From-Scratch/releases/latest";

/** Asks the user to confirm: a native dialog in the desktop app, window.confirm on the website. */
export async function confirmAction(message: string, title = "Chess From Scratch"): Promise<boolean> {
  return desktop?.ask ? desktop.ask(message, title) : window.confirm(message);
}
