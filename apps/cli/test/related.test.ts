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

  // -------------------------------------------------------------
  // --above / --below filter pair. Mirrors `feedback list
  // --above/--below` byte-for-byte: strict comparisons (> and <),
  // non-numeric silently ignored (matches --threshold), composes
  // as intersection. The cron use family:
  //   --above 0.9             -> the strongest signal neighbours
  //                              (isolation diagnostic)
  //   --below 0.4             -> the weakest survivors
  //                              (about-to-drop-out diagnostic)
  //   --above 0.5 --below 0.8 -> the marginal band
  // -------------------------------------------------------------

  it('exposes --above and --below on the command surface', () => {
    const flags = relatedCommand().options.map((o) => o.long);
    expect(flags).toContain('--above');
    expect(flags).toContain('--below');
  });

  it('--above is STRICTLY greater than (excludes exact equality with the bar)', async () => {
    // Strict comparison: a neighbour at score === 0.5 must be
    // excluded by --above 0.5 (it is ON the bar, not above it).
    // Same semantics as `feedback list --above`.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 4,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.95, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.50, hits: 2, excerpt: 'b' }, // ON the bar
            { path: 'c.md', namespace: 'memory', score: 0.30, hits: 1, excerpt: 'c' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--above', '0.5']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    // Only a.md (0.95) clears the strict > 0.5 — b.md (0.50) is
    // on the bar and excluded; c.md (0.30) is below.
    expect(parsed.items.map((i) => i.path)).toEqual(['a.md']);
    expect(parsed.count).toBe(1);
  });

  it('--below is STRICTLY less than (excludes exact equality with the bar)', async () => {
    // Symmetric strict comparison: neighbour at score === 0.5 is
    // excluded by --below 0.5. Pairs with the --above test above
    // — together they pin the strict-inequality contract.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 4,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.95, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.50, hits: 2, excerpt: 'b' }, // ON the bar
            { path: 'c.md', namespace: 'memory', score: 0.30, hits: 1, excerpt: 'c' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--below', '0.5']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    // Only c.md (0.30) clears the strict < 0.5.
    expect(parsed.items.map((i) => i.path)).toEqual(['c.md']);
    expect(parsed.count).toBe(1);
  });

  it('--above + --below composes as an intersection (band filter)', async () => {
    // The marginal range: keep neighbours in the open interval
    // (0.5, 0.8). Both 0.95 and 0.30 fall outside; 0.65 is the
    // only survivor.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 5,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.95, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.65, hits: 2, excerpt: 'b' },
            { path: 'c.md', namespace: 'memory', score: 0.50, hits: 1, excerpt: 'c' }, // boundary
            { path: 'd.md', namespace: 'memory', score: 0.30, hits: 1, excerpt: 'd' },
          ],
          count: 4,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--above', '0.5', '--below', '0.8']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['b.md']);
    expect(parsed.count).toBe(1);
  });

  it('--above composes with --threshold (intersection: inclusive floor + strict tighter floor)', async () => {
    // --threshold is inclusive (>=); --above is strict (>). When
    // both are set the intersection is "score >= threshold AND
    // score > above". The natural use is `--threshold 0.5` for
    // the policy floor + `--above 0.8` for the tight diagnostic
    // narrow on top. The fixture has 0.50 (passes threshold but
    // fails above), 0.85 (passes both), 0.30 (fails threshold).
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 5,
          items: [
            { path: 'strong.md', namespace: 'memory', score: 0.85, hits: 3, excerpt: 's' },
            { path: 'floor.md', namespace: 'memory', score: 0.50, hits: 2, excerpt: 'f' },
            { path: 'weak.md', namespace: 'memory', score: 0.30, hits: 1, excerpt: 'w' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--threshold', '0.5', '--above', '0.8']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['strong.md']);
    expect(parsed.count).toBe(1);
  });

  it('--above with a non-numeric value is silently ignored (matches --threshold)', async () => {
    // `--above $MAYBE` with an empty env var would forward "" here.
    // The contract is "no filter" so a cron pipeline stays useful
    // when the env var is unset. Matches --threshold byte-for-byte.
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
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--above', '']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    // Both items kept; the empty value is treated as "no filter".
    expect(parsed.items).toHaveLength(2);
    expect(parsed.count).toBe(2);
  });

  it('--above composes with --paths-only (filter applies BEFORE the path stream is emitted)', async () => {
    // The band filter must shape the output of EVERY mode the
    // same way — same precedent as --threshold composing with
    // --paths-only.
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
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--above', '0.5']);
    // Only a.md clears > 0.5; the pipeline-friendly contract is
    // honoured (no header, no ANSI, no hint).
    expect(stdout.join('')).toBe('a.md\n');
    expect(stderr.join('')).toBe('');
  });

  // ---------------------------------------------------------------
  // --above / --below + --paths-only byte-layout family.
  //
  // The --above + --paths-only composition is pinned just above.
  // The symmetric --below + --paths-only AND the asymmetric band
  // filter (--above + --below + --paths-only) are NOT pinned —
  // any divergence in the filter ordering or the --paths-only
  // dedupe across those combinations would slip through silently
  // because the existing tests cover only:
  //   - --above alone (the JSON filter behaviour)
  //   - --below alone (the JSON filter behaviour)
  //   - --above + --below alone (the JSON band shape)
  //   - --above + --paths-only (one composition)
  //   - --threshold + --paths-only (a different composition family)
  // The combinations below close the gap. Each test pins the EXACT
  // byte sequence on stdout (`expect(stdout).toBe(...)`) so a
  // future refactor that subtly re-ordered the filter pipeline
  // (e.g. running --paths-only dedupe BEFORE the band filter, which
  // would silently drop survivors when duplicate paths had
  // differing scores) is caught.
  // ---------------------------------------------------------------

  it('--below composes with --paths-only (strict-less-than filter applied BEFORE path stream)', async () => {
    // Symmetric mirror of the --above + --paths-only pin. --below
    // is strict-less-than; a row at exactly the bar is excluded.
    // The path-per-line emit happens AFTER the band filter so the
    // operator pays for the filter exactly once and the stream is
    // byte-clean (no header, no ANSI, no hint).
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 4,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.50, hits: 2, excerpt: 'b' },
            { path: 'c.md', namespace: 'projects', score: 0.40, hits: 2, excerpt: 'c' },
            { path: 'd.md', namespace: 'projects', score: 0.10, hits: 1, excerpt: 'd' },
          ],
          count: 4,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--below', '0.5']);
    // b.md (0.50) is EXCLUDED — strict less-than means equality is out.
    // Only c.md (0.40) and d.md (0.10) survive.
    expect(stdout.join('')).toBe('c.md\nd.md\n');
    expect(stderr.join('')).toBe('');
  });

  it('--above + --below + --paths-only (band filter) emits ONLY the rank-ordered survivors as a path stream', async () => {
    // The asymmetric band: --above is strict-greater-than (>),
    // --below is strict-less-than (<). Together they form an
    // open interval (above, below). A row at either edge is
    // excluded. Path-per-line emit preserves the rank order of
    // survivors and follows the same byte-clean contract as the
    // single-flag --paths-only cases.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 6,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.95, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.80, hits: 2, excerpt: 'b' }, // edge of --below 0.8: excluded
            { path: 'c.md', namespace: 'memory', score: 0.70, hits: 2, excerpt: 'c' }, // in band
            { path: 'd.md', namespace: 'projects', score: 0.60, hits: 2, excerpt: 'd' }, // in band
            { path: 'e.md', namespace: 'projects', score: 0.50, hits: 1, excerpt: 'e' }, // edge of --above 0.5: excluded
            { path: 'f.md', namespace: 'projects', score: 0.30, hits: 1, excerpt: 'f' },
          ],
          count: 6,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--above', '0.5', '--below', '0.8']);
    // Only c.md (0.70) and d.md (0.60) survive the band; both
    // edges (b.md 0.80 and e.md 0.50) are strictly excluded.
    // Rank order is preserved (c.md before d.md, matching the
    // API's input order).
    expect(stdout.join('')).toBe('c.md\nd.md\n');
    expect(stderr.join('')).toBe('');
  });

  it('--above + --below + --paths-only with the band collapsing to empty yields a clean empty stream (no hint)', async () => {
    // Critical xargs-safety pin: when the band excludes every
    // candidate, stdout must be EXACTLY empty (no header, no
    // "no related sources" hint that would poison `xargs ls`).
    // Same precedent as --above + --paths-only with no
    // survivors. A regression where the empty-band case fell
    // through to the text-mode "no related sources" line would
    // be caught here.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 3,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'a' },
            { path: 'b.md', namespace: 'memory', score: 0.10, hits: 1, excerpt: 'b' },
            { path: 'c.md', namespace: 'projects', score: 0.05, hits: 1, excerpt: 'c' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    // Band (0.4, 0.85) catches NONE of the rows: a.md (0.91)
    // is too high, b.md (0.10) and c.md (0.05) are too low.
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--above', '0.4', '--below', '0.85']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--threshold + --above + --below + --paths-only composes all three filters as an intersection', async () => {
    // The tightest possible composition: --threshold (inclusive
    // lower bound) AND --above (strict lower bound) AND --below
    // (strict upper bound) AND --paths-only (path-per-line emit).
    // The combined survivor set is the INTERSECTION of all three
    // filters, applied BEFORE the --paths-only emit. The natural
    // operator question is "the marginal band, hardened by the
    // policy floor": --threshold 0.4 sets the policy ground floor
    // (inclusive), --above 0.5 hardens it (strict), --below 0.85
    // caps the top (strict). The survivor set is [score: 0.5+
    // exclusive, 0.85 exclusive] which is the same as just --above
    // 0.5 --below 0.85 in this case, but the third filter is
    // composed and must not be silently dropped.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 5,
          items: [
            { path: 'a.md', namespace: 'memory', score: 0.90, hits: 3, excerpt: 'a' }, // above 0.85 -> dropped
            { path: 'b.md', namespace: 'memory', score: 0.80, hits: 2, excerpt: 'b' }, // in band
            { path: 'c.md', namespace: 'memory', score: 0.60, hits: 2, excerpt: 'c' }, // in band
            { path: 'd.md', namespace: 'projects', score: 0.45, hits: 1, excerpt: 'd' }, // above threshold 0.4 (inclusive) BUT below --above 0.5 strict -> dropped
            { path: 'e.md', namespace: 'projects', score: 0.30, hits: 1, excerpt: 'e' }, // below threshold -> dropped
          ],
          count: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--threshold', '0.4', '--above', '0.5', '--below', '0.85']);
    // Only b.md (0.80) and c.md (0.60) survive all three filters.
    // The path stream is rank-ordered (matches input order).
    expect(stdout.join('')).toBe('b.md\nc.md\n');
    expect(stderr.join('')).toBe('');
  });
});
