import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

describe('search --threshold filters hits below the score floor', () => {
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
    retrieveMock.mockResolvedValue([
      { path: '/strong.md', score: 0.92, chunk: { text: '' } },
      { path: '/medium.md', score: 0.55, chunk: { text: '' } },
      { path: '/weak.md', score: 0.10, chunk: { text: '' } },
    ]);
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });

  it('keeps only hits at or above the threshold (json mode)', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', '0.5', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out.map((h: { path: string }) => h.path)).toEqual(['/strong.md', '/medium.md']);
  });

  it('treats the cutoff as inclusive (score === threshold survives)', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', '0.55', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out.map((h: { path: string }) => h.path)).toEqual(['/strong.md', '/medium.md']);
  });

  it('-t alias works exactly like --threshold', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '-t', '0.9', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out.map((h: { path: string }) => h.path)).toEqual(['/strong.md']);
  });

  it('emits the threshold in the no-results stderr message when it filters everything out', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', '0.99']);
    expect(stdout.join('')).toBe('');
    const err = stderr.join('');
    expect(err).toContain('no results for "foo"');
    expect(err).toContain('threshold=0.99');
  });

  it('a non-numeric threshold is ignored rather than fatal', async () => {
    // `--threshold $MAYBE` with an empty / garbage env var must not break
    // the command. We fall back to "no filter" silently.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', 'nope', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out).toHaveLength(3);
  });

  it('renders only kept hits in text mode and drops the rest entirely', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', '0.5']);
    const out = stdout.join('');
    expect(out).toContain('/strong.md');
    expect(out).toContain('/medium.md');
    expect(out).not.toContain('/weak.md');
  });
});

describe('search --out writes results to a file', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let dir: string;
  beforeEach(async () => {
    stdout = [];
    stderr = [];
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    retrieveMock.mockReset();
    dir = await mkdtemp(path.join(tmpdir(), 'clawmind-search-'));
  });
  afterEach(async () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    await rm(dir, { recursive: true, force: true });
  });

  it('writes json results to the given file and reports the count on stderr', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/a.md', score: 0.5, chunk: { text: '' } },
      { path: '/b.md', score: 0.4, chunk: { text: '' } },
    ]);
    const out = path.join(dir, 'hits.json');
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '-o', out]);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('wrote 2 result(s)');
    expect(stderr.join('')).toContain(out);
    const body = JSON.parse(await readFile(out, 'utf8'));
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ rank: 1, path: '/a.md' });
  });

  it('writes plain text results without ANSI color codes to --out', async () => {
    retrieveMock.mockResolvedValue([{ path: '/a.md', score: 0.5, chunk: { text: '' } }]);
    const out = path.join(dir, 'hits.txt');
    await searchCommand().parseAsync(['node', 'cli', 'foo', '-o', out]);
    const body = await readFile(out, 'utf8');
    expect(body).toContain('#1 /a.md:1 (0.500)');
    // No ANSI escape sequences in saved file.
    expect(body).not.toMatch(/\x1b\[/);
    expect(stderr.join('')).toContain('wrote 1 result(s)');
  });
});
