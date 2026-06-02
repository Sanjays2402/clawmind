import type { FeedbackEntry } from './feedback.js';
import { boostFor } from './feedback.js';

// Feedback export helpers. Same shape as saved-export.ts / history-export.ts
// so the download buttons in the web UI can render the same set of formats
// and downstream tooling can rely on a stable, versioned JSON envelope.
//
// All three formats preserve the same set of fields. The caller hands rows
// in the order it wants them rendered (the route sorts newest-first so the
// download matches the on-screen list).

export interface FeedbackExportOptions {
  formatDate?: (ts: number) => string;
}

function defaultFormatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface FeedbackJsonExport {
  version: 1;
  exportedAt: number;
  count: number;
  items: Array<{
    path: string;
    ups: number;
    downs: number;
    net: number;
    boost: number;
    updatedAt: number;
    updatedAtIso: string;
  }>;
}

export function feedbackToJson(items: FeedbackEntry[]): FeedbackJsonExport {
  return {
    version: 1,
    exportedAt: Date.now(),
    count: items.length,
    items: items.map((it) => ({
      path: it.path,
      ups: it.ups,
      downs: it.downs,
      net: it.ups - it.downs,
      boost: boostFor(it),
      updatedAt: it.updatedAt,
      updatedAtIso: new Date(it.updatedAt).toISOString(),
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

export function feedbackToCsv(items: FeedbackEntry[]): string {
  const header = ['path', 'ups', 'downs', 'net', 'boost', 'updated_iso'];
  const rows: string[] = [header.join(',')];
  for (const it of items) {
    rows.push(
      [
        csvCell(it.path),
        csvCell(it.ups),
        csvCell(it.downs),
        csvCell(it.ups - it.downs),
        csvCell(boostFor(it).toFixed(4)),
        csvCell(new Date(it.updatedAt).toISOString()),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function feedbackToMarkdown(items: FeedbackEntry[], opts: FeedbackExportOptions = {}): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const lines: string[] = [
    '# ClawMind source feedback',
    '',
    `${items.length} ${items.length === 1 ? 'source' : 'sources'}`,
    '',
  ];
  if (items.length === 0) {
    lines.push('_No feedback recorded yet._', '');
    return lines.join('\n');
  }
  lines.push('| Source | Ups | Downs | Net | Boost | Updated |');
  lines.push('| --- | ---: | ---: | ---: | ---: | --- |');
  for (const it of items) {
    const net = it.ups - it.downs;
    const safePath = it.path.replace(/\|/g, '\\|');
    lines.push(
      `| ${safePath} | ${it.ups} | ${it.downs} | ${net} | ${boostFor(it).toFixed(2)} | ${fmt(it.updatedAt)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
