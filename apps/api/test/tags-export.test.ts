import { describe, it, expect } from 'vitest';
import {
  tagsToCsv,
  tagsToJson,
  tagsToMarkdown,
  tagsToRows,
} from '../src/services/tags-export.js';
import type { TagMap } from '../src/services/tags.js';

function mapWith(byPath: Record<string, string[]>): TagMap {
  return { byPath };
}

describe('tags-export', () => {
  it('tagsToRows inverts byPath and sorts by count desc then tag asc', () => {
    const rows = tagsToRows(
      mapWith({
        'a.md': ['alpha', 'beta'],
        'b.md': ['alpha'],
        'c.md': ['alpha', 'gamma'],
      }),
    );
    expect(rows.map((r) => r.tag)).toEqual(['alpha', 'beta', 'gamma']);
    expect(rows[0].paths).toEqual(['a.md', 'b.md', 'c.md']);
    expect(rows[1].paths).toEqual(['a.md']);
  });

  it('JSON envelope is versioned and includes totalPaths', () => {
    const rows = tagsToRows(
      mapWith({ 'a.md': ['alpha'], 'b.md': ['alpha', 'beta'] }),
    );
    const json = tagsToJson(rows);
    expect(json.version).toBe(1);
    expect(json.count).toBe(2);
    expect(json.totalPaths).toBe(3);
    expect(json.items[0]).toEqual({ tag: 'alpha', count: 2, paths: ['a.md', 'b.md'] });
  });

  it('CSV emits one row per (tag, path) pair and escapes commas/quotes', () => {
    const rows = tagsToRows(
      mapWith({ 'docs/notes, "x".md': ['alpha'] }),
    );
    const csv = tagsToCsv(rows);
    const lines = csv.split(/\r\n/);
    expect(lines[0]).toBe('tag,path');
    expect(lines[1]).toBe('alpha,"docs/notes, ""x"".md"');
    expect(lines[lines.length - 1]).toBe('');
  });

  it('Markdown groups paths under each tag with escaped pipes', () => {
    const rows = tagsToRows(mapWith({ 'docs/a|b.md': ['alpha'] }));
    const md = tagsToMarkdown(rows);
    expect(md).toContain('# ClawMind tags');
    expect(md).toContain('## alpha (1)');
    expect(md).toContain('- docs/a\\|b.md');
  });

  it('Handles empty map gracefully across formats', () => {
    const rows = tagsToRows(mapWith({}));
    expect(tagsToCsv(rows)).toBe('tag,path\r\n');
    expect(tagsToJson(rows).count).toBe(0);
    expect(tagsToJson(rows).totalPaths).toBe(0);
    expect(tagsToMarkdown(rows)).toContain('_No tags defined yet._');
  });
});
