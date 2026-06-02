import { describe, it, expect } from 'vitest';
import { feedbackToCsv, feedbackToJson, feedbackToMarkdown } from '../src/services/feedback-export.js';
import type { FeedbackEntry } from '../src/services/feedback.js';

function f1(over: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    path: 'memory/2026-06-01.md',
    ups: 3,
    downs: 1,
    updatedAt: 1700000000000,
    byUser: { u1: 1, u2: 1, u3: 1, u4: -1 },
    ...over,
  };
}

describe('feedback-export', () => {
  it('CSV header + escapes commas and quotes in source paths', () => {
    const csv = feedbackToCsv([
      f1({ path: 'docs/notes, with "comma".md', ups: 2, downs: 0 }),
    ]);
    const lines = csv.split(/\r\n/);
    expect(lines[0]).toBe('path,ups,downs,net,boost,updated_iso');
    expect(lines[1]).toContain('"docs/notes, with ""comma"".md"');
    expect(lines[1]).toContain(',2,0,2,');
    expect(lines[lines.length - 1]).toBe('');
  });

  it('JSON envelope is versioned and includes net + boost + ISO timestamp', () => {
    const json = feedbackToJson([f1()]);
    expect(json.version).toBe(1);
    expect(json.count).toBe(1);
    const item = json.items[0];
    expect(item.path).toBe('memory/2026-06-01.md');
    expect(item.ups).toBe(3);
    expect(item.downs).toBe(1);
    expect(item.net).toBe(2);
    expect(typeof item.boost).toBe('number');
    expect(item.updatedAtIso).toBe(new Date(1700000000000).toISOString());
  });

  it('Markdown renders a table with header, rows, and pipe escaping', () => {
    const md = feedbackToMarkdown([f1({ path: 'docs/a|b.md' })]);
    expect(md).toContain('# ClawMind source feedback');
    expect(md).toContain('| Source | Ups | Downs | Net | Boost | Updated |');
    expect(md).toContain('docs/a\\|b.md');
    expect(md).toContain('| 3 | 1 | 2 |');
  });

  it('Handles empty list gracefully across formats', () => {
    expect(feedbackToCsv([])).toBe('path,ups,downs,net,boost,updated_iso\r\n');
    expect(feedbackToJson([]).count).toBe(0);
    expect(feedbackToMarkdown([])).toContain('_No feedback recorded yet._');
  });
});
