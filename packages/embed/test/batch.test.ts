import { describe, it, expect } from 'vitest';
import { embedAll } from '../src/batch.js';
import { EmbedCache } from '../src/cache.js';
import type { EmbedProvider } from '@clawmind/types';

const stub: EmbedProvider = {
  id: 'stub',
  dim: () => 2,
  async health() { return true; },
  async embed(req) {
    return { vectors: req.texts.map((t, i) => [t.length, i]), model: 'stub', dim: 2 };
  },
};

describe('embedAll', () => {
  it('returns one vector per input', async () => {
    const out = await embedAll(stub, ['a', 'bb', 'ccc'], { model: 'stub', batchSize: 2 });
    expect(out).toHaveLength(3);
  });
  it('uses cache for repeats', async () => {
    const cache = new EmbedCache();
    cache.set('a', 'stub', [99, 99]);
    const out = await embedAll(stub, ['a', 'b'], { model: 'stub', cache });
    expect(out[0]).toEqual([99, 99]);
  });
});
