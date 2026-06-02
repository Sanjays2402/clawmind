import { describe, it, expect } from 'vitest';
import { pinsToCsv, pinsToJson, pinsToMarkdown } from '../src/services/pins-export.js';
import type { PinEntry } from '../src/services/pins.js';

function p1(over: Partial<PinEntry> = {}): PinEntry {
  return {
    path: '/notes/spec.md',
    note: 'core spec',
    pinnedAt: 1700000000000,
    pinnedBy: 'u1',
    ...over,
  };
}

describe('pins-export', () => {
  it('CSV header + escapes quotes and commas, preserves empty notes', () => {
    const csv = pinsToCsv([
      p1({ path: '/with, comma.md', note: 'line1\nline2 "quoted"' }),
      p1({ path: '/plain.md', note: undefined }),
    ]);
    const lines = csv.split(/\r\n/);
    expect(lines[0]).toBe('path,pinned_iso,pinned_by,note');
    expect(lines[1]).toContain('"/with, comma.md"');
    expect(lines[1]).toContain('"line1\nline2 ""quoted"""');
    // empty note becomes empty trailing cell, not the literal "undefined"
    expect(lines[2].endsWith(',u1,')).toBe(true);
    // trailing empty after final CRLF
    expect(lines[lines.length - 1]).toBe('');
  });

  it('JSON envelope is versioned and ISO timestamps match', () => {
    const json = pinsToJson([p1()]);
    expect(json.version).toBe(1);
    expect(json.count).toBe(1);
    expect(json.items[0].path).toBe('/notes/spec.md');
    expect(json.items[0].note).toBe('core spec');
    expect(json.items[0].pinnedBy).toBe('u1');
    expect(json.items[0].pinnedAtIso).toBe(new Date(1700000000000).toISOString());
  });

  it('Markdown renders heading, count, path code, and note', () => {
    const md = pinsToMarkdown([p1()]);
    expect(md).toContain('# ClawMind pinned sources');
    expect(md).toContain('1 pin');
    expect(md).toContain('`/notes/spec.md`');
    expect(md).toContain('by u1');
    expect(md).toContain('- core spec');
  });

  it('Handles empty list gracefully across formats', () => {
    expect(pinsToCsv([])).toBe('path,pinned_iso,pinned_by,note\r\n');
    expect(pinsToJson([]).count).toBe(0);
    expect(pinsToMarkdown([])).toContain('_No pinned sources yet._');
  });

  it('Markdown drops the note suffix when there is no note', () => {
    const md = pinsToMarkdown([p1({ note: undefined })]);
    expect(md).not.toMatch(/ - core spec/);
    expect(md).toContain('by u1_');
  });

  it('Markdown pluralizes correctly for multiple pins', () => {
    const md = pinsToMarkdown([p1(), p1({ path: '/b.md' })]);
    expect(md).toContain('2 pins');
  });
});
