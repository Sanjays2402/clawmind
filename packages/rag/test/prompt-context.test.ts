import { describe, it, expect } from 'vitest';
import { toPromptContext } from '../src/prompt-context.js';
import type { RetrievedChunk } from '@clawmind/types';

const long: RetrievedChunk = {
  id: 'x', documentId: 'd', path: '/p', namespace: 'memory',
  text: 'x'.repeat(2000), startLine: 1, endLine: 10, tokens: 1, ord: 0, score: 1,
};

describe('toPromptContext', () => {
  it('truncates excerpts and respects maxChars', () => {
    const ctx = toPromptContext([long, long, long], 1500);
    expect(ctx.length).toBeLessThanOrEqual(2);
    for (const c of ctx) expect(c.excerpt.length).toBeLessThanOrEqual(1300);
  });
});
