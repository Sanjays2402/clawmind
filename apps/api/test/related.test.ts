import { describe, it, expect } from 'vitest';
import type { Chunk, RetrievedChunk } from '@clawmind/types';
import { averageEmbedding, groupRelated } from '../src/services/related.js';

function chunk(over: Partial<Chunk>): Chunk {
  return {
    id: 'c1', documentId: 'd1', path: '/x.md', namespace: 'misc',
    text: 'hello world', startLine: 0, endLine: 0, tokens: 2, ord: 0,
    embedding: [1, 0, 0],
    ...over,
  };
}

function hit(over: Partial<RetrievedChunk>): RetrievedChunk {
  return { ...chunk({}), score: 0.5, ...over } as RetrievedChunk;
}

describe('averageEmbedding', () => {
  it('returns null when there are no embeddings', () => {
    expect(averageEmbedding([])).toBeNull();
    expect(averageEmbedding([chunk({ embedding: undefined })])).toBeNull();
    expect(averageEmbedding([chunk({ embedding: [] })])).toBeNull();
  });

  it('averages elementwise across chunks', () => {
    const a = chunk({ id: 'a', embedding: [1, 0, 0] });
    const b = chunk({ id: 'b', embedding: [0, 2, 0] });
    const c = chunk({ id: 'c', embedding: [0, 0, 3] });
    expect(averageEmbedding([a, b, c])).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('skips embeddings whose dimension does not match the first one', () => {
    const a = chunk({ id: 'a', embedding: [1, 1, 1] });
    const bad = chunk({ id: 'b', embedding: [9, 9] });
    expect(averageEmbedding([a, bad])).toEqual([1, 1, 1]);
  });
});

describe('groupRelated', () => {
  it('drops chunks that belong to the originating path', () => {
    const hits = [
      hit({ id: '1', path: '/origin.md', score: 0.9 }),
      hit({ id: '2', path: '/other.md', score: 0.5 }),
    ];
    const out = groupRelated(hits, '/origin.md', 10);
    expect(out.map((i) => i.path)).toEqual(['/other.md']);
  });

  it('collapses multiple chunks per path and keeps the best score', () => {
    const hits = [
      hit({ id: '1', path: '/a.md', score: 0.4, text: 'low' }),
      hit({ id: '2', path: '/a.md', score: 0.8, text: 'high quality match' }),
      hit({ id: '3', path: '/b.md', score: 0.7, text: 'b match' }),
    ];
    const out = groupRelated(hits, '/origin.md', 10);
    expect(out).toHaveLength(2);
    expect(out[0]!.path).toBe('/a.md');
    expect(out[0]!.score).toBe(0.8);
    expect(out[0]!.hits).toBe(2);
    expect(out[0]!.excerpt).toContain('high quality');
    expect(out[1]!.path).toBe('/b.md');
  });

  it('breaks ties on hit count', () => {
    const hits = [
      hit({ id: '1', path: '/a.md', score: 0.5 }),
      hit({ id: '2', path: '/b.md', score: 0.5 }),
      hit({ id: '3', path: '/b.md', score: 0.4 }),
    ];
    const out = groupRelated(hits, '/origin.md', 10);
    expect(out[0]!.path).toBe('/b.md');
  });

  it('respects the limit', () => {
    const hits = [
      hit({ id: '1', path: '/a.md', score: 0.9 }),
      hit({ id: '2', path: '/b.md', score: 0.8 }),
      hit({ id: '3', path: '/c.md', score: 0.7 }),
    ];
    expect(groupRelated(hits, '/x.md', 2)).toHaveLength(2);
  });

  it('truncates excerpts longer than 240 chars', () => {
    const big = 'x'.repeat(500);
    const out = groupRelated([hit({ path: '/a.md', text: big })], '/x.md', 1);
    expect(out[0]!.excerpt.endsWith('...')).toBe(true);
    expect(out[0]!.excerpt.length).toBeLessThanOrEqual(244);
  });
});
