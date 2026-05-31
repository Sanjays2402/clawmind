import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  extractRows,
  resultsToCsv,
  BATCH_LIMITS,
} from '../src/services/batch.js';

describe('batch CSV parsing', () => {
  it('parses quoted fields with embedded commas and escaped quotes', () => {
    const rows = parseCsv('a,b,c\r\n"hello, world","she said ""hi""",3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['hello, world', 'she said "hi"', '3'],
    ]);
  });

  it('extracts q column from a header CSV and preserves tag', () => {
    const rows = extractRows('q,tag\nhow does auth work?,security\nwhat is rag?,intro\n');
    expect(rows).toEqual([
      { q: 'how does auth work?', tag: 'security' },
      { q: 'what is rag?', tag: 'intro' },
    ]);
  });

  it('falls back to column 0 when no q header is present', () => {
    const rows = extractRows('first question\nsecond question\n');
    expect(rows.map((r) => r.q)).toEqual(['first question', 'second question']);
    expect(rows.every((r) => r.tag === undefined)).toBe(true);
  });

  it('rejects empty CSVs with a friendly message', () => {
    expect(() => extractRows('')).toThrow(/empty/i);
    expect(() => extractRows('q\n\n')).toThrow(/no questions/i);
  });

  it('enforces the batch cap', () => {
    const lines = ['q', ...Array.from({ length: BATCH_LIMITS.MAX_BATCH + 1 }, (_, i) => `question ${i}`)];
    expect(() => extractRows(lines.join('\n'))).toThrow(/capped/);
  });

  it('formats results as RFC4180-style CSV with header', () => {
    const csv = resultsToCsv([
      { q: 'hi, there', tag: 't1', ok: true, answer: 'line1\nline2', model: 'm', sources: 2, durationMs: 42 },
      { q: 'oops', ok: false, error: 'boom', durationMs: 3 },
    ]);
    const [header, r1, r2] = csv.trim().split('\r\n');
    expect(header).toBe('q,tag,ok,answer,model,sources,duration_ms,error');
    expect(r1).toContain('"hi, there"');
    expect(r1).toContain('"line1\nline2"');
    expect(r1).toContain(',1,'); // ok=1
    expect(r2).toContain('oops');
    expect(r2).toContain(',0,'); // ok=0
    expect(r2).toContain('boom');
  });
});
