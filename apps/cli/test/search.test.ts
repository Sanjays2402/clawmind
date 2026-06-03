import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    bm25: {}, lance: {}, embed: {}, llm: {},
    env: { CLAWMIND_EMBED_MODEL: 'test-model' },
  }),
}));

const retrieveMock = vi.fn();
vi.mock('@clawmind/rag', () => ({
  retrieve: (...args: unknown[]) => retrieveMock(...args),
  snippetFor: () => ({ startLine: 1, text: '', highlights: [] }),
  queryTerms: () => [],
}));

import { searchCommand } from '../src/commands/search.js';

describe('search empty results UX', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    retrieveMock.mockReset();
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });

  it('prints a no-results message to stderr in text mode when nothing matches', async () => {
    retrieveMock.mockResolvedValue([]);
    await searchCommand().parseAsync(['node', 'cli', 'nothing', 'will', 'match', 'this']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('no results for');
    expect(stderr.join('')).toContain('nothing will match this');
  });

  it('includes active filters in the empty-state message', async () => {
    retrieveMock.mockResolvedValue([]);
    await searchCommand().parseAsync([
      'node', 'cli', 'foo',
      '-n', 'memory,sessions',
      '--include-tags', 'urgent',
    ]);
    const err = stderr.join('');
    expect(err).toContain('namespaces=memory,sessions');
    expect(err).toContain('include-tags=urgent');
  });

  it('emits [] in json mode without a no-results message', async () => {
    retrieveMock.mockResolvedValue([]);
    await searchCommand().parseAsync(['node', 'cli', 'nope', '--json']);
    expect(JSON.parse(stdout.join(''))).toEqual([]);
    expect(stderr.join('')).toBe('');
  });
});
