import { describe, it, expect } from 'vitest';
import { askCommand } from '../src/commands/ask.js';
import { searchCommand } from '../src/commands/search.js';
import { statusCommand } from '../src/commands/status.js';
import { forgetCommand } from '../src/commands/forget.js';
import { compactCommand } from '../src/commands/compact.js';

describe('cli commands', () => {
  it('expose names', () => {
    expect(askCommand().name()).toBe('ask');
    expect(searchCommand().name()).toBe('search');
    expect(statusCommand().name()).toBe('status');
  });

  it('ask exposes --json for scripting', () => {
    const flags = askCommand().options.map((o) => o.long);
    expect(flags).toContain('--json');
  });

  it('status exposes --json for scripting', () => {
    const flags = statusCommand().options.map((o) => o.long);
    expect(flags).toContain('--json');
  });

  it('forget exposes --json for scripting', () => {
    const flags = forgetCommand().options.map((o) => o.long);
    expect(flags).toContain('--json');
  });

  it('compact exposes --json for scripting', () => {
    const flags = compactCommand().options.map((o) => o.long);
    expect(flags).toContain('--json');
  });
});
