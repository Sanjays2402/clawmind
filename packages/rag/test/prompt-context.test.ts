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

  it('accepts options object and applies maxTokens', () => {
    // each `long` excerpt clips to ~1203 chars => ~301 tokens by the
    // approximation. A 350-token budget should fit exactly one.
    const ctx = toPromptContext([long, long, long], { maxTokens: 350 });
    expect(ctx).toHaveLength(1);
  });

  it('preserves rank order: keeps top hits, drops tail under token pressure', () => {
    const a: typeof long = { ...long, id: 'a', path: '/a', text: 'alpha '.repeat(50) };
    const b: typeof long = { ...long, id: 'b', path: '/b', text: 'beta '.repeat(50) };
    const c: typeof long = { ...long, id: 'c', path: '/c', text: 'gamma '.repeat(50) };
    const ctx = toPromptContext([a, b, c], { maxTokens: 120 });
    const paths = ctx.map((c) => c.path);
    expect(paths[0]).toBe('/a');
    expect(paths).not.toContain('/c');
  });

  it('partially fits the top hit when even one full excerpt overflows the budget', () => {
    const ctx = toPromptContext([long], { maxTokens: 50 });
    expect(ctx).toHaveLength(1);
    expect(ctx[0]!.excerpt.length).toBeLessThan(long.text.length);
  });

  it('returns empty when budget is zero and nothing can fit', () => {
    const ctx = toPromptContext([long], { maxTokens: 0 });
    expect(ctx).toEqual([]);
  });

  it('respects both maxChars and maxTokens, tighter wins', () => {
    const ctx = toPromptContext([long, long], { maxChars: 100, maxTokens: 100_000 });
    expect(ctx).toEqual([]); // 100 chars cannot hold a single 1203-char excerpt
  });
});
