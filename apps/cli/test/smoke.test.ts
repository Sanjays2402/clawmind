import { describe, it, expect } from 'vitest';
import { askCommand } from '../src/commands/ask.js';
import { searchCommand } from '../src/commands/search.js';

describe('cli commands', () => {
  it('expose names', () => {
    expect(askCommand().name()).toBe('ask');
    expect(searchCommand().name()).toBe('search');
  });

  it('ask exposes --json for scripting', () => {
    const flags = askCommand().options.map((o) => o.long);
    expect(flags).toContain('--json');
  });
});
