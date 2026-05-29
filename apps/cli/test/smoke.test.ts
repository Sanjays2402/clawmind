import { describe, it, expect } from 'vitest';
import { askCommand } from '../src/commands/ask.js';
import { searchCommand } from '../src/commands/search.js';

describe('cli commands', () => {
  it('expose names', () => {
    expect(askCommand().name()).toBe('ask');
    expect(searchCommand().name()).toBe('search');
  });
});
