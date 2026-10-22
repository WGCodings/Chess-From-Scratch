// Extracts the public API of cozy-chess (types, methods, constants, enum
// variants, free functions, with the first line of their docs) into
// src/cozy-api.generated.ts, for autocompletion in the code editors.
//
//   node scripts/cozy-api.mjs [path to the cargo registry src folder]
//
// The output is committed, so this only needs to run when cozy-chess changes.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const registry = process.argv[2] ?? join(homedir(), ".cargo/registry/src");
const index = readdirSync(registry).map((d) => join(registry, d));
const find = (name) => index.map((d) => join(d, name)).find((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
const crates = [find("cozy-chess-0.3.4"), find("cozy-chess-types-0.2.2")].filter(Boolean);
if (crates.length < 2) throw new Error(`cozy-chess sources not found under ${registry}`);

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".rs") && !p.includes("/tests") && !f.includes("build")) files.push(p);
  }
};
for (const c of crates) walk(join(c, "src"));

const api = {}; // type -> items
const add = (type, item) => {
  api[type] ??= [];
  if (!api[type].some((i) => i.name === item.name && i.kind === item.kind)) api[type].push(item);
};
const firstSentence = (doc) => {
  const text = doc.join(" ").replace(/`/g, "").replace(/\s+/g, " ").trim();
  const m = /^(.*?[.!?])(\s|$)/.exec(text);
  return (m ? m[1] : text).slice(0, 160);
};

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  let doc = [];
  let impl = null;
  let depth = 0;
  let implDepth = -1;
  let inEnum = null;
  let inStruct = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.startsWith("///")) {
      doc.push(line.replace(/^\/\/\/\s?/, ""));
      continue;
    }
    if (line.startsWith("#[") || line === "") {
      if (line === "") doc = [];
      continue;
    }
    const implM = /^impl(?:<[^>]*>)?\s+([A-Z]\w*)\s*\{/.exec(line);
    if (implM && implDepth < 0) {
      impl = implM[1];
      implDepth = depth;
    }
    const enumM = /^pub enum ([A-Z]\w*)/.exec(line);
    if (enumM) {
      inEnum = enumM[1];
      add(inEnum, { name: "ALL", kind: "const", sig: `${inEnum}::ALL`, doc: `Every ${inEnum}, in order.` });
      add(inEnum, { name: "NUM", kind: "const", sig: "usize", doc: `The number of ${inEnum} values.` });
      add(inEnum, { name: "index", kind: "assoc", sig: `fn index(index: usize) -> ${inEnum}`, doc: "The value with this index." });
      add(inEnum, { name: "try_index", kind: "assoc", sig: `fn try_index(index: usize) -> Option<${inEnum}>`, doc: "The value with this index, if any." });
    } else if (inEnum && /^\w+\s*(=.*)?,?$/.test(line) && !line.startsWith("}")) {
      add(inEnum, { name: line.replace(/[,=].*$/, "").trim(), kind: "variant", sig: `${inEnum}::${line.replace(/[,=].*$/, "").trim()}`, doc: firstSentence(doc) });
    }
    if (inEnum && line.startsWith("}")) inEnum = null;
    const structM = /^pub struct ([A-Z]\w*)\s*\{/.exec(line);
    if (structM) inStruct = structM[1];
    else if (inStruct && /^pub (\w+):\s*(.+?),?$/.test(line)) {
      const [, name, type] = /^pub (\w+):\s*(.+?),?$/.exec(line);
      add(inStruct, { name, kind: "field", sig: type, doc: firstSentence(doc) });
    }
    if (inStruct && line.startsWith("}")) inStruct = null;

    const fnM = /^pub (?:const )?fn (\w+)/.exec(line);
    if (fnM) {
      let sig = line;
      let k = i;
      while (!/[{;]\s*$/.test(sig) && k + 1 < lines.length) sig += ` ${lines[++k].trim()}`;
      sig = sig.replace(/\s*(where\b.*)?\{\s*$/, "").replace(/^pub (const )?/, "").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/,\s*\)/g, ")");
      const takesSelf = /\(\s*(&\s*(mut\s+)?)?self\b/.test(sig);
      const ret = /->\s*(.+)$/.exec(sig)?.[1]?.trim();
      const item = { name: fnM[1], kind: impl && implDepth >= 0 ? (takesSelf ? "method" : "assoc") : "function", sig, doc: firstSentence(doc), ...(ret ? { ret } : {}) };
      if (impl && implDepth >= 0) add(impl, item);
      else add("", item);
    }
    const constM = /^pub const ([A-Z][A-Z0-9_]*)\s*:\s*([^=]+)=/.exec(line);
    if (constM && impl && implDepth >= 0) add(impl, { name: constM[1], kind: "const", sig: constM[2].trim(), doc: firstSentence(doc) });
    for (const c of raw) {
      if (c === "{") depth++;
      if (c === "}") {
        depth--;
        if (depth === implDepth) {
          impl = null;
          implDepth = -1;
        }
      }
    }
    doc = [];
  }
}

// Only the parts an engine author uses.
const keep = ["", "Board", "BitBoard", "Square", "File", "Rank", "Piece", "Color", "Move", "GameStatus", "CastleRights", "BoardBuilder"];
const out = Object.fromEntries(keep.filter((k) => api[k]).map((k) => [k, api[k].filter((i) => !i.name.startsWith("_")).sort((a, b) => a.name.localeCompare(b.name))]));
// Free functions: the move generators and helpers, not the internal variants.
out[""] = out[""].filter((i) => !/^(index|index_const|try_index)$|_slow$|_const$|_index$|relevant_blockers/.test(i.name));
out.BitBoard = out.BitBoard.filter((i) => i.name !== "AMOGUS");
// Square variants come from a macro: A1 .. H8.
for (const r of "12345678") for (const f of "ABCDEFGH") out.Square.push({ name: `${f}${r}`, kind: "variant", sig: `Square::${f}${r}`, doc: `The square ${f.toLowerCase()}${r}.` });
const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cozy-api.generated.ts");
writeFileSync(
  dest,
  `// Generated by scripts/cozy-api.mjs from cozy-chess 0.3.4. Do not edit.\n\nexport interface ApiItem {\n  name: string;\n  kind: "method" | "assoc" | "const" | "variant" | "field" | "function";\n  sig: string;\n  doc: string;\n  ret?: string;\n}\n\n/** Items by type ("" = free functions). */\nexport const COZY_API: Record<string, ApiItem[]> = ${JSON.stringify(out, null, 2)};\n`,
);
console.log(Object.entries(out).map(([k, v]) => `${k || "(functions)"}: ${v.length}`).join(", "));
