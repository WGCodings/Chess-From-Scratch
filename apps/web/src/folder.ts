/**
 * A linked folder on your computer (File System Access API, Chrome and Edge):
 * the app writes the whole Cargo project there, so you can open it in VS
 * Code with rust-analyzer, build it with cargo, and edit it. Saved edits come
 * back: code between block markers becomes blocks, edited block files update
 * the blocks, and changes made in the app are written out again.
 */

import { viewOf, type GeneratedFile } from "@cfs/codegen";

/** What the folder sync needs from the app. */
export interface FolderHost {
  /** The current generated project, or null when it has errors. */
  files(): GeneratedFile[] | null;
  /** Edited source files: apply them; returns error messages (empty = applied). */
  applyCode(
    edits: { path: string; text: string }[],
    base: GeneratedFile[],
  ): { path: string; line: number; message: string }[] | Promise<{ path: string; line: number; message: string }[]>;
  /** An edited block file: apply it; returns an error message or null. */
  applyBlockFile(id: string, text: string): string | null;
  status(text: string, level: "ok" | "busy" | "error"): void;
  errors(list: { path: string; line: number; message: string }[]): void;
}

type DirHandle = FileSystemDirectoryHandle;

/** What a file looks like in the folder: hooks shown as comment lines in editable files. */
export function folderText(f: GeneratedFile): string {
  return f.origins ? `${viewOf(f).lines.join("\n")}\n` : f.contents;
}

const IGNORED = new Set(["target", ".git", ".vscode", ".idea"]);

export class FolderSync {
  /** Text we last wrote (or accepted) per path. */
  private written = new Map<string, string>();
  /** The generated files the written texts came from. */
  private base: GeneratedFile[] = [];
  /** Texts that could not be applied: not retried until they change. */
  private rejected = new Map<string, string>();
  private timer: number | undefined;
  private busy = false;

  constructor(
    readonly dir: DirHandle,
    private host: FolderHost,
  ) {}

  get name(): string {
    return this.dir.name;
  }

  start(intervalMs = 1500): void {
    this.stop();
    this.timer = window.setInterval(() => void this.poll(), intervalMs);
  }

  stop(): void {
    window.clearInterval(this.timer);
  }

  private async fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parts = path.split("/");
    let d: DirHandle = this.dir;
    try {
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
      return await d.getFileHandle(parts.at(-1)!, { create });
    } catch {
      return null;
    }
  }

  private async read(path: string): Promise<string | null> {
    const h = await this.fileHandle(path, false);
    if (!h) return null;
    return (await h.getFile()).text();
  }

  private async write(path: string, text: string): Promise<void> {
    const h = await this.fileHandle(path, true);
    if (!h) throw new Error(`Could not write ${path}`);
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
  }

  private async remove(path: string): Promise<void> {
    const parts = path.split("/");
    let d: DirHandle = this.dir;
    try {
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      await d.removeEntry(parts.at(-1)!);
    } catch {
      // Already gone.
    }
  }

  /** Writes every changed file of the project; removes files the project no longer has. */
  async writeOut(): Promise<void> {
    const files = this.host.files();
    if (!files || this.busy) return;
    this.busy = true;
    try {
      const now = new Map(files.map((f) => [f.path, folderText(f)]));
      for (const [path, text] of now) {
        if (this.written.get(path) === text) continue;
        // Don't overwrite an edit that is still waiting to be fixed.
        if (this.rejected.has(path)) continue;
        await this.write(path, text);
        this.written.set(path, text);
      }
      for (const path of [...this.written.keys()]) {
        if (!now.has(path) && !IGNORED.has(path.split("/")[0]!)) {
          await this.remove(path);
          this.written.delete(path);
        }
      }
      this.base = files;
      this.host.status(`Linked to ${this.name}`, "ok");
    } catch (err) {
      this.host.status(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this.busy = false;
    }
  }

  /** Reads the folder and applies files that were edited outside the app. */
  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let applied = false;
    try {
      const code: { path: string; text: string }[] = [];
      const blocks: { id: string; path: string; text: string }[] = [];
      for (const [path, mine] of this.written) {
        const text = await this.read(path);
        if (text === null || text === mine || this.rejected.get(path) === text) continue;
        if (text !== mine && this.rejected.has(path) && this.rejected.get(path) !== text) this.rejected.delete(path);
        const block = /^blocks\/([a-z][a-z0-9_]*)\.block\.rs$/.exec(path);
        if (block) blocks.push({ id: block[1]!, path, text });
        else if (this.base.find((f) => f.path === path)?.origins) code.push({ path, text });
      }
      // Blocks also live in blocks/ files written outside the app.
      for (const name of await this.listBlockFiles()) {
        const path = `blocks/${name}`;
        if (this.written.has(path)) continue;
        const text = await this.read(path);
        const id = /^([a-z][a-z0-9_]*)\.block\.rs$/.exec(name)?.[1];
        if (text !== null && id && this.rejected.get(path) !== text) blocks.push({ id, path, text });
      }
      if (!code.length && !blocks.length) return;
      this.host.status("Reading your changes…", "busy");
      const errors: { path: string; line: number; message: string }[] = [];
      for (const b of blocks) {
        const err = this.host.applyBlockFile(b.id, b.text);
        if (err) {
          errors.push({ path: b.path, line: 0, message: err });
          this.rejected.set(b.path, b.text);
        } else {
          this.written.set(b.path, b.text);
          applied = true;
        }
      }
      if (code.length) {
        const errs = await this.host.applyCode(code, this.base);
        if (errs.length) {
          errors.push(...errs);
          for (const c of code) this.rejected.set(c.path, c.text);
        } else {
          for (const c of code) {
            this.written.set(c.path, c.text);
            this.rejected.delete(c.path);
          }
          applied = true;
        }
      }
      this.host.errors(errors);
      if (errors.length) this.host.status(`Linked to ${this.name}: fix the problems shown, then save again`, "error");
    } catch (err) {
      this.host.status(err instanceof Error ? err.message : String(err), "error");
    } finally {
      this.busy = false;
    }
    // The app regenerated the project from the new blocks: write it back.
    if (applied) await this.writeOut();
  }

  private async listBlockFiles(): Promise<string[]> {
    try {
      const d = await this.dir.getDirectoryHandle("blocks");
      const names: string[] = [];
      for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (h.kind === "file" && name.endsWith(".block.rs")) names.push(name);
      }
      return names;
    } catch {
      return [];
    }
  }

  /** Forget a rejected edit (after the user cancels it in the app). */
  clearRejected(): void {
    this.rejected.clear();
  }
}

// Remembering the folder between visits (handles can be stored in IndexedDB).

const DB = "cfs-folder";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("handles");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function rememberFolder(handle: DirHandle | null): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction("handles", "readwrite");
    if (handle) tx.objectStore("handles").put(handle, "folder");
    else tx.objectStore("handles").delete("folder");
  } catch {
    // Not remembered; the user links again next time.
  }
}

export async function rememberedFolder(): Promise<DirHandle | null> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const req = d.transaction("handles").objectStore("handles").get("folder");
      req.onsuccess = () => resolve((req.result as DirHandle | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export const canLinkFolders = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
