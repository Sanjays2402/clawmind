import { describe, it, expect } from 'vitest';
import { snapshot, incr } from '@clawmind/telemetry';

describe('health metrics shape', () => {
  it('exposes counters and histograms', () => {
    incr('test');
    const snap = snapshot();
    expect(snap.counters).toBeTypeOf('object');
    expect(snap.histograms).toBeTypeOf('object');
  });
});
