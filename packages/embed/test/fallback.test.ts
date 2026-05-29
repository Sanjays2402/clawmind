import { describe, it, expect } from 'vitest';
import { FallbackEmbedProvider } from '../src/fallback.js';
import type { EmbedProvider } from '@clawmind/types';

const ok: EmbedProvider = { id: 'ok', dim: () => 2, async health() { return true; }, async embed() { return { vectors: [[1,2]], model: 'm', dim: 2 }; } };
const bad: EmbedProvider = { id: 'bad', dim: () => 2, async health() { return false; }, async embed() { throw new Error('nope'); } };

describe('FallbackEmbedProvider', () => {
  it('falls through to next provider', async () => {
    const f = new FallbackEmbedProvider([bad, ok]);
    const out = await f.embed({ texts: ['x'] });
    expect(out.vectors[0]).toEqual([1,2]);
  });
  it('throws if all fail', async () => {
    const f = new FallbackEmbedProvider([bad, bad]);
    await expect(f.embed({ texts: ['x'] })).rejects.toThrow();
  });
});
