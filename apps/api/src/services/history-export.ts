import type { HistoryItem } from './history.js';

// History export helpers. Mirrors conversation-export.ts but for the flat
// per-user ask log. Three formats are supported so customers can pipe the
// data into spreadsheets, scripts, or notes without us picking a winner.
//
// All three formats preserve the same set of fields and the same ordering
// (newest first, matching what listHistory returns).

export interface HistoryExportOptions {
  formatDate?: (ts: number) => string;
}

function defaultFormatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Stable JSON shape for /v1/history/export.json. Versioned envelope so
// downstream callers can detect breaks without re-sniffing every field.
export interface HistoryJsonExport {
  version: 1;
  exportedAt: number;
  count: number;
  items: Array<{
    id: string;
    ts: number;
    tsIso: string;
    query: string;
    answer: string;
    model: string;
    sources: Array<{
      path?: string;
      namespace?: string;
      startLine?: number;
      endLine?: number;
      score?: number;
      excerpt?: string;
    }>;
  }>;
}

interface RawSource {
  path?: string;
  displayPath?: string;
  namespace?: string;
  startLine?: number;
  endLine?: number;
  score?: number;
  excerpt?: string;
}

function srcs(item: HistoryItem): RawSource[] {
  return (item.sources as RawSource[] | undefined) ?? [];
}

export function historyToJson(items: HistoryItem[]): HistoryJsonExport {
  return {
    version: 1,
    exportedAt: Date.now(),
    count: items.length,
    items: items.map((it) => ({
      id: it.id,
      ts: it.ts,
      tsIso: new Date(it.ts).toISOString(),
      query: it.query,
      answer: it.answer,
      model: it.model,
      sources: srcs(it).map((s) => ({
        ...(s.displayPath || s.path ? { path: s.displayPath ?? s.path } : {}),
        ...(s.namespace ? { namespace: s.namespace } : {}),
        ...(typeof s.startLine === 'number' ? { startLine: s.startLine } : {}),
        ...(typeof s.endLine === 'number' ? { endLine: s.endLine } : {}),
        ...(typeof s.score === 'number' ? { score: s.score } : {}),
        ...(s.excerpt ? { excerpt: s.excerpt } : {}),
      })),
    })),
  };
}

// RFC 4180 escape. Wraps in quotes when needed and doubles inner quotes.
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function historyToCsv(items: HistoryItem[]): string {
  const header = ['id', 'ts_iso', 'model', 'query', 'answer', 'source_count', 'sources'];
  const rows: string[] = [header.join(',')];
  for (const it of items) {
    const sources = srcs(it);
    const sourceList = sources
      .map((s) => {
        const p = s.displayPath ?? s.path ?? '';
        if (!p) return '';
        if (typeof s.startLine === 'number') {
          return s.endLine && s.endLine !== s.startLine
            ? `${p}:${s.startLine}-${s.endLine}`
            : `${p}:${s.startLine}`;
        }
        return p;
      })
      .filter(Boolean)
      .join(' | ');
    rows.push(
      [
        csvCell(it.id),
        csvCell(new Date(it.ts).toISOString()),
        csvCell(it.model ?? ''),
        csvCell(it.query),
        csvCell(it.answer),
        csvCell(sources.length),
        csvCell(sourceList),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function historyToMarkdown(items: HistoryItem[], opts: HistoryExportOptions = {}): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const lines: string[] = ['# ClawMind history', '', `${items.length} ${items.length === 1 ? 'answer' : 'answers'}`, ''];
  if (items.length === 0) {
    lines.push('_No history yet._', '');
    return lines.join('\n');
  }
  for (const it of items) {
    const firstLine = it.query.trim().split('\n')[0] ?? it.query.trim();
    lines.push(`## ${firstLine.slice(0, 200)}`);
    lines.push('');
    lines.push(`_${fmt(it.ts)} - ${it.model || 'unknown model'}_`);
    lines.push('');
    lines.push(it.answer.trim());
    const sources = srcs(it);
    if (sources.length > 0) {
      lines.push('');
      lines.push('**Sources**');
      lines.push('');
      sources.forEach((s, i) => {
        const p = s.displayPath ?? s.path ?? '(unknown)';
        const range =
          typeof s.startLine === 'number'
            ? s.endLine && s.endLine !== s.startLine
              ? `:${s.startLine}-${s.endLine}`
              : `:${s.startLine}`
            : '';
        lines.push(`${i + 1}. ${p}${range}`);
      });
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}
