// Batch ask: parse a CSV (or JSON list) of questions, run them sequentially
// through the RAG pipeline, and stream back a CSV result file. The
// implementation lives here so routes/batch.ts stays a thin Fastify shell
// and the parsing/formatting can be unit tested in isolation.

const MAX_BATCH = 100;

export interface BatchRow {
  q: string;
  // Optional per-row tag carried straight through to the output so callers
  // can correlate results back to whatever they uploaded.
  tag?: string;
}

export interface BatchResult {
  q: string;
  tag?: string;
  ok: boolean;
  answer?: string;
  model?: string;
  sources?: number;
  error?: string;
  durationMs: number;
}

// Strict but tolerant RFC4180-ish CSV reader. Handles quoted fields,
// escaped quotes ("") inside quotes, and CRLF/LF row endings. Bare commas
// inside unquoted fields end the field (per the spec). We don't try to be
// clever about types; everything comes back as strings.
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cur += '"'; i++; continue; }
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cur); cur = ''; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') {
      row.push(cur); cur = '';
      // Skip fully blank lines so trailing newlines don't create a phantom row.
      if (!(row.length === 1 && row[0] === '')) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

// Extract the question column from a CSV. Accepts either:
//   - a header row containing `q` (and optional `tag`), or
//   - a headerless CSV where the first column is the question.
// Throws with a friendly message instead of returning an empty list so the
// route can surface a 400 with the reason.
export function extractRows(csv: string): BatchRow[] {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) throw new Error('CSV is empty');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  let qIdx = header.indexOf('q');
  if (qIdx === -1) qIdx = header.indexOf('query');
  let tagIdx = header.indexOf('tag');
  let dataRows = rows.slice(1);
  // No header? Treat the whole file as data with column 0 as the question.
  if (qIdx === -1) {
    qIdx = 0;
    tagIdx = -1;
    dataRows = rows;
  }
  const out: BatchRow[] = [];
  for (const r of dataRows) {
    const q = (r[qIdx] ?? '').trim();
    if (!q) continue;
    const row: BatchRow = { q };
    if (tagIdx >= 0 && r[tagIdx]) row.tag = r[tagIdx]!.trim();
    out.push(row);
  }
  if (out.length === 0) throw new Error('No questions found in CSV');
  if (out.length > MAX_BATCH) {
    throw new Error(`Batch capped at ${MAX_BATCH} rows (got ${out.length})`);
  }
  return out;
}

function csvEscape(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function resultsToCsv(results: BatchResult[]): string {
  const header = ['q', 'tag', 'ok', 'answer', 'model', 'sources', 'duration_ms', 'error'];
  const lines = [header.join(',')];
  for (const r of results) {
    lines.push([
      csvEscape(r.q),
      csvEscape(r.tag),
      r.ok ? '1' : '0',
      csvEscape(r.answer),
      csvEscape(r.model),
      csvEscape(r.sources),
      csvEscape(r.durationMs),
      csvEscape(r.error),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export const BATCH_LIMITS = { MAX_BATCH };
