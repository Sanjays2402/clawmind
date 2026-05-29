import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/env.js';

describe('loadEnv', () => {
  it('returns defaults', () => {
    const env = loadEnv();
    expect(env.CLAWMIND_API_PORT).toBeTypeOf('number');
    expect(env.CLAWMIND_EMBED_DIM).toBeGreaterThan(0);
  });
});
