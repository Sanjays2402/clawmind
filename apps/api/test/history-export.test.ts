import { describe, it, expect } from 'vitest';
import { historyToCsv, historyToJson, historyToMarkdown } from '../src/services/history-export.js';
import type { HistoryItem } from '../src/services/history.js';

function it1(over: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 'h1',
    ts: 1700000000000,
    userId: 'u1',
    query: 'how does auth work?',
    answer: 'It uses cookies, see [^1].',
    model: 'gpt-test',
    sources: [
      { path: '/abs/auth.ts', displayPath: 'auth.ts', namespace: 'projects', startLine: 10, endLine: 22, score: 0.9 },
    ],
    ...over,
  };
}

describe('history-export', () => {
  it('CSV header + escapes quotes and commas', () => {
    const csv = historyToCsv([
      it1({ query: 'hello, "world"', answer: 'line1\nline2' }),
    ]);
    const [header, row] = csv.trim().split(/\r\n/);
    expect(header).toBe('id,ts_iso,model,query,answer,source_count,sources');
    expect(row).toContain('"hello, ""world"""');
    expect(row).toContain('"line1\nline2"');
    expect(row).toContain('auth.ts:10-22');
    expect(row).toContain('1'); // source_count
  });

  it('JSON envelope is versioned and includes ISO timestamp', () => {
    const json = historyToJson([it1()]);
    expect(json.version).toBe(1);
    expect(json.count).toBe(1);
    expect(json.items[0].tsIso).toBe(new Date(1700000000000).toISOString());
    expect(json.items[0].sources[0]).toMatchObject({
      path: 'auth.ts',
      namespace: 'projects',
      startLine: 10,
      endLine: 22,
      score: 0.9,
    });
  });

  it('Markdown renders heading, model line, and sources block', () => {
    const md = historyToMarkdown([it1()]);
    expect(md).toContain('# ClawMind history');
    expect(md).toContain('## how does auth work?');
    expect(md).toContain('gpt-test');
    expect(md).toContain('**Sources**');
    expect(md).toContain('1. auth.ts:10-22');
  });

  it('Handles empty list gracefully across formats', () => {
    expect(historyToCsv([])).toBe('id,ts_iso,model,query,answer,source_count,sources\r\n');
    expect(historyToJson([]).count).toBe(0);
    expect(historyToMarkdown([])).toContain('_No history yet._');
  });
});
