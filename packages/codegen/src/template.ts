/**
 * Block regions in Rust templates:
 *
 *     // @block null_move_pruning
 *     ...code kept, with its markers, when the block is placed...
 *     // @else
 *     ...optional fallback emitted (without markers) when it is not...
 *     // @end null_move_pruning
 *
 * Regions do not nest. The markers kept in the output let a future importer
 * map generated code back to blocks.
 */

const BLOCK = /^\s*\/\/ @block (\w+)\s*$/;
const ELSE = /^\s*\/\/ @else\s*$/;
const END = /^\s*\/\/ @end (\w+)\s*$/;

export class TemplateError extends Error {}

export function renderTemplate(
  source: string,
  enabled: ReadonlySet<string>,
  known: ReadonlySet<string>,
  file = "template",
): string {
  const out: string[] = [];
  let region: string | null = null;
  let inElse = false;
  const lines = source.split("\n");

  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const block = BLOCK.exec(line);
    const end = END.exec(line);
    if (block) {
      if (region) throw new TemplateError(`${where}: @block ${block[1]} inside ${region}`);
      if (!known.has(block[1]!)) throw new TemplateError(`${where}: unknown block ${block[1]}`);
      region = block[1]!;
      inElse = false;
      if (enabled.has(region)) out.push(line);
    } else if (ELSE.test(line)) {
      if (!region || inElse) throw new TemplateError(`${where}: stray @else`);
      inElse = true;
    } else if (end) {
      if (end[1] !== region) throw new TemplateError(`${where}: @end ${end[1]} does not close ${region}`);
      if (enabled.has(region)) out.push(line);
      region = null;
      inElse = false;
    } else if (!region) {
      out.push(line);
    } else if (enabled.has(region) !== inElse) {
      out.push(line);
    }
  });
  if (region) throw new TemplateError(`${file}: @block ${region} is never closed`);

  // Tidy up what removed regions leave behind, the way rustfmt would.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // at most one blank line in a row
    .replace(/\{\n\n/g, "{\n") // no blank line after an opening brace
    .replace(/\n\n([ \t]*\})/g, "\n$1") // no blank line before a closing brace
    .replace(/\{\n[ \t]*\}/g, "{}") // empty bodies on one line
    .replace(/\n*$/, "\n"); // exactly one newline at the end
}
