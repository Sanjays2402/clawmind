import { describe, it, expect } from 'vitest';
import { savedToCsv, savedToJson, savedToMarkdown } from '../src/services/saved-export.js';
import type { SavedItem } from '../src/services/saved.js';

function s1(over: Partial<SavedItem> = {}): SavedItem {
  return {
    id: 's1',
    userId: 'u1',
    title: 'Ingest activity',
    query: 'recent ingest errors',
    tags: ['ops', 'work'],
    createdAt: 1700000000000,
    updatedAt: 1700000050000,
    ...over,
  };
}

describe('saved-export', () => {
  it('CSV header + escapes quotes and commas, joins tags', () => {
    const csv = savedToCsv([
      s1({ title: 'with, comma', query: 'line1\nline2 "quoted"', tags: ['a', 'b'] }),
    ]);
    const lines = csv.split(/\r\n/);
    expect(lines[0]).toBe('id,created_iso,updated_iso,title,query,tags');
    expect(lines[1]).toContain('"with, comma"');
    expect(lines[1]).toContain('"line1\nline2 ""quoted"""');
    expect(lines[1]).toContain('a b');
    // trailing empty after final CRLF
    expect(lines[lines.length - 1]).toBe('');
  });

  it('JSON envelope is versioned and ISO timestamps match', () => {
    const json = savedToJson([s1()]);
    expect(json.version).toBe(1);
    expect(json.count).toBe(1);
    expect(json.items[0].createdAtIso).toBe(new Date(1700000000000).toISOString());
    expect(json.items[0].updatedAtIso).toBe(new Date(1700000050000).toISOString());
    expect(json.items[0].tags).toEqual(['ops', 'work']);
  });

  it('Markdown renders title, tag chips, and fenced query block', () => {
    const md = savedToMarkdown([s1()]);
    expect(md).toContain('# ClawMind saved searches');
    expect(md).toContain('## Ingest activity');
    expect(md).toContain('#ops');
    expect(md).toContain('#work');
    expect(md).toContain('```\nrecent ingest errors\n```');
  });

  it('Handles empty list gracefully across formats', () => {
    expect(savedToCsv([])).toBe('id,created_iso,updated_iso,title,query,tags\r\n');
    expect(savedToJson([]).count).toBe(0);
    expect(savedToMarkdown([])).toContain('_No saved searches yet._');
  });

  it('Markdown drops the tag suffix when there are no tags', () => {
    const md = savedToMarkdown([s1({ tags: [] })]);
    expect(md).not.toContain(' - #');
  });
});
