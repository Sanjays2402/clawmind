import { describe, it, expect } from 'vitest';
import { BM25Index, tokenize } from '../src/bm25-index.js';
import type { Chunk } from '@clawmind/types';

const mk = (id: string, text: string, ns = 'memory' as const): Chunk => ({
  id, documentId: id, path: `/${id}.md`, namespace: ns,
  text, startLine: 1, endLine: 1, tokens: text.split(' ').length, ord: 0,
});

describe('tokenize', () => {
  it('lowercases and drops stopwords', () => {
    expect(tokenize('The quick BROWN fox')).toEqual(['quick', 'brown', 'fox']);
  });
});

describe('BM25Index', () => {
  it('ranks relevant docs first', () => {
    const idx = new BM25Index();
    idx.add([
      mk('a', 'snip is a screenshot tool i built'),
      mk('b', 'today the weather was nice'),
      mk('c', 'committed snip launch v2 with new ocr'),
    ]);
    const res = idx.search('snip launch', 5);
    expect(res[0]?.id).toBe('c');
  });
  it('filters by namespace', () => {
    const idx = new BM25Index();
    idx.add([mk('a', 'lance vectors', 'memory'), mk('b', 'lance vectors', 'projects')]);
    const res = idx.search('lance', 5, ['projects']);
    expect(res).toHaveLength(1);
    expect(res[0]?.namespace).toBe('projects');
  });
});
