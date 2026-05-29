import { describe, it, expect } from 'vitest';
import { sha1, shortHash } from '../src/hash.js';

describe('hash', () => {
  it('is stable', () => {
    expect(sha1('hello')).toBe(sha1('hello'));
    expect(shortHash('hello')).toHaveLength(12);
  });
});
