import { describe, it, expect } from 'vitest';
import { expandQuery, vocabFromIndex, DEFAULT_SYNONYMS } from '../src/expand.js';
import { BM25Index } from '@clawmind/store';
import type { Chunk } from '@clawmind/types';

const mk = (id: string, text: string): Chunk => ({
  id, documentId: id, path: `/${id}.md`, namespace: 'memory',
  text, startLine: 1, endLine: 1, tokens: text.split(' ').length, ord: 0,
});

describe('expandQuery', () => {
  it('passes through when vocab is empty and no synonyms hit', () => {
    const r = expandQuery('frobnicate the widgets');
    expect(r.expanded).toBe('frobnicate the widgets');
    expect(r.corrections).toEqual([]);
  });

  it('injects synonyms for known domain terms', () => {
    const r = expandQuery('how do i take a screenshot');
    expect(r.added).toContain('capture');
    expect(r.added).toContain('snip');
    expect(r.expanded.startsWith('how do i take a screenshot')).toBe(true);
    expect(r.expanded).toContain('capture');
  });

  it('caps synonym additions at maxAdded', () => {
    const r = expandQuery('embed embedding vector', { maxAdded: 2 });
    expect(r.added.length).toBeLessThanOrEqual(2);
  });

  it('corrects an obvious typo against a vocab term', () => {
    const idx = new BM25Index();
    idx.add([mk('a', 'lancedb is fast'), mk('b', 'lancedb is local'), mk('c', 'lancedb stores vectors')]);
    const r = expandQuery('lancdb speed', { vocab: vocabFromIndex(idx) });
    expect(r.corrections).toEqual([{ from: 'lancdb', to: 'lancedb' }]);
    expect(r.expanded.toLowerCase()).toContain('lancedb');
  });

  it('leaves short tokens alone even if a near-match exists', () => {
    const idx = new BM25Index();
    idx.add([mk('a', 'cat sat mat'), mk('b', 'cat sat mat')]);
    const r = expandQuery('bat', { vocab: vocabFromIndex(idx) });
    expect(r.corrections).toEqual([]);
  });

  it('returns expansion=expanded query and original separately', () => {
    const r = expandQuery('PR review');
    expect(r.original).toBe('PR review');
    expect(r.added).toContain('pull');
    expect(r.added).toContain('request');
  });

  it('does not double-add a synonym that is already in the query', () => {
    const r = expandQuery('embed embedding');
    expect(r.added.filter((t) => t === 'embedding')).toHaveLength(0);
  });

  it('exposes DEFAULT_SYNONYMS as a plain dictionary', () => {
    expect(DEFAULT_SYNONYMS.api).toContain('endpoint');
    expect(DEFAULT_SYNONYMS.endpoint).toContain('route');
  });
});

describe('vocabFromIndex', () => {
  it('repeats terms by their document frequency', () => {
    const idx = new BM25Index();
    idx.add([mk('a', 'lance lance vectors'), mk('b', 'vectors only')]);
    const v = vocabFromIndex(idx);
    const counts: Record<string, number> = {};
    for (const t of v) counts[t] = (counts[t] ?? 0) + 1;
    expect(counts.lance).toBe(1);   // appeared in 1 doc
    expect(counts.vectors).toBe(2); // appeared in 2 docs
  });
});
