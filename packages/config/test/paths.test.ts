import { describe, it, expect } from 'vitest';
import { expand, lancedbDir, bm25Dir } from '../src/paths.js';

describe('paths', () => {
  it('expands ~ to home dir', () => {
    expect(expand('~/foo')).toMatch(/foo$/);
  });
  it('returns nested data dirs', () => {
    expect(lancedbDir({ CLAWMIND_DATA_DIR: '/tmp/x' })).toBe('/tmp/x/lancedb');
    expect(bm25Dir({ CLAWMIND_DATA_DIR: '/tmp/x' })).toBe('/tmp/x/bm25');
  });
});
