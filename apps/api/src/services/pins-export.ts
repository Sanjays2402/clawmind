import type { PinEntry } from './pins.js';

// Pins export helpers. Same shape as saved-export.ts / history-export.ts so
// the same download UI and downstream tooling can rely on a stable,
// versioned JSON envelope. Pins are a workspace-wide curation artifact, so
// being able to back them up, hand them to a teammate, or load them into a
// fresh workspace as a starter set is a real customer ask.
//
// All three formats preserve the same set of fields and the same ordering
// as the caller passes in (the route hands them in newest-first to match
// the on-screen list).

export interface PinsExportOptions {
  formatDate?: (ts: number) => string;
}

function defaultFormatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface PinsJsonExport {
  version: 1;
  exportedAt: number;
  count: number;
  items: Array<{
    path: string;
    note?: string;
    pinnedAt: number;
    pinnedAtIso: string;
    pinnedBy: string;
  }>;
}

export function pinsToJson(items: PinEntry[]): PinsJsonExport {
  return {
    version: 1,
    exportedAt: Date.now(),
    count: items.length,
    items: items.map((it) => ({
      path: it.path,
      note: it.note,
      pinnedAt: it.pinnedAt,
      pinnedAtIso: new Date(it.pinnedAt).toISOString(),
      pinnedBy: it.pinnedBy,
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

export function pinsToCsv(items: PinEntry[]): string {
  const header = ['path', 'pinned_iso', 'pinned_by', 'note'];
  const rows: string[] = [header.join(',')];
  for (const it of items) {
    rows.push(
      [
        csvCell(it.path),
        csvCell(new Date(it.pinnedAt).toISOString()),
        csvCell(it.pinnedBy),
        csvCell(it.note ?? ''),
      ].join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function pinsToMarkdown(items: PinEntry[], opts: PinsExportOptions = {}): string {
  const fmt = opts.formatDate ?? defaultFormatDate;
  const lines: string[] = [
    '# ClawMind pinned sources',
    '',
    `${items.length} ${items.length === 1 ? 'pin' : 'pins'}`,
    '',
  ];
  if (items.length === 0) {
    lines.push('_No pinned sources yet._', '');
    return lines.join('\n');
  }
  for (const it of items) {
    lines.push(`- \`${it.path}\``);
    const note = it.note ? ` - ${it.note}` : '';
    lines.push(`  _${fmt(it.pinnedAt)} by ${it.pinnedBy}${note}_`);
  }
  lines.push('');
  return lines.join('\n');
}
