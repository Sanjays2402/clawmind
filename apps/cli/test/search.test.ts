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

describe('search --rerank-off forwards skipRerank=true to retrieve()', () => {
  // The flag is a DEBUG escape hatch: it tells the retrieval
  // pipeline to bypass the lexicalRerank stage so an operator can
  // diagnose whether the heuristic reorder is helping or hurting
  // on a particular query. We capture the FOURTH argument to the
  // retrieve() mock (the new RetrieveOptions param) and assert
  // that it carries `skipRerank: true` when --rerank-off is set
  // and is left undefined otherwise. The hits/scores themselves
  // are not the assertion — the contract is "the flag flows
  // through to the pipeline"; the pipeline-side test in
  // packages/rag covers the actual short-circuit behaviour.
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
      { path: '/a.md', score: 0.5, chunk: { text: '' } },
    ]);
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });

  it('exposes --rerank-off on the command surface', () => {
    const flags = searchCommand().options.map((o) => o.long);
    expect(flags).toContain('--rerank-off');
  });

  it('--rerank-off forwards { skipRerank: true } as the fourth argument to retrieve()', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-off', '--json']);
    // retrieve(deps, q, meta, options) — the 4th positional arg.
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipRerank: true });
  });

  it('without --rerank-off, the options argument is undefined (NOT { skipRerank: false })', async () => {
    // The pipeline-side default is `lexicalRerank ON`; we forward
    // `undefined` so the pipeline does not have to special-case the
    // explicit `skipRerank: false` shape. A future addition to
    // RetrieveOptions can land without breaking existing callers.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json']);
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toBeUndefined();
  });

  it('--rerank-off composes with --threshold (threshold still applied client-side)', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/strong.md', score: 0.92, chunk: { text: '' } },
      { path: '/weak.md', score: 0.10, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-off', '--threshold', '0.5', '--json']);
    const out = JSON.parse(stdout.join('')) as Array<{ path: string }>;
    expect(out.map((h) => h.path)).toEqual(['/strong.md']);
    // And the flag still flowed through.
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipRerank: true });
  });

  it('--rerank-off composes with --paths-only (paths still emitted from the unreranked order)', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/a.md', score: 0.8, chunk: { text: '' } },
      { path: '/b.md', score: 0.6, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-off', '--paths-only']);
    // Exact byte layout — same contract as the non-debug path.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipRerank: true });
  });
});

describe('search --rerank-only forwards skipMmr=true to retrieve()', () => {
  // Mirror of the --rerank-off block but for the inverse flag:
  // --rerank-only tells the pipeline to apply the lexical rerank
  // stage but SKIP the MMR diversity pass on top. The point is to
  // see what rerank ALONE ranks as the top-k, before MMR smears
  // the order with its diversity penalty. Pairs with --rerank-off
  // for a 3-way A/B against the same query (default / no-rerank /
  // no-MMR). The two flags can be combined ("show me the raw
  // hybrid+boost ordering with NEITHER post-stage applied") for
  // the most extreme retrieval-pipeline probe.
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
      { path: '/a.md', score: 0.5, chunk: { text: '' } },
    ]);
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });

  it('exposes --rerank-only on the command surface', () => {
    const flags = searchCommand().options.map((o) => o.long);
    expect(flags).toContain('--rerank-only');
  });

  it('--rerank-only forwards { skipMmr: true } as the fourth argument to retrieve()', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-only', '--json']);
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipMmr: true });
  });

  it('without --rerank-only AND without --rerank-off, the options argument is undefined', async () => {
    // The default path must stay byte-identical so existing callers
    // continue to get the production rerank+MMR ordering. We forward
    // `undefined` (NOT `{}`) so the pipeline default short-circuits
    // without having to special-case empty objects.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json']);
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toBeUndefined();
  });

  it('--rerank-off + --rerank-only together merges both flags into one options object', async () => {
    // Both flags set: the pipeline sees { skipRerank: true, skipMmr: true }.
    // This is the "show me the raw hybrid+boost ordering with no
    // heuristic stages applied" probe — useful when chasing a
    // regression where neither the rerank step nor the diversity
    // pass is responsible for a missing chunk.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-off', '--rerank-only', '--json']);
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipRerank: true, skipMmr: true });
  });

  it('--rerank-only composes with --threshold (threshold still applied client-side)', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/strong.md', score: 0.92, chunk: { text: '' } },
      { path: '/weak.md', score: 0.10, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-only', '--threshold', '0.5', '--json']);
    const out = JSON.parse(stdout.join('')) as Array<{ path: string }>;
    expect(out.map((h) => h.path)).toEqual(['/strong.md']);
    // And the flag still flowed through.
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipMmr: true });
  });

  it('--rerank-only composes with --paths-only (paths still emitted from the no-MMR order)', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/a.md', score: 0.8, chunk: { text: '' } },
      { path: '/b.md', score: 0.6, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--rerank-only', '--paths-only']);
    // The paths-only contract is unaffected by the debug flag.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
    const callArgs = retrieveMock.mock.calls[0] as unknown[];
    expect(callArgs[3]).toEqual({ skipMmr: true });
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

describe('search --paths-only emits a deduplicated path-per-line stream', () => {
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

  it('emits one path per line in rank order with duplicates dropped', async () => {
    // Search returns chunk-granular hits, so /a.md appears in two
    // different chunks. --paths-only must dedupe to ONE /a.md line,
    // keeping the first occurrence so rank order is preserved.
    retrieveMock.mockResolvedValue([
      { path: '/a.md', score: 0.91, chunk: { text: 'first chunk of a' } },
      { path: '/b.md', score: 0.85, chunk: { text: 'b.md chunk' } },
      { path: '/a.md', score: 0.72, chunk: { text: 'second chunk of a' } },
      { path: '/c.md', score: 0.55, chunk: { text: 'c.md chunk' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only']);
    // Exact byte layout — `wc -l` and `xargs -n1` must keep working.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    // No ANSI styling.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
    // No "no results" hint, no headers, no rank/score chatter.
    expect(stderr.join('')).toBe('');
  });

  it('zero matches yields a clean empty stream (NOT the "no results" stderr hint)', async () => {
    // Critical: `clawmind search nope --paths-only | xargs ls` would
    // run ls with the literal string "no results for nope" if we
    // accidentally let the stderr hint leak through. We empty both
    // streams hard.
    retrieveMock.mockResolvedValue([]);
    await searchCommand().parseAsync(['node', 'cli', 'nope', '--paths-only']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only composes with --threshold (filter shrinks the dedup input)', async () => {
    // The threshold filter runs BEFORE --paths-only short-circuits,
    // so a low-score chunk that would have anchored a unique path is
    // dropped, and we never emit that path even though search
    // technically retrieved it.
    retrieveMock.mockResolvedValue([
      { path: '/keep.md', score: 0.92, chunk: { text: '' } },
      { path: '/drop.md', score: 0.10, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', '0.5', '--paths-only']);
    expect(stdout.join('')).toBe('/keep.md\n');
  });

  it('--paths-only short-circuits before --json (--json is ignored as documented)', async () => {
    // The flag contract is "ignore json/out/snippet/highlight" — verify
    // by checking we get the plain path-per-line stream, NOT a JSON
    // array, when both are passed.
    retrieveMock.mockResolvedValue([
      { path: '/x.md', score: 0.5, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--paths-only']);
    expect(stdout.join('')).toBe('/x.md\n');
    // No JSON bracketing.
    expect(stdout.join('')).not.toContain('[');
    expect(stdout.join('')).not.toContain('{');
  });

  it('--paths-only stays dedup-stable when a path repeats more than twice', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/a.md', score: 0.9, chunk: { text: '' } },
      { path: '/a.md', score: 0.8, chunk: { text: '' } },
      { path: '/a.md', score: 0.7, chunk: { text: '' } },
      { path: '/b.md', score: 0.6, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only']);
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
  });
});

// -------------------------------------------------------------------
// --sort <score|path|namespace>: family-wide ordering primitive on
// search. Mirrors `related --sort` byte-for-byte — the contract is:
//   - applied AFTER -t/--threshold (sort orders the survivors)
//   - applied BEFORE --paths-only (the dedupe walks the post-sort order)
//   - score (desc), path (asc), namespace (asc) are the three keys
//   - ties carry a secondary sort by original index for determinism
//   - unknown keys abort cleanly with exit 1
//   - default preserves retrieve() order so existing --json snapshots
//     stay byte-stable
// -------------------------------------------------------------------

describe('search --sort orders hits by an operator-chosen key', () => {
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
    process.exitCode = 0;
  });

  it('exposes --sort on the command surface', () => {
    const flags = searchCommand().options.map((o) => o.long);
    expect(flags).toContain('--sort');
  });

  it('--sort path orders hits alphabetically by path (asc)', async () => {
    // Inputs are in retrieval order (score-descending); --sort path
    // must re-order them alphabetically regardless of score. This is
    // the cross-snapshot diff-stable ordering for `search --json`.
    retrieveMock.mockResolvedValue([
      { path: '/c.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/a.md', namespace: 'projects', score: 0.74, chunk: { text: '' } },
      { path: '/b.md', namespace: 'memory', score: 0.60, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'path']);
    const parsed = JSON.parse(stdout.join('')) as { path: string }[];
    expect(parsed.map((r) => r.path)).toEqual(['/a.md', '/b.md', '/c.md']);
  });

  it('--sort namespace groups hits by namespace asc, then preserves API order within each namespace', async () => {
    // Within a namespace, the secondary-by-index sort keeps the
    // retrieve()-returned order (which is score-descending). So
    // `memory` (alphabetical first) appears before `projects`, and
    // within `memory` the original order is preserved.
    retrieveMock.mockResolvedValue([
      { path: '/proj-a.md', namespace: 'projects', score: 0.99, chunk: { text: '' } },
      { path: '/mem-a.md', namespace: 'memory', score: 0.80, chunk: { text: '' } },
      { path: '/proj-b.md', namespace: 'projects', score: 0.70, chunk: { text: '' } },
      { path: '/mem-b.md', namespace: 'memory', score: 0.60, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'namespace']);
    const parsed = JSON.parse(stdout.join('')) as { path: string; namespace: string }[];
    expect(parsed.map((r) => r.path)).toEqual(['/mem-a.md', '/mem-b.md', '/proj-a.md', '/proj-b.md']);
  });

  it('--sort score is effectively a no-op against the default retrieve() order', async () => {
    // retrieve() already returns score-descending; --sort score must
    // produce byte-identical JSON to no --sort at all.
    const hits = [
      { path: '/a.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/b.md', namespace: 'memory', score: 0.74, chunk: { text: '' } },
      { path: '/c.md', namespace: 'projects', score: 0.42, chunk: { text: '' } },
    ];
    retrieveMock.mockResolvedValue(hits);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json']);
    const baselineOut = stdout.join('');
    stdout.length = 0;
    retrieveMock.mockResolvedValue(hits);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'score']);
    expect(stdout.join('')).toBe(baselineOut);
  });

  it('--sort with an unknown key aborts cleanly (exit 1, error to stderr, NO JSON emitted)', async () => {
    // A typo like `--sort socre` must NOT silently fall back to
    // retrieve() order — that would be indistinguishable from the
    // operator forgetting --sort entirely, and the cron log would
    // hide the misconfig. Hard exit 1.
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.5, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('search failed: --sort value must be one of: score, path, namespace');
    expect(stderr.join('')).toContain('banana');
    // Nothing on stdout — the operator's --json consumer must NOT
    // get a partial payload that looks valid.
    expect(stdout.join('')).toBe('');
  });

  it('--sort is case-insensitive (PATH / Path / path all accepted)', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/c.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/a.md', namespace: 'memory', score: 0.50, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'PATH']);
    const parsed = JSON.parse(stdout.join('')) as { path: string }[];
    expect(parsed.map((r) => r.path)).toEqual(['/a.md', '/c.md']);
  });

  it('--sort composes with --threshold: filter narrows first, sort orders the survivors', async () => {
    // The order matters: --threshold drops /weak.md (0.10) and
    // /below.md (0.30); --sort path orders the survivors alphabetically.
    // Without the post-filter sort, /strong.md (0.95) would lead — with
    // --sort path applied AFTER, /apple.md (0.55) leads alphabetically.
    retrieveMock.mockResolvedValue([
      { path: '/strong.md', namespace: 'memory', score: 0.95, chunk: { text: '' } },
      { path: '/apple.md', namespace: 'memory', score: 0.55, chunk: { text: '' } },
      { path: '/below.md', namespace: 'memory', score: 0.30, chunk: { text: '' } },
      { path: '/weak.md', namespace: 'memory', score: 0.10, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--threshold', '0.5', '--sort', 'path']);
    const parsed = JSON.parse(stdout.join('')) as { path: string }[];
    // Threshold first (keeps /strong.md and /apple.md), then sort path:
    expect(parsed.map((r) => r.path)).toEqual(['/apple.md', '/strong.md']);
  });

  it('--sort path composes with --paths-only: dedupe walks the post-sort order', async () => {
    // --sort path orders all hits alphabetically before --paths-only
    // dedupes by path. So duplicates of the same path collapse to one
    // line, and the final emit is alphabetical.
    retrieveMock.mockResolvedValue([
      { path: '/c.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/a.md', namespace: 'memory', score: 0.80, chunk: { text: '' } },
      { path: '/b.md', namespace: 'memory', score: 0.70, chunk: { text: '' } },
      { path: '/a.md', namespace: 'memory', score: 0.50, chunk: { text: '' } }, // duplicate
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only', '--sort', 'path']);
    // Exact byte layout: alphabetical, deduped, no styling, no headers.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
  });

  it('--sort namespace composes with --paths-only: dedupe walks the namespace-grouped order', async () => {
    // The natural cron pipe: `clawmind search foo --sort namespace
    // --paths-only | xargs ls` — paths grouped by namespace, deduped,
    // ready for xargs. The dedupe MUST walk the post-sort order so
    // the namespace grouping is visible in the emitted stream.
    retrieveMock.mockResolvedValue([
      { path: '/proj-a.md', namespace: 'projects', score: 0.99, chunk: { text: '' } },
      { path: '/mem-a.md', namespace: 'memory', score: 0.80, chunk: { text: '' } },
      { path: '/proj-b.md', namespace: 'projects', score: 0.70, chunk: { text: '' } },
      { path: '/mem-b.md', namespace: 'memory', score: 0.60, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only', '--sort', 'namespace']);
    // memory namespace first (alphabetical), then projects; both
    // namespaces preserve their internal API order.
    expect(stdout.join('')).toBe('/mem-a.md\n/mem-b.md\n/proj-a.md\n/proj-b.md\n');
  });

  it('--sort path ties: identical paths preserved by secondary index sort (cross-snapshot determinism)', async () => {
    // Two hits with the same path but different scores. The
    // primary sort key (path) ties, so the secondary index sort
    // takes over and preserves the retrieve()-returned order
    // (which is score-descending). Without the secondary sort,
    // V8's Array#sort would be stable in practice but the contract
    // would be unenforced — this test pins the contract.
    retrieveMock.mockResolvedValue([
      { path: '/dup.md', namespace: 'memory', score: 0.91, chunk: { text: 'chunk-1' } },
      { path: '/dup.md', namespace: 'memory', score: 0.50, chunk: { text: 'chunk-2' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'path']);
    const parsed = JSON.parse(stdout.join('')) as { path: string; score: number }[];
    // Both rows kept (no dedupe in --json); the 0.91 chunk leads
    // because the secondary sort by original index preserves
    // retrieve() order on the path tie.
    expect(parsed.map((r) => r.score)).toEqual([0.91, 0.50]);
  });
});
