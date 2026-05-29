import { describe, it, expect } from 'vitest';
import { hybridMerge } from '../src/hybrid.js';
import type { RetrievedChunk } from '@clawmind/types';

const mk = (id: string, s: number, kind: 'bm' | 'de'): RetrievedChunk => ({
  id, documentId: id, path: `/${id}`, namespace: 'memory', text: 't',
  startLine: 1, endLine: 1, tokens: 1, ord: 0,
  score: s, ...(kind === 'bm' ? { bm25Score: s } : { denseScore: s }),
});

describe('hybridMerge', () => {
  it('unions hits and reorders by blended score', () => {
    const bm = [mk('a', 10, 'bm'), mk('b', 5, 'bm')];
    const de = [mk('b', 0.9, 'de'), mk('c', 0.8, 'de')];
    const out = hybridMerge(bm, de, { alpha: 0.5 });
    expect(out.map((h) => h.id).sort()).toEqual(['a', 'b', 'c']);
    expect(out[0]?.id).toBe('b');
  });
});
