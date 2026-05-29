import { describe, it, expect } from 'vitest';
import { EmbedCache } from '../src/cache.js';

describe('EmbedCache', () => {
  it('stores and returns vectors', () => {
    const c = new EmbedCache();
    c.set('hi', 'm', [1, 2]);
    expect(c.get('hi', 'm')).toEqual([1, 2]);
  });
  it('evicts when over capacity', () => {
    const c = new EmbedCache(2);
    c.set('a', 'm', [1]);
    c.set('b', 'm', [2]);
    c.set('c', 'm', [3]);
    expect(c.size()).toBe(2);
  });
});
