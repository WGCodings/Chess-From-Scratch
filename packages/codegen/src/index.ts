/**
 * @cfs/codegen turns a Chess From Scratch workspace into a Rust Cargo project.
 *
 * This package has no UI or DOM dependencies so it can run in the browser,
 * in a Tauri app or on a compile server. Sprint 0 ships only the project
 * metadata pieces; search and eval generation arrive in Sprint 2.
 */

export const WORKSPACE_FORMAT_VERSION = 1;

export interface EngineInfo {
  name: string;
  author: string;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

/** Turns a display name into a valid Cargo package name. */
export function toCrateName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) return "my-engine";
  return /^[0-9]/.test(slug) ? `engine-${slug}` : slug;
}

/** Generates the exported project's Cargo.toml. */
export function generateCargoToml(info: EngineInfo): GeneratedFile {
  const contents = [
    "[package]",
    `name = "${toCrateName(info.name)}"`,
    'version = "0.1.0"',
    'edition = "2021"',
    `authors = [${JSON.stringify(info.author)}]`,
    "",
    "[dependencies]",
    'cfs-runtime = { path = "runtime" }',
    "",
    "[profile.release]",
    "opt-level = 3",
    'lto = "fat"',
    "codegen-units = 1",
    'panic = "abort"',
    "",
  ].join("\n");
  return { path: "Cargo.toml", contents };
}
