import type { TagMap } from './tags.js';
import { pathsByTag } from './tags.js';

// Tags export helpers. Same shape as feedback-export.ts / saved-export.ts so
// the download buttons in the web UI can render the same set of formats and
// downstream tooling can rely on a stable, versioned JSON envelope.
//
// The export is tag-centric (one row per tag, with the list of source paths
// that carry it) because that is what operators actually want to audit: who
// tagged what, and how broad is each label. The path -> tags inverse is
// already exposed through GET /v1/tags/by-path for callers that need it.

export interface TagsJsonExport {
  version: 1;
  exportedAt: number;
  count: number;
  totalPaths: number;
  items: Array<{
    tag: string;
    count: number;
    paths: string[];
  }>;
}

export interface TagRow {
  tag: string;
  paths: string[];
}

export function tagsToRows(map: TagMap): TagRow[] {
  const inverse = pathsByTag(map);
  return Object.entries(inverse)
    .map(([tag, paths]) => ({ tag, paths: [...paths].sort() }))
    .sort((a, b) => b.paths.length - a.paths.length || a.tag.localeCompare(b.tag));
}

export function tagsToJson(rows: TagRow[]): TagsJsonExport {
  let totalPaths = 0;
  const items = rows.map((r) => {
    totalPaths += r.paths.length;
    return { tag: r.tag, count: r.paths.length, paths: r.paths };
  });
  return {
    version: 1,
    exportedAt: Date.now(),
    count: items.length,
    totalPaths,
    items,
  };
}

// RFC 4180 escape. Wraps in quotes when needed and doubles inner quotes.
function csvCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// CSV is emitted one row per (tag, path) pair so the file imports cleanly
// into a spreadsheet without nested cells. A tag with no paths still gets
// one row with an empty path column so empty buckets are visible.
export function tagsToCsv(rows: TagRow[]): string {
  const lines: string[] = ['tag,path'];
  for (const r of rows) {
    if (r.paths.length === 0) {
      lines.push(`${csvCell(r.tag)},`);
      continue;
    }
    for (const p of r.paths) {
      lines.push(`${csvCell(r.tag)},${csvCell(p)}`);
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function tagsToMarkdown(rows: TagRow[]): string {
  const lines: string[] = [
    '# ClawMind tags',
    '',
    `${rows.length} ${rows.length === 1 ? 'tag' : 'tags'}`,
    '',
  ];
  if (rows.length === 0) {
    lines.push('_No tags defined yet._', '');
    return lines.join('\n');
  }
  for (const r of rows) {
    lines.push(`## ${r.tag} (${r.paths.length})`, '');
    if (r.paths.length === 0) {
      lines.push('_No sources._', '');
      continue;
    }
    for (const p of r.paths) {
      const safe = p.replace(/\|/g, '\\|');
      lines.push(`- ${safe}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
