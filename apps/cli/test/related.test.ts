import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { relatedCommand } from '../src/commands/related.js';

describe('related cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalFetch = globalThis.fetch;
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
  });

  it('reports a clean message when the api is unreachable', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('related failed: cannot reach');
    expect(out).toContain('fetch failed');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'path not indexed' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('related failed (404');
    expect(out).toContain('path not indexed');
  });

  it('prints results in text mode', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 3,
          items: [
            { path: 'bar.md', namespace: 'memory', score: 0.812, hits: 2, excerpt: 'hello world' },
          ],
          count: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    const out = stdout.join('');
    expect(out).toContain('bar.md');
    expect(out).toContain('0.812');
    expect(out).toContain('hello world');
  });

  it('emits structured json with --json', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ path: 'foo.md', sourceChunkCount: 0, items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json']);
    const out = stdout.join('');
    const parsed = JSON.parse(out);
    expect(parsed.path).toBe('foo.md');
    expect(parsed.count).toBe(0);
  });

  it('--paths-only emits one neighbour path per line in rank order with no styling or header', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 5,
          items: [
            { path: 'b.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'x' },
            { path: 'a.md', namespace: 'memory', score: 0.74, hits: 1, excerpt: 'y' },
            { path: 'c.md', namespace: 'projects', score: 0.60, hits: 2, excerpt: 'z' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only']);
    const out = stdout.join('');
    // Exact byte layout: paths in rank order, one per line, no header,
    // no preamble. Downstream `cut`/`awk`/`xargs` must work without
    // conditional skips.
    expect(out).toBe('b.md\na.md\nc.md\n');
    // No ANSI styling — pipeline-friendly is meant to be machine-readable.
    expect(out).not.toMatch(/\x1b\[/);
    // No "related to ..." header or score text.
    expect(out).not.toContain('related to');
    expect(out).not.toContain('0.91');
    // Stderr stays clean too.
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only with zero matches yields a clean empty stream (no "no related sources" hint)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ path: 'foo.md', sourceChunkCount: 0, items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only']);
    // Nothing on stdout, nothing on stderr — the contract is "give me
    // paths, possibly none". `xargs ls` must NOT receive the
    // human-readable "no related sources found ..." hint.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only deduplicates repeated paths in rank order', async () => {
    // The current API returns one row per source, but the contract we
    // promise downstream consumers is "deduped paths in rank order" so
    // a future API change cannot silently break callers. We exercise
    // the dedupe here against a synthetic payload with repeats.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 5,
          items: [
            { path: 'b.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'x' },
            { path: 'b.md', namespace: 'memory', score: 0.80, hits: 2, excerpt: 'x2' },
            { path: 'a.md', namespace: 'memory', score: 0.74, hits: 1, excerpt: 'y' },
            { path: 'b.md', namespace: 'memory', score: 0.50, hits: 1, excerpt: 'x3' },
          ],
          count: 4,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only']);
    // 'b.md' appears three times in the input; the dedupe keeps only
    // the highest-ranked occurrence (the first one), and 'a.md' falls
    // in between in the original rank order.
    expect(stdout.join('')).toBe('b.md\na.md\n');
  });

  it('--paths-only short-circuits --json (the paths-only contract wins when both are set)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 1,
          items: [{ path: 'a.md', namespace: 'memory', score: 0.5, hits: 1, excerpt: 'x' }],
          count: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--json']);
    // Just the path — NOT a JSON document. The contract is unambiguous.
    const out = stdout.join('');
    expect(out).toBe('a.md\n');
    expect(out.trim().startsWith('{')).toBe(false);
    expect(out.trim().startsWith('[')).toBe(false);
  });

  it('-t/--threshold drops neighbours with score strictly below the bar in text mode', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 4,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'aa' },
            { path: 'b.md', namespace: 'memory', score: 0.55, hits: 2, excerpt: 'bb' },
            { path: 'c.md', namespace: 'projects', score: 0.42, hits: 1, excerpt: 'cc' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '-t', '0.5']);
    const out = stdout.join('');
    // Only a.md (0.91) and b.md (0.55) clear the bar; c.md (0.42) is gone.
    expect(out).toContain('a.md');
    expect(out).toContain('b.md');
    expect(out).not.toContain('c.md');
  });

  it('--threshold filter is reflected in --json (count + items shrink to the kept subset)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 7,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.95, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.50, hits: 2, excerpt: 'b' },
            { path: 'c.md', namespace: 'memory', score: 0.10, hits: 1, excerpt: 'c' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--threshold', '0.5']);
    const parsed = JSON.parse(stdout.join('')) as {
      items: { path: string; score: number }[];
      count: number;
      sourceChunkCount: number;
    };
    // Inclusive lower bound: score === 0.5 stays in.
    expect(parsed.items.map((i) => i.path)).toEqual(['a.md', 'b.md']);
    // `count` reflects the kept items, not the API total.
    expect(parsed.count).toBe(2);
    // `sourceChunkCount` is a property of the source itself and is
    // preserved verbatim — the filter does not touch it.
    expect(parsed.sourceChunkCount).toBe(7);
  });

  it('--threshold composes with --paths-only (filter applies BEFORE the paths-only emit)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 3,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.40, hits: 2, excerpt: 'b' },
            { path: 'c.md', namespace: 'projects', score: 0.20, hits: 1, excerpt: 'c' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '-t', '0.5']);
    // Only a.md clears 0.5; the pipeline-friendly contract is
    // honoured (no header, no ANSI, no "no related sources" hint).
    expect(stdout.join('')).toBe('a.md\n');
    expect(stderr.join('')).toBe('');
  });

  it('--threshold with a non-numeric value is silently ignored (mirrors search --threshold)', async () => {
    // `--threshold $MAYBE` in a shell script with an empty env var
    // would forward "" here. The contract is "no filter" so the
    // command stays useful when the variable is unset.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 2,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.10, hits: 1, excerpt: 'b' },
          ],
          count: 2,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--threshold', '']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    // Both items kept; the empty value is treated as "no filter".
    expect(parsed.items).toHaveLength(2);
    expect(parsed.count).toBe(2);
  });

  it('--threshold above every score yields an empty subset (json: items=[], count=0; text: "no related sources" hint)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 2,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.50, hits: 1, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.30, hits: 1, excerpt: 'b' },
          ],
          count: 2,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--threshold', '0.99']);
    const parsed = JSON.parse(stdout.join('')) as { items: unknown[]; count: number };
    expect(parsed.items).toEqual([]);
    expect(parsed.count).toBe(0);
  });

  // -------------------------------------------------------------
  // -n / --namespaces end-to-end regression tests.
  //
  // The flag has existed since the command first shipped, but
  // without a test pinning the URL we had no proof it actually
  // travelled to /v1/related. A future refactor could quietly
  // stop forwarding the value and every existing script depending
  // on namespace narrowing would silently get the unfiltered set.
  // These tests pin the contract:
  //   1. the comma-separated value reaches the API as
  //      ?namespaces=<verbatim> (server-side splits the csv)
  //   2. without the flag, no `namespaces` query param appears
  //   3. composes with -k and --threshold without dropping the
  //      namespaces value
  // -------------------------------------------------------------

  it('-n forwards the comma-separated value to the api as ?namespaces=<value>', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ path: 'foo.md', sourceChunkCount: 1, items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '-n', 'memory,projects']);
    expect(calledUrl).toBeDefined();
    const u = new URL(calledUrl!);
    expect(u.pathname).toBe('/v1/related');
    // The value goes through verbatim; the API splits/trims server-side.
    expect(u.searchParams.get('namespaces')).toBe('memory,projects');
    // The mandatory params still travel correctly alongside the namespaces filter.
    expect(u.searchParams.get('path')).toBe('foo.md');
    expect(u.searchParams.get('k')).toBe('8');
  });

  it('--namespaces (long form) forwards identically to -n', async () => {
    // Catch the regression where the option binding diverges between
    // the short and long forms. We assert the URL with both forms
    // matches byte-for-byte.
    let shortFormUrl: string | undefined;
    let longFormUrl: string | undefined;
    globalThis.fetch = (async (url: string | URL) => {
      if (shortFormUrl === undefined) shortFormUrl = String(url);
      else longFormUrl = String(url);
      return new Response(
        JSON.stringify({ path: 'foo.md', sourceChunkCount: 1, items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '-n', 'memory']);
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--namespaces', 'memory']);
    expect(shortFormUrl).toBeDefined();
    expect(longFormUrl).toBeDefined();
    // The querystrings are sufficient; the host:port portion may
    // vary by env but the test runs with the same loadEnv() seed.
    expect(new URL(shortFormUrl!).search).toBe(new URL(longFormUrl!).search);
  });

  it('without -n / --namespaces the namespaces param is omitted from the URL entirely', async () => {
    // Regression for a subtle bug class: if the option were forwarded
    // unconditionally (e.g. `set('namespaces', opts.namespaces ?? '')`)
    // the API would silently see `?namespaces=` and the zod
    // `.optional()` would coerce it to undefined — but a stricter
    // server-side schema in the future could read the empty string
    // as "match nothing", filtering out every hit. The contract is
    // "send nothing" when the flag is absent.
    let calledUrl: string | undefined;
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ path: 'foo.md', sourceChunkCount: 1, items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    expect(calledUrl).toBeDefined();
    const u = new URL(calledUrl!);
    expect(u.searchParams.has('namespaces')).toBe(false);
  });

  it('-n composes with -k and --threshold (all three flags travel without interference)', async () => {
    let calledUrl: string | undefined;
    globalThis.fetch = (async (url: string | URL) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 5,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.10, hits: 1, excerpt: 'b' },
          ],
          count: 2,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as never;
    await relatedCommand().parseAsync([
      'node', 'cli', 'foo.md',
      '-n', 'memory,projects',
      '-k', '20',
      '--threshold', '0.5',
      '--json',
    ]);
    // Namespaces + k travel through the URL; threshold is a
    // client-side post-filter so it does NOT appear on the URL.
    expect(calledUrl).toBeDefined();
    const u = new URL(calledUrl!);
    expect(u.searchParams.get('namespaces')).toBe('memory,projects');
    expect(u.searchParams.get('k')).toBe('20');
    expect(u.searchParams.has('threshold')).toBe(false);
    // The threshold still applied client-side as expected.
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['a.md']);
    expect(parsed.count).toBe(1);
  });
});
