import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/prompt.js';

describe('buildPrompt', () => {
  it('includes context and question', () => {
    const msgs = buildPrompt({
      question: 'what shipped?',
      context: [{ n: 1, path: 'a.md', lines: '1-2', excerpt: 'snip launched' }],
    });
    expect(msgs[0]?.role).toBe('system');
    expect(msgs.at(-1)?.content).toContain('what shipped?');
    expect(msgs.at(-1)?.content).toContain('[^1]');
  });
});
