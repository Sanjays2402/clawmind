import { describe, it, expect } from 'vitest';
import { approxTokenCount, truncateToTokens } from '../src/tokens.js';

describe('tokens', () => {
  it('counts roughly', () => {
    expect(approxTokenCount('')).toBe(0);
    expect(approxTokenCount('hello world')).toBeGreaterThan(0);
  });
  it('truncates oversize text', () => {
    const long = 'x'.repeat(10_000);
    const out = truncateToTokens(long, 100);
    expect(out.length).toBeLessThan(long.length);
  });
});
