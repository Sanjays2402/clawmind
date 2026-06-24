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

describe('search --slim emits the deeper-cut {rank,path,score,namespace} json shape', () => {
  // --slim is the cron-dashboard shape: drops snippet + highlights
  // (like --no-snippet) AND startLine, leaving just the four fields
  // needed for "what does the top-k for query X look like over
  // time". Mirrors the `doctor --json --quiet`, `digest run --json
  // --slim`, `feedback prune --json --slim`, `feedback list --json
  // --slim`, and `stats --json --slim` precedent.
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
    // We assert below that snippetFor is NOT called in the slim
    // path (perf property: dashboards must not pay the snippet
    // rendering cost). Mock body returned shouldn't matter; if it
    // does the slim assertion will catch it.
    snippetForMock.mockImplementation((hit: { path: string }) => ({
      startLine: 99,
      text: `MUST_NOT_LEAK body for ${hit.path}`,
      highlights: [{ start: 0, end: 7 }],
    }));
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/b.md', namespace: 'projects', score: 0.42, chunk: { text: '' } },
    ]);
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  });

  it('exposes --slim on the search surface', () => {
    const flags = searchCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--json --slim emits exactly {rank,path,score,namespace} per hit (no snippet, no highlights, no startLine)', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim']);
    const out = JSON.parse(stdout.join('')) as Record<string, unknown>[];
    expect(out).toHaveLength(2);
    // Exact key set per row — strictly the four slim fields.
    for (const row of out) {
      expect(Object.keys(row).sort()).toEqual(['namespace', 'path', 'rank', 'score']);
    }
    expect(out[0]).toEqual({ rank: 1, path: '/a.md', score: 0.91, namespace: 'memory' });
    expect(out[1]).toEqual({ rank: 2, path: '/b.md', score: 0.42, namespace: 'projects' });
    // Snippet body, highlights, AND startLine MUST NOT leak.
    const raw = stdout.join('');
    expect(raw).not.toContain('MUST_NOT_LEAK');
    expect(raw).not.toContain('highlights');
    expect(raw).not.toContain('startLine');
    expect(raw).not.toContain('"99"');
  });

  it('--json --slim DOES NOT call snippetFor (perf property: dashboards skip the snippet-rendering cost)', async () => {
    // The critical perf property: the slim path walks `hits` directly
    // without calling snippetFor() per hit. A cron dashboard polling
    // once a minute over a 50-result top-k must not pay 50 snippet
    // renders per poll — the slim shape is exactly the shape that
    // does NOT need them. Without this property the slim emit would
    // be no faster than --no-snippet, defeating the point.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim']);
    expect(snippetForMock).not.toHaveBeenCalled();
    // And the full-shape path STILL calls snippetFor() (this is the
    // baseline; if it ever stopped, --slim's perf claim would be
    // vacuous).
    stdout.length = 0;
    snippetForMock.mockClear();
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json']);
    expect(snippetForMock).toHaveBeenCalled();
  });

  it('--json --slim emits single-line JSON.stringify (NDJSON-friendly snapshot stream)', async () => {
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim']);
    const out = stdout.join('');
    // Single-line: no internal newlines, just the trailing one.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1).includes('\n')).toBe(false);
    // No indentation noise (the full --json shape uses 2-space
    // indent; --slim deliberately does NOT to keep NDJSON clean).
    expect(out).not.toMatch(/\n  /);
  });

  it('--json --slim wins over --no-snippet (--slim is strictly slimmer)', async () => {
    // The precedence under --json:
    //   --slim > --no-snippet > full --json
    // --slim already drops snippet/highlights AND startLine; passing
    // --no-snippet alongside cannot make the shape any leaner. Pin
    // that the four-field slim shape survives when both are set.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim', '--no-snippet']);
    const out = JSON.parse(stdout.join('')) as Record<string, unknown>[];
    for (const row of out) {
      expect(Object.keys(row).sort()).toEqual(['namespace', 'path', 'rank', 'score']);
    }
    // Verify the result is byte-identical to plain --json --slim
    // (no --no-snippet) — the modifier had no axis to operate on.
    const composed = stdout.join('');
    stdout.length = 0;
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim']);
    expect(composed).toBe(stdout.join(''));
  });

  it('--paths-only wins over --slim (--paths-only is the EVEN-leaner emit shape)', async () => {
    // The precedence over the other emit modes:
    //   --paths-only > --slim > --no-snippet > full --json
    // --paths-only is the EVEN-leaner shape (no JSON wrapper at all)
    // so it wins. Pin that --slim does NOT inject JSON into the
    // path-per-line stream when both are set.
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only', '--json', '--slim']);
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
  });

  it('--slim WITHOUT --json is silently ignored (text mode unchanged)', async () => {
    // --slim only matters in --json mode (text mode for humans is
    // already the human-readable rendering). Mirrors the `feedback
    // prune --slim without --json silent-ignore` precedent. The
    // text output should be byte-identical to running WITHOUT --slim.
    await searchCommand().parseAsync(['node', 'cli', 'foo']);
    const baseline = stdout.join('');
    stdout.length = 0;
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--slim']);
    expect(stdout.join('')).toBe(baseline);
  });

  it('--slim with --out writes the slim payload to a file and emits the wrote-N stderr confirm', async () => {
    // Mirrors the full --json --out dispatch byte-for-byte: writes
    // to the file, emits the "wrote N result(s)" stderr confirm
    // line, leaves stdout empty. Switching --slim on/off should not
    // shift the file-vs-stdout dispatch.
    const dir = await mkdtemp(path.join(tmpdir(), 'clawmind-search-slim-'));
    try {
      const outPath = path.join(dir, 'hits.json');
      await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim', '-o', outPath]);
      const body = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>[];
      expect(body).toEqual([
        { rank: 1, path: '/a.md', score: 0.91, namespace: 'memory' },
        { rank: 2, path: '/b.md', score: 0.42, namespace: 'projects' },
      ]);
      // Stdout empty (everything went to the file).
      expect(stdout.join('')).toBe('');
      // Stderr carries the wrote-N confirm.
      expect(stderr.join('')).toContain('wrote 2 result(s) -> ');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('--json --slim composes with --threshold (slim describes survivors of the band-filter)', async () => {
    // --threshold is applied BEFORE the slim emit; the slim shape
    // describes the survivors, not the raw retrieve() set. Pin the
    // composition so a future regression that ran --slim against
    // the raw hits would surface immediately.
    retrieveMock.mockResolvedValue([
      { path: '/strong.md', namespace: 'memory', score: 0.92, chunk: { text: '' } },
      { path: '/medium.md', namespace: 'memory', score: 0.55, chunk: { text: '' } },
      { path: '/weak.md', namespace: 'memory', score: 0.10, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--slim', '-t', '0.5']);
    const out = JSON.parse(stdout.join('')) as { path: string; score: number; rank: number }[];
    // Only strong + medium survived the threshold; the ranks
    // re-index from 1 (not from the pre-filter position).
    expect(out).toEqual([
      { rank: 1, path: '/strong.md', score: 0.92, namespace: 'memory' },
      { rank: 2, path: '/medium.md', score: 0.55, namespace: 'memory' },
    ]);
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

  // -----------------------------------------------------------------
  // --reverse: mirrors `stale --reverse` byte-for-byte. Three keys
  // (score / path / namespace) so three direction-flip cases:
  //   --sort score   default desc -> --reverse asc (weakest first)
  //   --sort path    default asc  -> --reverse desc
  //   --sort namespace default asc -> --reverse desc (most-recent
  //                                                   alphabetically
  //                                                   first)
  // -----------------------------------------------------------------

  it('exposes --reverse on the command surface', () => {
    const flags = searchCommand().options.map((o) => o.long);
    expect(flags).toContain('--reverse');
  });

  it('--sort path --reverse orders hits desc alphabetical (flips the default asc)', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/c.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/a.md', namespace: 'projects', score: 0.74, chunk: { text: '' } },
      { path: '/b.md', namespace: 'memory', score: 0.60, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'path', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { path: string }[];
    expect(parsed.map((r) => r.path)).toEqual(['/c.md', '/b.md', '/a.md']);
  });

  it('--sort score --reverse orders hits asc by score (weakest first — "about to fall off the relevance edge")', async () => {
    // The default --sort score is desc (highest-first); --reverse
    // gives asc (weakest first). The cron use is the inverse-band
    // probe: "the hits that BARELY passed the threshold, ordered
    // worst-first" — useful for tuning the threshold dial.
    retrieveMock.mockResolvedValue([
      { path: '/strong.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/mid.md', namespace: 'memory', score: 0.60, chunk: { text: '' } },
      { path: '/weak.md', namespace: 'memory', score: 0.31, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'score', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { score: number }[];
    expect(parsed.map((r) => r.score)).toEqual([0.31, 0.60, 0.91]);
  });

  it('--sort namespace --reverse groups by namespace desc (most-recent alphabetically first)', async () => {
    // Default --sort namespace is asc; --reverse gives desc. Within
    // each namespace the secondary index sort is also reversed so
    // the order within the same namespace is the API order reversed.
    retrieveMock.mockResolvedValue([
      { path: '/mem-a.md', namespace: 'memory', score: 0.80, chunk: { text: '' } },
      { path: '/proj-a.md', namespace: 'projects', score: 0.70, chunk: { text: '' } },
      { path: '/mem-b.md', namespace: 'memory', score: 0.60, chunk: { text: '' } },
      { path: '/proj-b.md', namespace: 'projects', score: 0.50, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'namespace', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { path: string }[];
    // projects (desc-first), within projects the secondary index is
    // ALSO reversed so proj-b before proj-a. Same for memory: mem-b
    // before mem-a.
    expect(parsed.map((r) => r.path)).toEqual(['/proj-b.md', '/proj-a.md', '/mem-b.md', '/mem-a.md']);
  });

  it('--reverse without --sort is silently ignored (default retrieve() ordering preserved)', async () => {
    // The retrieve() order is a fixed contract. --reverse alone has
    // nothing to flip so it does nothing — matches `stale --reverse`
    // silent-ignore precedent.
    const hits = [
      { path: '/a.md', namespace: 'memory', score: 0.91, chunk: { text: '' } },
      { path: '/b.md', namespace: 'memory', score: 0.74, chunk: { text: '' } },
      { path: '/c.md', namespace: 'projects', score: 0.42, chunk: { text: '' } },
    ];
    retrieveMock.mockResolvedValue(hits);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json']);
    const baseline = stdout.join('');
    stdout.length = 0;
    retrieveMock.mockResolvedValue(hits);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--reverse']);
    expect(stdout.join('')).toBe(baseline);
  });

  it('--sort path --reverse composes with --paths-only: dedupe walks the post-reverse desc order', async () => {
    // The dedupe walks AFTER the sort+reverse, so the survivor set
    // is in desc alphabetical order. Duplicates collapse to first
    // occurrence in the post-reverse walk order.
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.91, chunk: { text: 'chunk-1' } },
      { path: '/c.md', namespace: 'memory', score: 0.80, chunk: { text: '' } },
      { path: '/a.md', namespace: 'memory', score: 0.60, chunk: { text: 'chunk-2' } }, // dup
      { path: '/b.md', namespace: 'memory', score: 0.50, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only', '--sort', 'path', '--reverse']);
    // After --sort path --reverse: /c.md, /b.md, /a.md (chunk-1), /a.md (chunk-2)
    // After dedupe: /c.md, /b.md, /a.md.
    expect(stdout.join('')).toBe('/c.md\n/b.md\n/a.md\n');
  });

  it('--reverse preserves cross-snapshot determinism on ties (secondary index also reversed)', async () => {
    // Two snapshots over identical input MUST produce byte-identical
    // output under --reverse. The dual-flip of the secondary index
    // sort is the critical property — without it, ties would silently
    // shift across runs.
    const hits = [
      { path: '/dup.md', namespace: 'memory', score: 0.91, chunk: { text: 'chunk-1' } },
      { path: '/dup.md', namespace: 'memory', score: 0.50, chunk: { text: 'chunk-2' } },
      { path: '/zzz.md', namespace: 'memory', score: 0.42, chunk: { text: '' } },
    ];
    retrieveMock.mockResolvedValue(hits);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'path', '--reverse']);
    const firstRun = stdout.join('');
    stdout.length = 0;
    retrieveMock.mockResolvedValue(hits);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--sort', 'path', '--reverse']);
    expect(stdout.join('')).toBe(firstRun);
    const parsed = JSON.parse(firstRun) as { path: string; score: number }[];
    // --sort path --reverse: /zzz.md first (desc alphabetical), then
    // the two /dup.md hits — secondary index is REVERSED so the
    // index=1 chunk (score 0.50) comes BEFORE the index=0 chunk
    // (score 0.91). Without the secondary-reverse, the 0.91 would
    // come first and the snapshot would silently flip.
    expect(parsed.map((r) => `${r.path}:${r.score}`)).toEqual(['/zzz.md:0.42', '/dup.md:0.5', '/dup.md:0.91']);
  });
});

// -------------------------------------------------------------------
// --tsv [+ --header]: family-wide tab-separated emit on search.
// Mirrors `stale --tsv` / `stats --tsv` byte-for-byte (zero ANSI,
// zero header by default, zero trailing summary, plain \n separator).
// The four columns (rank, path, score, namespace) match the --json
// --slim shape so a downstream parser flipping between the two only
// changes the framing, not the schema.
// -------------------------------------------------------------------

describe('search --tsv emits tab-separated rank/path/score/namespace rows', () => {
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
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
  });

  it('exposes --tsv and --header on the search surface', () => {
    const flags = searchCommand().options.map((o) => o.long);
    expect(flags).toContain('--tsv');
    expect(flags).toContain('--header');
  });

  it('--tsv emits exactly one row per hit in the canonical 4-col layout, no header, no ANSI', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.912, chunk: { text: '' } },
      { path: '/b.md', namespace: 'projects', score: 0.4201, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--tsv']);
    const out = stdout.join('');
    // Exact byte layout: <rank>\t<path>\t<score.toFixed(3)>\t<namespace>\n
    // Score uses toFixed(3) to match text-mode precision so cross-mode
    // diffs are byte-stable.
    expect(out).toBe('1\t/a.md\t0.912\tmemory\n2\t/b.md\t0.420\tprojects\n');
    // No headers without --header.
    expect(out.startsWith('rank\t')).toBe(false);
    // No ANSI codes — the stream is meant for awk/cut.
    expect(out).not.toMatch(/\x1b\[/);
    expect(stderr.join('')).toBe('');
    // snippetFor is NOT called on the --tsv path (perf property: no
    // snippet rendering for a pipeline-shape emit).
    expect(snippetForMock).not.toHaveBeenCalled();
  });

  it('--tsv --header prepends the canonical 4-col schema row', async () => {
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.5, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--tsv', '--header']);
    const out = stdout.join('');
    expect(out).toBe('rank\tpath\tscore\tnamespace\n1\t/a.md\t0.500\tmemory\n');
  });

  it('--tsv --header still fires the header row when zero hits match (schema-row-is-the-contract)', async () => {
    // A typed-table consumer parsing the stream against an empty
    // workspace should still see the column names and produce a
    // valid empty table, not crash with "No columns to parse".
    // Mirrors stale --tsv --header / stats --tsv --header byte-for-byte.
    retrieveMock.mockResolvedValue([]);
    await searchCommand().parseAsync(['node', 'cli', 'nope', '--tsv', '--header']);
    // wc -l = 1 (header only), not 0.
    expect(stdout.join('')).toBe('rank\tpath\tscore\tnamespace\n');
    // The "no results for X" hint MUST NOT leak — under --tsv the
    // empty-state stays empty so xargs/wc see exactly the header row.
    expect(stderr.join('')).toBe('');
  });

  it('--tsv zero hits without --header yields a fully empty stream (xargs-safe)', async () => {
    // Without --header the schema is omitted, so wc -l = 0 not 1.
    // Critical for `clawmind search nope --tsv | wc -l` returning 0.
    retrieveMock.mockResolvedValue([]);
    await searchCommand().parseAsync(['node', 'cli', 'nope', '--tsv']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only wins over --tsv (pipeline-leaner shape short-circuits first)', async () => {
    // Precedence: --paths-only > --tsv > --json > text. When both are
    // set, --paths-only emits ONE path per line (deduped) and the TSV
    // schema/rows never fire. This pins the contract documented in
    // the help text.
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.9, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--paths-only', '--tsv']);
    // Bare path stream, no tabs, no schema row.
    expect(stdout.join('')).toBe('/a.md\n');
    expect(stdout.join('')).not.toContain('\t');
  });

  it('--tsv wins over --json (tab-separated pipeline contract beats JSON wrapper)', async () => {
    // Precedence: --tsv > --json. The TSV stream is what awk/cut want;
    // JSON would force a jq dance for the same data. Pin the
    // short-circuit by checking we get the tab-separated rows, not a
    // JSON array.
    retrieveMock.mockResolvedValue([
      { path: '/a.md', namespace: 'memory', score: 0.8, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--json', '--tsv']);
    const out = stdout.join('');
    // Tab-separated, no JSON bracketing.
    expect(out).toBe('1\t/a.md\t0.800\tmemory\n');
    expect(out).not.toContain('[');
    expect(out).not.toContain('{');
  });

  it('--tsv composes with --threshold (filter narrows the rows before emit)', async () => {
    // --threshold runs BEFORE the --tsv branch so the TSV stream is
    // the post-filter survivors. The rank counter restarts at 1 for
    // the survivor set (matches --paths-only / --json behaviour).
    retrieveMock.mockResolvedValue([
      { path: '/keep.md', namespace: 'memory', score: 0.92, chunk: { text: '' } },
      { path: '/drop.md', namespace: 'memory', score: 0.10, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--threshold', '0.5', '--tsv']);
    // Only /keep.md survives; rank=1 (not rank=1 of the pre-filter set).
    expect(stdout.join('')).toBe('1\t/keep.md\t0.920\tmemory\n');
  });

  it('--tsv composes with --sort path (rows emit in alphabetical order with re-numbered ranks)', async () => {
    // The --sort branch runs BEFORE the --tsv emit so the TSV rows
    // reflect the post-sort order. The rank column re-numbers from 1
    // against the sorted set (so rank in the TSV stream matches the
    // visible order, not the original retrieve() rank).
    retrieveMock.mockResolvedValue([
      { path: '/zzz.md', namespace: 'memory', score: 0.9, chunk: { text: '' } },
      { path: '/aaa.md', namespace: 'memory', score: 0.5, chunk: { text: '' } },
    ]);
    await searchCommand().parseAsync(['node', 'cli', 'foo', '--sort', 'path', '--tsv']);
    expect(stdout.join('')).toBe('1\t/aaa.md\t0.500\tmemory\n2\t/zzz.md\t0.900\tmemory\n');
  });
});

