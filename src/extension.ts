import * as vscode from "vscode";
import { lint as lintMarkdown } from "markdownlint/sync";
import type { LintError } from "markdownlint";
import { MdmaSyntaxError, parseFile } from "typescript-mdma";
import { formatMdma } from "./formatter.js";

const LANGUAGE_ID = "mdma";
const DIAGNOSTIC_SOURCE = "mdma";
const DEBOUNCE_MS = 300;

const MARKDOWNLINT_CONFIG = {
  default: true,
  MD013: { line_length: 80 },
  // Block headers/modifiers look like HTML tags -- not real inline HTML.
  MD033: false,
  // Every mdma file starts with "@inputs", never a heading -- this rule
  // would fail on every file by construction.
  MD041: false,
};

// Stand-in for a pure control-tag line inside a block body: real content (so
// MD012's consecutive-blank-line count isn't thrown off by {% if %}-style
// lines that aren't blank in the source), but inert content that no default
// rule flags.
const CONTROL_LINE_PLACEHOLDER = "<!-- -->";

// Best-effort re-detection of mdma's own syntax (input declarations, block
// headers, control-flow tags) so blocks can be markdown-linted as the
// independent fragments they'll be rendered into, rather than one flat
// document. This intentionally duplicates fileParser.ts's line patterns
// rather than depending on it, since parseFile() doesn't expose block source
// ranges and body errors are numbered relative to the block, not the file.
const INPUT_DECL_RE =
  /^[A-Za-z_][A-Za-z0-9_]*\s*:\s*(string\[\]|number\[\]|object\[\]|string|number|boolean|object)\s*(?:=\s*[\s\S]+)?$/;
const SIMPLE_HEADER_RE = /^<([A-Za-z0-9][A-Za-z0-9-]*)>$/;
const OPEN_HEADER_RE = /^<\s*([A-Za-z0-9][A-Za-z0-9-]*)?\s*$/;
const CLOSE_HEADER_RE = /^>\s*$/;
const CONTROL_TAG_LINE_RE =
  /^\{%-?\s*(if\s+[\s\S]+|elif\s+[\s\S]+|else|endif|for\s+[A-Za-z_][A-Za-z0-9_]*\s+in\s+[\s\S]+|endfor)\s*-?%\}$/;

interface LineRange {
  start: number; // inclusive, 0-based
  end: number; // exclusive
}

/** Locates each block's body line range (start inclusive, end exclusive). */
function findBlockBodies(lines: string[]): LineRange[] {
  let idx = 0;

  if (lines[0]?.trim() === "@inputs") {
    idx = 1;
    while (idx < lines.length) {
      const stripped = lines[idx].trim();
      if (stripped === "" || SIMPLE_HEADER_RE.test(stripped) || OPEN_HEADER_RE.test(stripped)) break;
      if (!INPUT_DECL_RE.test(stripped)) break;
      idx += 1;
    }
  }

  const bodies: LineRange[] = [];
  while (idx < lines.length) {
    const stripped = lines[idx].trim();
    if (stripped === "") {
      idx += 1;
      continue;
    }
    if (SIMPLE_HEADER_RE.test(stripped)) {
      idx += 1;
    } else if (OPEN_HEADER_RE.test(stripped)) {
      idx += 1;
      while (idx < lines.length) {
        const inner = lines[idx].trim();
        idx += 1;
        if (CLOSE_HEADER_RE.test(inner) || inner === "") break;
      }
    } else {
      // Not a header where one was expected (malformed input); treat the
      // rest of the file as a single trailing body rather than looping.
      bodies.push({ start: idx, end: lines.length });
      break;
    }

    const start = idx;
    while (idx < lines.length) {
      const s = lines[idx].trim();
      if (SIMPLE_HEADER_RE.test(s) || OPEN_HEADER_RE.test(s)) break;
      idx += 1;
    }
    bodies.push({ start, end: idx });
  }

  return bodies;
}

function blankControlLines(bodyLines: string[]): string {
  return bodyLines
    .map((line) => (CONTROL_TAG_LINE_RE.test(line.trim()) ? CONTROL_LINE_PLACEHOLDER : line))
    .join("\n");
}

function syntaxDiagnostics(doc: vscode.TextDocument): vscode.Diagnostic[] {
  try {
    parseFile(doc.getText());
    return [];
  } catch (err) {
    if (!(err instanceof MdmaSyntaxError)) throw err;

    const match = /\bline (\d+)\b/i.exec(err.message);
    const line = match ? Math.min(parseInt(match[1], 10) - 1, doc.lineCount - 1) : 0;
    const range = doc.lineAt(Math.max(line, 0)).range;

    const diagnostic = new vscode.Diagnostic(range, err.message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = DIAGNOSTIC_SOURCE;
    return [diagnostic];
  }
}

function toDiagnostic(doc: vscode.TextDocument, error: LintError, lineOffset: number): vscode.Diagnostic {
  const line = Math.max(lineOffset + error.lineNumber - 1, 0);
  const lineRange = doc.lineAt(Math.min(line, doc.lineCount - 1)).range;
  const range = error.errorRange
    ? new vscode.Range(line, error.errorRange[0] - 1, line, error.errorRange[0] - 1 + error.errorRange[1])
    : lineRange;

  const detail = error.errorDetail ? ` [${error.errorDetail}]` : "";
  const diagnostic = new vscode.Diagnostic(
    range,
    `${error.ruleNames.join("/")} ${error.ruleDescription}${detail}`,
    vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = error.ruleNames[0];
  return diagnostic;
}

function markdownDiagnostics(doc: vscode.TextDocument): vscode.Diagnostic[] {
  const lines = doc.getText().split("\n");
  const bodies = findBlockBodies(lines);

  const strings = Object.fromEntries(
    bodies.map((body, i) => [String(i), blankControlLines(lines.slice(body.start, body.end))])
  );
  const results = lintMarkdown({ strings, config: MARKDOWNLINT_CONFIG });

  return bodies.flatMap((body, i) => ((results[String(i)] ?? []) as LintError[]).map((e) => toDiagnostic(doc, e, body.start)));
}

function lintDocument(doc: vscode.TextDocument): vscode.Diagnostic[] {
  return [...syntaxDiagnostics(doc), ...markdownDiagnostics(doc)];
}

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  context.subscriptions.push(diagnostics);

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
      provideDocumentFormattingEdits(doc) {
        const original = doc.getText();
        const formatted = formatMdma(original);
        if (formatted === original) return [];
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(original.length));
        return [vscode.TextEdit.replace(fullRange, formatted)];
      },
    })
  );

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const lintNow = (doc: vscode.TextDocument) => {
    if (doc.languageId !== LANGUAGE_ID) return;
    diagnostics.set(doc.uri, lintDocument(doc));
  };

  const lintDebounced = (doc: vscode.TextDocument) => {
    if (doc.languageId !== LANGUAGE_ID) return;
    const key = doc.uri.toString();
    clearTimeout(debounceTimers.get(key));
    debounceTimers.set(
      key,
      setTimeout(() => lintNow(doc), DEBOUNCE_MS)
    );
  };

  vscode.workspace.textDocuments.forEach(lintNow);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lintNow),
    vscode.workspace.onDidChangeTextDocument((e) => lintDebounced(e.document)),
    vscode.workspace.onDidSaveTextDocument(lintNow),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
      const key = doc.uri.toString();
      clearTimeout(debounceTimers.get(key));
      debounceTimers.delete(key);
    })
  );

  context.subscriptions.push({
    dispose: () => debounceTimers.forEach((timer) => clearTimeout(timer)),
  });
}

export function deactivate(): void {}
