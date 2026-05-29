import { describe, it, expect } from 'vitest';
import { lexicalRerank } from '../src/rerank.js';
import type { RetrievedChunk } from '@clawmind/types';

const mk = (id: string, text: string, score: number): RetrievedChunk => ({
  id, documentId: id, path: `/${id}`, namespace: 'memory', text,
  startLine: 1, endLine: 1, tokens: 1, ord: 0, score,
});

describe('lexicalRerank', () => {
  it('boosts chunks containing query terms', () => {
    const out = lexicalRerank('snip launch ocr', [
      mk('a', 'unrelated note about coffee', 0.5),
      mk('b', 'snip launch ocr fix shipped', 0.5),
    ]);
    expect(out[0]?.id).toBe('b');
  });
});
