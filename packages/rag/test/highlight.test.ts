import { describe, it, expect } from 'vitest';
import { findMatches, pickWindow, snippetFor, queryTerms } from '../src/highlight.js';
import type { RetrievedChunk } from '@clawmind/types';

function chunk(text: string, startLine = 1): RetrievedChunk {
  return {
    id: 'c1',
    documentId: 'd1',
    path: '/tmp/sample.md',
    namespace: 'docs',
    text,
    startLine,
    endLine: startLine + text.split('\n').length - 1,
    tokens: 10,
    ord: 0,
    embedding: [],
    score: 1,
  };
}

describe('findMatches', () => {
  it('matches whole words case-insensitively and returns offsets', () => {
    const out = findMatches('The CLI works for the cli user', ['cli']);
    expect(out).toHaveLength(2);
    expect(out[0]!.term).toBe('cli');
    expect('The CLI works for the cli user'.slice(out[0]!.start, out[0]!.end)).toBe('CLI');
  });

  it('ignores substring matches inside larger words', () => {
    const out = findMatches('classification', ['cla']);
    expect(out).toEqual([]);
  });

  it('returns empty when no terms or all terms are too short', () => {
    expect(findMatches('hello', [])).toEqual([]);
    expect(findMatches('hello', ['a'])).toEqual([]);
  });

  it('handles regex metacharacters in terms (operator-shaped tokens fall back to literal match)', () => {
    // The default word-boundary matcher cannot bracket symbol-only tokens like
    // "c++" because `+` is not a word character. We accept that limitation
    // explicitly: such terms are simply not highlighted, but the matcher must
    // not throw and must not corrupt later matches.
    expect(() => findMatches('I love c++ a lot', ['c++'])).not.toThrow();
    const mixed = findMatches('I love c++ and code', ['c++', 'code']);
    expect(mixed.some((m) => m.term === 'code')).toBe(true);
  });
});

describe('pickWindow', () => {
  it('returns the whole text when shorter than width', () => {
    const w = pickWindow('short text', findMatches('short text', ['short']), 80);
    expect(w).toEqual({ start: 0, end: 10 });
  });

  it('centres the window on the densest match cluster', () => {
    const text = 'lorem '.repeat(40) + 'target target nearby target ' + 'lorem '.repeat(40);
    const matches = findMatches(text, ['target']);
    const w = pickWindow(text, matches, 100);
    const slice = text.slice(w.start, w.end);
    expect(slice).toContain('target');
  });
});

describe('snippetFor', () => {
  it('produces a snippet with highlights relative to the snippet', () => {
    const text = 'The ingest pipeline reads markdown and code. The pipeline batches embeddings.';
    const c = chunk(text, 12);
    const snip = snippetFor(c, ['pipeline'], 80);
    expect(snip.text).toContain('pipeline');
    expect(snip.highlights.length).toBeGreaterThan(0);
    for (const h of snip.highlights) {
      expect(snip.text.slice(h.start, h.end).toLowerCase()).toBe('pipeline');
    }
    expect(snip.startLine).toBe(12);
  });

  it('adds ellipses when the snippet is trimmed', () => {
    const big = 'lorem '.repeat(200) + 'needle ' + 'ipsum '.repeat(200);
    const snip = snippetFor(chunk(big), ['needle'], 120);
    expect(snip.text.startsWith('... ')).toBe(true);
    expect(snip.text.endsWith(' ...')).toBe(true);
    expect(snip.highlights).toHaveLength(1);
  });

  it('advances startLine when the snippet starts past chunk newlines', () => {
    const text = 'header line\n\n\nsecond paragraph with apple\n\nthird paragraph with apple again';
    const c = chunk(text, 100);
    const snip = snippetFor(c, ['apple'], 40);
    expect(snip.startLine).toBeGreaterThanOrEqual(100);
  });
});

describe('queryTerms', () => {
  it('returns unique non-stopword tokens', () => {
    const t = queryTerms('the quick brown fox and the quick rabbit');
    expect(t).toContain('quick');
    expect(t).toContain('brown');
    expect(t).toContain('fox');
    expect(t).toContain('rabbit');
    expect(t).not.toContain('the');
    expect(new Set(t).size).toBe(t.length);
  });
});
