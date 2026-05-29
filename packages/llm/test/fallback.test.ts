import { describe, it, expect } from 'vitest';
import { FallbackLLMProvider } from '../src/fallback.js';
import type { LLMProvider } from '@clawmind/types';

const ok: LLMProvider = {
  id: 'ok',
  async health() { return true; },
  async chat() { return 'hello'; },
  async *stream() { yield { delta: 'hi', done: false }; yield { delta: '', done: true }; },
};
const bad: LLMProvider = {
  id: 'bad', async health() { return false; },
  async chat() { throw new Error('x'); },
  async *stream() { throw new Error('x'); },
};

describe('FallbackLLMProvider', () => {
  it('chat falls through', async () => {
    const f = new FallbackLLMProvider([bad, ok]);
    expect(await f.chat({ model: '', messages: [] })).toBe('hello');
  });
  it('stream falls through', async () => {
    const f = new FallbackLLMProvider([bad, ok]);
    const chunks: string[] = [];
    for await (const c of f.stream({ model: '', messages: [] })) chunks.push(c.delta);
    expect(chunks.join('')).toBe('hi');
  });
});
