export type OutputLine = { id: number; text: string };
export type OutputSnapshot = { lines: OutputLine[]; source: string; omitted: number };
export type OutputRow = { cells: string[]; lineIds: number[] };
export type OutputTable = { format: "CSV" | "TSV" | "JSON"; headers: string[]; rows: OutputRow[] };
export type NumericColumn = { index: number; unit: string; values: number[] };

const MAX_LINES = 240;
const MAX_BYTES = 48 * 1024;
const MAX_ROWS = 200;
const MAX_COLUMNS = 12;

/** A contiguous suffix, never a collection of rows with silently missing middle lines. */
export function captureOutput(lines: readonly OutputLine[], source: string): OutputSnapshot {
  const captured: OutputLine[] = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0 && captured.length < MAX_LINES; index--) {
    const line = lines[index];
    const size = new TextEncoder().encode(JSON.stringify(line)).length + 1;
    if (bytes + size > MAX_BYTES) break;
    captured.push({ id: line.id, text: line.text });
    bytes += size;
  }
  return { lines: captured.reverse(), source, omitted: lines.length - captured.length };
}

function delimitedCells(line: string, delimiter: string): string[] | null {
  const cells: string[] = [];
  let index = 0;
  while (index <= line.length) {
    let cell = "";
    if (line[index] === '"') {
      index++;
      let closed = false;
      while (index < line.length) {
        if (line[index] !== '"') { cell += line[index++]; continue; }
        if (line[index + 1] === '"') { cell += '"'; index += 2; continue; }
        index++;
        closed = true;
        break;
      }
      if (!closed || (index < line.length && line[index] !== delimiter)) return null;
    } else {
      while (index < line.length && line[index] !== delimiter) {
        if (line[index] === '"') return null;
        cell += line[index++];
      }
    }
    cells.push(cell);
    if (index >= line.length) return cells;
    index++;
  }
  return cells;
}

function parseDelimited(lines: OutputLine[], delimiter: string): OutputTable | null {
  const parsed = lines.map((line) => delimitedCells(line.text, delimiter));
  const headers = parsed[0];
  if (!headers || headers.length < 2 || headers.length > MAX_COLUMNS
    || headers.some((header) => !header.trim() || header.length > 80 || !/\p{L}/u.test(header))
    || new Set(headers.map((header) => header.trim())).size !== headers.length
    || parsed.some((cells) => !cells || cells.length !== headers.length)) return null;
  return {
    format: delimiter === "\t" ? "TSV" : "CSV",
    headers,
    rows: parsed.slice(1).map((cells, index) => ({ cells: cells!, lineIds: [lines[index + 1].id] })),
  };
}

/** Flat JSON objects only. Retain the original numeric lexemes, including large integers. */
function parseJson(lines: OutputLine[]): OutputTable | null {
  const text = lines.map((line) => line.text).join("\n");
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || !value.length || value.length > MAX_ROWS) return null;
  } catch { return null; }
  const tokens = [...text.matchAll(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[\[\]{},:]/g)];
  let cursor = 0;
  const take = (expected: string) => tokens[cursor++]?.[0] === expected;
  const sourceLines = (start: number, end: number) => {
    const from = text.slice(0, start).split("\n").length - 1;
    const to = text.slice(0, end).split("\n").length - 1;
    return lines.slice(from, to + 1).map((line) => line.id);
  };
  const rows: OutputRow[] = [];
  let headers: string[] = [];
  if (!take("[")) return null;
  while (cursor < tokens.length) {
    const start = tokens[cursor]?.index ?? 0;
    if (!take("{")) return null;
    const entries = new Map<string, string>();
    while (cursor < tokens.length) {
      const key = tokens[cursor++]?.[0];
      if (!key?.startsWith('"') || !take(":")) return null;
      const name: string = JSON.parse(key);
      const raw = tokens[cursor++]?.[0];
      if (!name.trim() || name.length > 80 || entries.has(name) || !raw
        || /^[\[\]{},:]$/.test(raw)) return null;
      entries.set(name, raw.startsWith('"') ? JSON.parse(raw) as string : raw);
      if (entries.size > MAX_COLUMNS) return null;
      if (tokens[cursor]?.[0] === "}") { cursor++; break; }
      if (!take(",")) return null;
    }
    if (!rows.length) headers = [...entries.keys()];
    if (headers.length < 2 || entries.size !== headers.length || headers.some((header) => !entries.has(header))) return null;
    const end = tokens[cursor - 1]?.index ?? start;
    rows.push({ cells: headers.map((header) => entries.get(header)!), lineIds: sourceLines(start, end) });
    if (tokens[cursor]?.[0] === "]") { cursor++; break; }
    if (!take(",")) return null;
  }
  return cursor === tokens.length ? { format: "JSON", headers, rows } : null;
}

export function parseOutputTable(snapshot: OutputSnapshot): OutputTable | null {
  // A clipped header or record could otherwise be mistaken for a different dataset.
  if (snapshot.omitted || !snapshot.lines.length || snapshot.lines.length > MAX_LINES) return null;
  const lines = snapshot.lines.filter((line) => line.text.trim());
  if (lines[0]?.text.trimStart().startsWith("[")) return parseJson(lines);
  if (lines.length < 2 || lines.length - 1 > MAX_ROWS) return null;
  return parseDelimited(lines, "\t") ?? parseDelimited(lines, ",");
}

export function numericColumns(table: OutputTable): NumericColumn[] {
  const columns: NumericColumn[] = [];
  table.headers.forEach((_header, index) => {
    const values: number[] = [];
    let unit: string | undefined;
    for (const row of table.rows) {
      const match = /^([+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(%|ms|s|us|µs|ns|B|kB|KB|KiB|MB|MiB|GB|GiB)?$/.exec(row.cells[index].trim());
      if (!match) return;
      const value = Number(match[1]);
      const nextUnit = match[2] ?? "";
      const significant = match[1].split(/[eE]/)[0];
      if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER
        || (value === 0 && /[1-9]/.test(significant))
        || (unit !== undefined && unit !== nextUnit)) return;
      unit = nextUnit;
      values.push(value);
    }
    if (values.length) columns.push({ index, unit: unit ?? "", values });
  });
  return columns;
}

/** Labels are exact source lines, not model-invented phases or interpretations. */
export function outputOutline(snapshot: OutputSnapshot): { items: OutputLine[]; omitted: number } {
  const headings = snapshot.lines.filter((line) => /^\s*(?:#{1,6}\s+\S|={3,}\s*\S.*={3,}\s*$|(?:install(?:ing)?|build(?:ing)?|test(?:ing)?|deploy(?:ing)?|error|fatal|fail(?:ed|ure)?)\b(?:\s|:))/i.test(line.text));
  return { items: headings.slice(0, 16), omitted: Math.max(0, headings.length - 16) };
}
