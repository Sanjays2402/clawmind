import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    bm25: {}, lance: {}, embed: {}, llm: {},
    env: { CLAWMIND_EMBED_MODEL: 'test-model' },
  }),
}));

const retrieveMock = vi.fn();
// Loose type on purpose: the per-block `mockImplementation` below
// installs a function with an arity matching `snippetFor`'s real
// signature. `vi.fn()` defaults to a no-arg type, which would reject
// the rebind, so we cast to `any` to keep the test type-light.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snippetForMock: any = vi.fn(() => ({ startLine: 1, text: '', highlights: [] as { start: number; end: number }[] }));
vi.mock('@clawmind/rag', () => ({
  retrieve: (...args: unknown[]) => retrieveMock(...(args as [])),
  snippetFor: (...args: unknown[]) => snippetForMock(...args),
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

describe('search --no-snippet trims the json payload to ranking fields', () => {
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
    snippetForMock.mockReset();
    // Realistic snippet for this block so we can verify the
    // body-and-highlights-dropping behaviour actually drops something.
    snippetForMock.mockImplementation((hit: { path: string }) => ({
      startLine: 42,
      text: `snippet body for ${hit.path} that is intentionally long enough to matter`,
      highlights: [{ start: 0, end: 7 }, { start: 12, end: 16 }],
    }));
    retrieveMock.mockResolvedValue([
      { path: '/a.md', score: 0.91, chunk: { text: '' } },
      { path: '/b.md', score: 0.42, chunk: { text: '' } },
    ]);
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });

  it('--json --no-snippet emits rank/path/score/startLine only', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--no-snippet']);
    const out = JSON.parse(stdout.join('')) as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    // Exact key set per row — no snippet body, no highlights leak through.
    for (const row of out) {
      expect(Object.keys(row).sort()).toEqual(['path', 'rank', 'score', 'startLine']);
    }
    expect(out[0]).toEqual({ rank: 1, path: '/a.md', score: 0.91, startLine: 42 });
    expect(out[1]).toEqual({ rank: 2, path: '/b.md', score: 0.42, startLine: 42 });
    // The snippet body that the mock returns must not leak into output.
    expect(stdout.join('')).not.toContain('snippet body for');
    expect(stdout.join('')).not.toContain('highlights');
  });

  it('--json without --no-snippet still emits the full payload (no regression)', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json']);
    const out = JSON.parse(stdout.join('')) as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    // All six fields present in the default JSON shape.
    for (const row of out) {
      expect(Object.keys(row).sort()).toEqual([
        'highlights', 'path', 'rank', 'score', 'snippet', 'startLine',
      ]);
    }
    expect(stdout.join('')).toContain('snippet body for /a.md');
  });

  it('--no-snippet drops the snippet payload from --out json files too', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'clawmind-search-nosnip-'));
    try {
      const out = path.join(dir, 'hits.json');
      await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--no-snippet', '-o', out]);
      const body = JSON.parse(await readFile(out, 'utf8')) as Record<string, unknown>[];
      expect(body).toHaveLength(2);
      for (const row of body) {
        expect(Object.keys(row).sort()).toEqual(['path', 'rank', 'score', 'startLine']);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('text mode is unaffected by --no-snippet (snippet still renders)', async () => {
    // --no-snippet only changes the JSON shape. The default text mode
    // is for humans and stays as-is. We assert by checking that the
    // snippet body text reaches stdout.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--no-snippet']);
    const out = stdout.join('');
    expect(out).toContain('snippet body for /a.md');
    expect(out).toContain('snippet body for /b.md');
  });
});

describe('search reads the query from stdin when the argument is "-"', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let origStdin: typeof process.stdin;
  function pipeStdin(payload: string) {
    // Replace process.stdin with a Readable that yields `payload` and
    // then ends. `readStdin` reads via `for await (const chunk of
    // process.stdin)` which works against any Readable.
    const fake = Readable.from([payload]) as unknown as NodeJS.ReadStream;
    // setEncoding is called by the source under test; Readable.from
    // returns an object-mode-ish stream that already yields strings, so
    // we install a noop to satisfy the call without disturbing the
    // chunk type.
    (fake as unknown as { setEncoding: (enc: string) => void }).setEncoding = () => {};
    Object.defineProperty(process, 'stdin', { value: fake, configurable: true });
  }
  beforeEach(() => {
    stdout = [];
    stderr = [];
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    origStdin = process.stdin;
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    retrieveMock.mockReset();
    // Track the query the action actually built so we can assert on it.
    retrieveMock.mockResolvedValue([]);
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    Object.defineProperty(process, 'stdin', { value: origStdin, configurable: true });
    process.exitCode = 0;
  });

  it('reads a one-line query from stdin and uses it as the search text', async () => {
    pipeStdin('embeddings vs bm25\n');
    await searchCommand().parseAsync(['node', 'cli', '-']);
    // The empty-results stderr line is the easiest way to recover the
    // exact query string the action ran with — it gets echoed verbatim.
    expect(stderr.join('')).toContain('no results for "embeddings vs bm25"');
    // The retrieve call should have happened — confirms we did not bail
    // out before the search ran.
    expect(retrieveMock).toHaveBeenCalledOnce();
    const q = retrieveMock.mock.calls[0]?.[1] as { q: string };
    expect(q.q).toBe('embeddings vs bm25');
  });

  it('trims trailing whitespace/newlines (heredoc and `echo` friendly)', async () => {
    // `echo foo` always appends a newline; heredocs append one too.
    // The contract for `--paths-only` / `--tsv` is "exact bytes" — but
    // here the trailing newline is an artifact, so we strip it.
    pipeStdin('multi line\nquery\n\n');
    await searchCommand().parseAsync(['node', 'cli', '-']);
    const q = retrieveMock.mock.calls[0]?.[1] as { q: string };
    // Trailing whitespace gone; interior newline preserved (BM25 tokeniser
    // splits on whitespace anyway, so it does not matter for results, but
    // we deliberately do not collapse interior whitespace).
    expect(q.q).toBe('multi line\nquery');
  });

  it('an empty stdin stream is a fatal error, NOT a silent whole-index dump', async () => {
    pipeStdin('');
    await searchCommand().parseAsync(['node', 'cli', '-']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('search failed: stdin was empty');
    // Critical: an empty query must NOT reach the retriever.
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('a "-" alongside other argv tokens is treated literally (no stdin read)', async () => {
    // Only a single literal "-" triggers stdin mode. `clawmind search -
    // foo bar` joins to "- foo bar" (the operator probably meant to type
    // the dash but did not want stdin). Stdin must not be read in this
    // case or the command would hang in a real shell.
    await searchCommand().parseAsync(['node', 'cli', '-', 'foo', 'bar']);
    const q = retrieveMock.mock.calls[0]?.[1] as { q: string };
    expect(q.q).toBe('- foo bar');
  });

  it('the normal positional-args path still works byte-for-byte', async () => {
    // Belt-and-braces regression check: the existing `cli search foo bar`
    // shape must not change behaviour now that the `-` branch exists.
    await searchCommand().parseAsync(['node', 'cli', 'foo', 'bar', 'baz']);
    const q = retrieveMock.mock.calls[0]?.[1] as { q: string };
    expect(q.q).toBe('foo bar baz');
  });
});
