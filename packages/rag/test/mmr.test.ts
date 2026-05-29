import { describe, it, expect } from 'vitest';
import { mmrRerank } from '../src/mmr.js';
import type { RetrievedChunk } from '@clawmind/types';

const mk = (id: string, score: number, vec: number[]): RetrievedChunk => ({
  id, documentId: id, path: `/${id}`, namespace: 'memory', text: 't',
  startLine: 1, endLine: 1, tokens: 1, ord: 0, score, embedding: vec,
});

describe('mmrRerank', () => {
  it('promotes diversity', () => {
    const cands = [
      mk('a', 1.0, [1, 0, 0]),
      mk('b', 0.95, [1, 0, 0]),  // near duplicate of a
      mk('c', 0.9, [0, 1, 0]),   // diverse
    ];
    const out = mmrRerank(cands, { lambda: 0.3, k: 2 });
    expect(out[0]?.id).toBe('a');
    expect(out[1]?.id).toBe('c');
  });
});
