import { describe, it, expect } from 'vitest';
import { AnswerCache, cacheKey, normalizeQuestion } from '../src/answer-cache.js';
import type { Query } from '@clawmind/types';
import type { AskResult } from '../src/pipeline.js';

function q(overrides: Partial<Query> = {}): Query {
  return {
    q: 'what is snip',
    k: 8,
    mmrLambda: 0.5,
    hybridAlpha: 0.5,
    expand: true,
    ...overrides,
  } as Query;
}

const fake: AskResult = {
  text: 'answer',
  sources: [],
  citations: [],
  model: 'hermes-agent',
  latencyMs: 12,
};

describe('answer-cache', () => {
  it('normalizes whitespace and case in question text', () => {
    expect(normalizeQuestion('  Hello   World  ')).toBe('hello world');
  });

  it('produces the same key regardless of namespace order', () => {
    const a = cacheKey(q({ namespaces: ['docs', 'memory'] }), 'm', 1);
    const b = cacheKey(q({ namespaces: ['memory', 'docs'] }), 'm', 1);
    expect(a).toBe(b);
  });

  it('changes key when corpus version changes', () => {
    const a = cacheKey(q(), 'm', 1);
    const b = cacheKey(q(), 'm', 2);
    expect(a).not.toBe(b);
  });

  it('changes key when knobs change', () => {
    expect(cacheKey(q({ k: 4 }), 'm', 1)).not.toBe(cacheKey(q({ k: 8 }), 'm', 1));
    expect(cacheKey(q({ hybridAlpha: 0.5 }), 'm', 1)).not.toBe(cacheKey(q({ hybridAlpha: 0.6 }), 'm', 1));
  });

  it('returns hit on repeat and records stats', () => {
    const c = new AnswerCache({ maxEntries: 4 });
    const k = cacheKey(q(), 'm', 1);
    expect(c.get(k)).toBeNull();
    c.set(k, fake);
    expect(c.get(k)?.text).toBe('answer');
    const s = c.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(0.5);
  });

  it('evicts oldest when over capacity', () => {
    const c = new AnswerCache({ maxEntries: 2 });
    c.set('a', fake); c.set('b', fake); c.set('c', fake);
    expect(c.size()).toBe(2);
    expect(c.get('a')).toBeNull();
    expect(c.get('b')?.text).toBe('answer');
    expect(c.get('c')?.text).toBe('answer');
    expect(c.stats().evictions).toBe(1);
  });

  it('promotes on get so freshly used items are kept', () => {
    const c = new AnswerCache({ maxEntries: 2 });
    c.set('a', fake); c.set('b', fake);
    c.get('a');             // 'a' is now most recently used
    c.set('c', fake);       // should evict 'b', not 'a'
    expect(c.get('a')?.text).toBe('answer');
    expect(c.get('b')).toBeNull();
  });

  it('expires entries past ttl', () => {
    let now = 1_000;
    const c = new AnswerCache({ maxEntries: 4, ttlMs: 100, now: () => now });
    c.set('k', fake);
    now = 1_050;
    expect(c.get('k')?.text).toBe('answer');
    now = 1_200;
    expect(c.get('k')).toBeNull();
  });

  it('clear empties the map but keeps stats counters', () => {
    const c = new AnswerCache();
    c.set('k', fake);
    c.clear();
    expect(c.size()).toBe(0);
  });
});
