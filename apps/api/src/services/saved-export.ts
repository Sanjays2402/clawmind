import type { SavedItem } from './saved.js';

// Saved-searches export helpers. Same shape as history-export.ts so the
// download buttons in the web UI can render the same set of formats and
// downstream tooling can rely on a stable, versioned JSON envelope.
//
// All three formats preserve the same set of fields and the same ordering
// as the caller passes in (the route hands them in newest-first when it
// wants to match the on-screen list).

export interface SavedExportOptions {
  formatDate?: (ts: number) => string;
}

function defaultFormatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface SavedJsonExport {
  version: 1;
  exportedAt: number;
  count: number;
  items: Array<{
    id: string;
    title: string;
    query: string;
    tags: string[];
    createdAt: number;
    createdAtIso: string;
    updatedAt: number;
    updatedAtIso: string;
  }>;
}

export function savedToJson(items: SavedItem[]): SavedJsonExport {
  return {
    version: 1,
    exportedAt: Date.now(),
    count: items.length,
    items: items.map((it) => ({
      id: it.id,
      title: it.title,
      query: it.query,
      tags: it.tags,
      createdAt: it.createdAt,
      createdAtIso: new Date(it.createdAt).toISOString(),
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

export function savedToCsv(items: SavedItem[]): string {
  const header = ['id', 'created_iso', 'updated_iso', 'title', 'query', 'tags'];
  const rows: string[] = [header.join(',')];
  for (const it of items) {
    rows.push(
      [
        csvCell(it.id),
        csvCell(new Date(it.createdAt).toISOString()),
        csvCell(new Date(it.updatedAt).toISOString()),
        csvCell(it.title),
        csvCell(it.query),
        csvCell(it.tags.join(' ')),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function savedToMarkdown(items: SavedItem[], opts: SavedExportOptions = {}): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const lines: string[] = [
    '# ClawMind saved searches',
    '',
    `${items.length} ${items.length === 1 ? 'saved search' : 'saved searches'}`,
    '',
  ];
  if (items.length === 0) {
    lines.push('_No saved searches yet._', '');
    return lines.join('\n');
  }
  for (const it of items) {
    lines.push(`## ${it.title.slice(0, 200)}`);
    lines.push('');
    const tagStr = it.tags.length ? ` - ${it.tags.map((t) => `#${t}`).join(' ')}` : '';
    lines.push(`_${fmt(it.createdAt)}${tagStr}_`);
    lines.push('');
    lines.push('```');
    lines.push(it.query);
    lines.push('```');
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}
