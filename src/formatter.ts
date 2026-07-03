/**
 * Formats the structural syntax of an .mdma file: the @inputs declaration
 * list and block-header modifier lines. Block bodies (markdown + template
 * text) are left byte-for-byte untouched, since whitespace there is
 * semantically significant -- it drives rendered output via {%- -%}
 * trim markers -- so reflowing it could silently change what a template
 * renders.
 *
 * This intentionally duplicates fileParser.ts's line patterns rather than
 * depending on it, since parseFile() discards exact source text (e.g.
 * default-value literals, header spacing) that formatting must preserve.
 */

const INPUT_DECL_RE =
  /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(string\[\]|number\[\]|object\[\]|string|number|boolean|object)\s*(?:=\s*([\s\S]+))?$/;
const SIMPLE_HEADER_RE = /^<([A-Za-z0-9][A-Za-z0-9-]*)>$/;
const OPEN_HEADER_RE = /^<\s*([A-Za-z0-9][A-Za-z0-9-]*)?\s*$/;
const BARE_NAME_LINE_RE = /^([A-Za-z0-9][A-Za-z0-9-]*)$/;
const CLOSE_HEADER_RE = /^>\s*$/;
const MULTIPLE_MOD_RE = /^multiple\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_]*)$/;
const NAME_MOD_RE = /^name\s*:\s*(.+)$/;

interface InputDeclMatch {
  index: number;
  name: string;
  type: string;
  defaultRaw: string | undefined;
}

/** Formats the @inputs section in place, aligning ':' and '=' columns. Returns the index of the first line after the section, or null if the file doesn't start with a recognizable @inputs section. */
function formatInputsSection(lines: string[], output: string[]): number | null {
  if (lines[0]?.trim() !== "@inputs") return null;
  output[0] = "@inputs";

  const decls: InputDeclMatch[] = [];
  let idx = 1;
  while (idx < lines.length) {
    const stripped = lines[idx].trim();
    if (stripped === "" || SIMPLE_HEADER_RE.test(stripped) || OPEN_HEADER_RE.test(stripped)) break;
    const m = INPUT_DECL_RE.exec(stripped);
    if (!m) return null; // malformed declaration -- bail out, let the linter flag it
    decls.push({ index: idx, name: m[1], type: m[2], defaultRaw: m[3] });
    idx += 1;
  }

  if (decls.length === 0) return idx;

  const nameColWidth = Math.max(...decls.map((d) => d.name.length + 1));
  const withDefault = decls.filter((d) => d.defaultRaw !== undefined);
  const typeColWidth = withDefault.length > 0 ? Math.max(...withDefault.map((d) => d.type.length)) : 0;

  for (const d of decls) {
    const head = `${d.name}:`.padEnd(nameColWidth);
    output[d.index] =
      d.defaultRaw === undefined
        ? `${head} ${d.type}`
        : `${head} ${d.type.padEnd(typeColWidth)} = ${d.defaultRaw.trim()}`;
  }

  return idx;
}

/** Formats a multi-line block header's modifier lines (normalizes 'key: value' spacing). Assumes lines[idx] matches OPEN_HEADER_RE. Returns the index of the line after the closing '>', or null if the header is malformed (unterminated). */
function formatOpenHeader(lines: string[], output: string[], startIdx: number): number | null {
  let idx = startIdx;
  output[idx] = lines[idx].trim();
  const hasInlineName = OPEN_HEADER_RE.exec(lines[idx].trim())?.[1] !== undefined;
  idx += 1;

  if (!hasInlineName) {
    if (idx >= lines.length) return null;
    const nm = BARE_NAME_LINE_RE.exec(lines[idx].trim());
    if (!nm) return null;
    output[idx] = lines[idx].trim();
    idx += 1;
  }

  while (idx < lines.length) {
    const inner = lines[idx].trim();
    if (CLOSE_HEADER_RE.test(inner)) {
      output[idx] = ">";
      return idx + 1;
    }
    if (inner === "") return null; // unterminated header -- leave to the linter

    const mm = MULTIPLE_MOD_RE.exec(inner);
    if (mm) {
      output[idx] = `multiple: ${mm[1]} in ${mm[2]}`;
      idx += 1;
      continue;
    }
    const nmm = NAME_MOD_RE.exec(inner);
    if (nmm) {
      output[idx] = `name: ${nmm[1].trim()}`;
      idx += 1;
      continue;
    }
    // Unrecognized modifier line -- trim only, keep scanning for the close.
    output[idx] = inner;
    idx += 1;
  }

  return null;
}

/** Formats an .mdma document's structural syntax (@inputs alignment, block-header modifiers) while leaving block bodies untouched. */
export function formatMdma(text: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const output = lines.slice();

  const afterInputs = formatInputsSection(lines, output);
  let idx = afterInputs ?? 0;

  while (idx < lines.length) {
    const stripped = lines[idx].trim();
    if (stripped === "") {
      idx += 1;
      continue;
    }
    if (SIMPLE_HEADER_RE.test(stripped)) {
      output[idx] = stripped;
      idx += 1;
      continue;
    }
    if (OPEN_HEADER_RE.test(stripped)) {
      const next = formatOpenHeader(lines, output, idx);
      if (next === null) {
        idx += 1; // malformed header -- skip just this line, leave the rest as-is
        continue;
      }
      idx = next;
      continue;
    }
    idx += 1; // body line -- leave untouched
  }

  return output.join(eol);
}
