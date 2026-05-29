import { describe, it, expect } from 'vitest';
import { extractCitations, buildSources } from '../src/citations.js';
import type { RetrievedChunk } from '@clawmind/types';

const hit: RetrievedChunk = {
  id: 'h1', documentId: 'd1', path: '/x.md', namespace: 'memory',
  text: 'snip shipped', startLine: 12, endLine: 14, tokens: 2, ord: 0, score: 0.9,
};

describe('citations', () => {
  it('finds inline markers', () => {
    const sources = buildSources([hit, { ...hit, id: 'h2', startLine: 50 }]);
    const cites = extractCitations('snip shipped [^1] and again [^2] and [^99]', sources);
    expect(cites.map((c) => c.n)).toEqual([1, 2]);
    expect(cites[0]?.line).toBe(12);
  });
});
