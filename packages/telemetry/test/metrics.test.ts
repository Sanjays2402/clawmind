import { describe, it, expect } from 'vitest';
import { incr, observe, snapshot, reset } from '../src/metrics.js';

describe('metrics', () => {
  it('records counters and histograms', () => {
    reset();
    incr('a'); incr('a', 2);
    observe('h', 10); observe('h', 20);
    const s = snapshot();
    expect(s.counters['a']).toBe(3);
    expect(s.histograms['h']?.avg).toBe(15);
  });
});
