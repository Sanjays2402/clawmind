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

  // -----------------------------------------------------------------
  // --sort <key>: order survivors of --threshold / --above / --below
  // by an operator-chosen axis. Mirrors `feedback list --sort` /
  // `digest list --sort` / `aliases list --sort` precedent: applied
  // AFTER the band filters, secondary sort by index for ties,
  // unknown keys abort cleanly with exit 1.
  // -----------------------------------------------------------------

  it('--sort path orders survivors alphabetically ascending', async () => {
    // The API returns items score-descending; --sort path
    // overrides to alphabetical for stable cross-snapshot diffs.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        items: [
          { path: 'zeta.md', namespace: 'memory', score: 0.90, hits: 1, excerpt: 'z' },
          { path: 'alpha.md', namespace: 'memory', score: 0.85, hits: 1, excerpt: 'a' },
          { path: 'mu.md', namespace: 'memory', score: 0.80, hits: 1, excerpt: 'm' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--sort', 'path']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((it) => it.path)).toEqual(['alpha.md', 'mu.md', 'zeta.md']);
  });

  it('--sort namespace groups neighbours alphabetically by namespace', async () => {
    // Mixed namespaces should resolve to alphabetical namespace
    // order; within each namespace the secondary sort by original
    // index preserves API order (which is score-descending).
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 4,
        items: [
          { path: 'p1.md', namespace: 'projects', score: 0.90, hits: 1, excerpt: 'p1' },
          { path: 'm1.md', namespace: 'memory', score: 0.85, hits: 1, excerpt: 'm1' },
          { path: 'p2.md', namespace: 'projects', score: 0.80, hits: 1, excerpt: 'p2' },
          { path: 'm2.md', namespace: 'memory', score: 0.75, hits: 1, excerpt: 'm2' },
        ],
        count: 4,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--sort', 'namespace']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string; namespace: string }[] };
    // All `memory` namespace items first (in API order: m1, m2),
    // then all `projects` items (in API order: p1, p2).
    expect(parsed.items.map((it) => `${it.namespace}/${it.path}`)).toEqual([
      'memory/m1.md', 'memory/m2.md', 'projects/p1.md', 'projects/p2.md',
    ]);
  });

  it('--sort score is a no-op (matches default API ordering descending)', async () => {
    // Useful for symmetry with other commands; also a guard
    // against a future API change that returned items in a
    // different order — --sort score would still produce the
    // expected score-descending stream.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        // Deliberately scrambled to prove --sort works regardless
        // of input order.
        items: [
          { path: 'mid.md', namespace: 'memory', score: 0.65, hits: 1, excerpt: 'm' },
          { path: 'high.md', namespace: 'memory', score: 0.90, hits: 1, excerpt: 'h' },
          { path: 'low.md', namespace: 'memory', score: 0.40, hits: 1, excerpt: 'l' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--sort', 'score']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    // Score-descending: high (0.90), mid (0.65), low (0.40).
    expect(parsed.items.map((it) => it.path)).toEqual(['high.md', 'mid.md', 'low.md']);
  });

  it('--sort path composes with --above (sort orders survivors of band filter)', async () => {
    // --above 0.5 narrows to the strong-signal half, --sort path
    // alphabetizes those survivors for a deterministic stream
    // suitable for diffing.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 4,
        items: [
          { path: 'zeta.md', namespace: 'memory', score: 0.90, hits: 1, excerpt: 'z' },
          { path: 'alpha.md', namespace: 'memory', score: 0.40, hits: 1, excerpt: 'a' }, // dropped by --above 0.5
          { path: 'beta.md', namespace: 'memory', score: 0.75, hits: 1, excerpt: 'b' },
          { path: 'omega.md', namespace: 'memory', score: 0.35, hits: 1, excerpt: 'o' }, // dropped
        ],
        count: 4,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--above', '0.5', '--sort', 'path']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    // Only beta.md + zeta.md survive --above 0.5; --sort path
    // orders them alphabetically.
    expect(parsed.items.map((it) => it.path)).toEqual(['beta.md', 'zeta.md']);
    expect(parsed.count).toBe(2);
  });

  it('--sort with an unknown key aborts cleanly with exit 1', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 1,
        items: [{ path: 'bar.md', namespace: 'memory', score: 0.8, hits: 1, excerpt: 'b' }],
        count: 1,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--sort', 'banana']);
    expect(process.exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('related failed: --sort value must be one of: score, path, namespace');
    expect(err).toContain('"banana"');
  });

  // -----------------------------------------------------------------
  // --reverse: mirrors `stale --reverse` and `search --reverse` byte-
  // for-byte. The third (and final, for the queued list) command in
  // the --sort-bearing family to expose --reverse. After this commit
  // the family-wide reverse-modifier contract is complete on all three
  // commands the queued list called out (stale, search, related).
  // -----------------------------------------------------------------

  it('exposes --reverse on the command surface', () => {
    const flags = relatedCommand().options.map((o) => o.long);
    expect(flags).toContain('--reverse');
  });

  it('--sort path --reverse orders neighbours desc alphabetical (flips the default asc)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        items: [
          { path: 'mu.md', namespace: 'memory', score: 0.90, hits: 1, excerpt: 'm' },
          { path: 'alpha.md', namespace: 'memory', score: 0.65, hits: 1, excerpt: 'a' },
          { path: 'zeta.md', namespace: 'memory', score: 0.40, hits: 1, excerpt: 'z' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--sort', 'path', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((it) => it.path)).toEqual(['zeta.md', 'mu.md', 'alpha.md']);
  });

  it('--sort namespace --reverse groups by namespace desc, secondary index reversed within each namespace', async () => {
    // Default --sort namespace is asc; --reverse gives desc. Within
    // each namespace the secondary index sort is also reversed.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 4,
        items: [
          { path: 'm1.md', namespace: 'memory', score: 0.95, hits: 1, excerpt: 'm1' },
          { path: 'p1.md', namespace: 'projects', score: 0.85, hits: 1, excerpt: 'p1' },
          { path: 'm2.md', namespace: 'memory', score: 0.70, hits: 1, excerpt: 'm2' },
          { path: 'p2.md', namespace: 'projects', score: 0.55, hits: 1, excerpt: 'p2' },
        ],
        count: 4,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--sort', 'namespace', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string; namespace: string }[] };
    // projects (desc-first), within projects the index is reversed so
    // p2 before p1. Then memory (desc-second), within memory the index
    // is reversed so m2 before m1.
    expect(parsed.items.map((it) => it.path)).toEqual(['p2.md', 'p1.md', 'm2.md', 'm1.md']);
  });

  it('--sort score --reverse orders neighbours weakest-first (asc score)', async () => {
    // The cron use: "the neighbours about to drop out of the related
    // set the next time the rerank shuffles" — answers a different
    // question than --below (which filters; --sort score --reverse
    // orders).
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        items: [
          { path: 'strong.md', namespace: 'memory', score: 0.95, hits: 1, excerpt: 's' },
          { path: 'mid.md', namespace: 'memory', score: 0.55, hits: 1, excerpt: 'm' },
          { path: 'weak.md', namespace: 'memory', score: 0.32, hits: 1, excerpt: 'w' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--sort', 'score', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string; score: number }[] };
    expect(parsed.items.map((it) => it.score)).toEqual([0.32, 0.55, 0.95]);
  });

  it('--reverse without --sort is silently ignored (default API ordering preserved)', async () => {
    // The default API order is a fixed contract. --reverse alone has
    // nothing to flip — matches `stale --reverse` / `search --reverse`
    // silent-ignore precedent.
    const payload = {
      path: 'foo.md',
      sourceChunkCount: 3,
      items: [
        { path: 'high.md', namespace: 'memory', score: 0.95, hits: 1, excerpt: 'h' },
        { path: 'mid.md', namespace: 'memory', score: 0.55, hits: 1, excerpt: 'm' },
        { path: 'low.md', namespace: 'memory', score: 0.32, hits: 1, excerpt: 'l' },
      ],
      count: 3,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json']);
    const baseline = stdout.join('');
    stdout.length = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--reverse']);
    expect(stdout.join('')).toBe(baseline);
  });

  it('--sort path --reverse composes with --paths-only: dedupe walks the post-reverse desc order', async () => {
    // The dedupe walks AFTER the sort+reverse. The API returns each
    // path once (related is path-granular not chunk-granular), but
    // the contract promises dedupe — pinning that --reverse does
    // not break it.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        items: [
          { path: 'alpha.md', namespace: 'memory', score: 0.95, hits: 1, excerpt: 'a' },
          { path: 'charlie.md', namespace: 'memory', score: 0.55, hits: 1, excerpt: 'c' },
          { path: 'bravo.md', namespace: 'memory', score: 0.32, hits: 1, excerpt: 'b' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--sort', 'path', '--reverse']);
    expect(stdout.join('')).toBe('charlie.md\nbravo.md\nalpha.md\n');
  });

  it('--sort path --reverse composes with --above (band-filter narrows, sort orders the survivors desc)', async () => {
    // Combine band filter and reverse to pin "the alphabetically-
    // last neighbour that survived --above".
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 4,
        items: [
          { path: 'zeta.md', namespace: 'memory', score: 0.90, hits: 1, excerpt: 'z' },
          { path: 'alpha.md', namespace: 'memory', score: 0.40, hits: 1, excerpt: 'a' }, // dropped by --above 0.5
          { path: 'beta.md', namespace: 'memory', score: 0.75, hits: 1, excerpt: 'b' },
          { path: 'omega.md', namespace: 'memory', score: 0.35, hits: 1, excerpt: 'o' }, // dropped
        ],
        count: 4,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--above', '0.5', '--sort', 'path', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((it) => it.path)).toEqual(['zeta.md', 'beta.md']);
    expect(parsed.count).toBe(2);
  });

  // -----------------------------------------------------------------
  // related --json --slim: drop the per-neighbour `hits` count AND
  // the multi-paragraph `excerpt` body (both dominate payload size)
  // and reduce each item to `{path, score, namespace}`. Preserve
  // sourceChunkCount + count + path at the top level. Mirrors the
  // `doctor --json --quiet`, `digest run --json --slim`, `feedback
  // prune --json --slim`, `feedback list --json --slim`, `search
  // --json --slim`, and `stats --json --slim` precedent.
  // -----------------------------------------------------------------

  it('exposes --slim on the related command surface', () => {
    const flags = relatedCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--json --slim drops `hits` and `excerpt` per item, keeps {path, score, namespace} only', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 5,
        items: [
          { path: 'b.md', namespace: 'memory', score: 0.91, hits: 3, excerpt: 'MUST_NOT_LEAK body for b' },
          { path: 'a.md', namespace: 'memory', score: 0.74, hits: 1, excerpt: 'MUST_NOT_LEAK body for a' },
        ],
        count: 2,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as { items: Record<string, unknown>[]; sourceChunkCount: number; count: number; path: string };
    // Per-item shape: exactly three fields.
    for (const it of parsed.items) {
      expect(Object.keys(it).sort()).toEqual(['namespace', 'path', 'score']);
    }
    expect(parsed.items[0]).toEqual({ path: 'b.md', namespace: 'memory', score: 0.91 });
    expect(parsed.items[1]).toEqual({ path: 'a.md', namespace: 'memory', score: 0.74 });
    // Top-level: path, sourceChunkCount, count, items.
    expect(Object.keys(parsed).sort()).toEqual(['count', 'items', 'path', 'sourceChunkCount']);
    expect(parsed.path).toBe('foo.md');
    expect(parsed.sourceChunkCount).toBe(5);
    expect(parsed.count).toBe(2);
    // Excerpts and hits MUST NOT leak.
    const raw = stdout.join('');
    expect(raw).not.toContain('MUST_NOT_LEAK');
    expect(raw).not.toContain('hits');
    expect(raw).not.toContain('excerpt');
  });

  it('--json --slim PRESERVES sourceChunkCount verbatim (property of the source, not the returned set)', async () => {
    // Critical contract: sourceChunkCount describes how many chunks
    // the source itself contributes to the index, NOT how many
    // neighbours survived the filter. Even if --threshold / --above
    // narrows the returned set to zero, sourceChunkCount stays at
    // the API value — the dashboard wants to know "foo.md has 47
    // chunks but ZERO neighbours pass my threshold" as TWO separate
    // numbers.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 47,
        items: [
          { path: 'weak.md', namespace: 'memory', score: 0.10, hits: 1, excerpt: '' },
        ],
        count: 1,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--slim', '--threshold', '0.5']);
    const parsed = JSON.parse(stdout.join('')) as { sourceChunkCount: number; count: number; items: unknown[] };
    // Threshold dropped the single weak neighbour; count goes to 0;
    // but sourceChunkCount STAYS at 47.
    expect(parsed.sourceChunkCount).toBe(47);
    expect(parsed.count).toBe(0);
    expect(parsed.items).toEqual([]);
  });

  it('--json --slim emits single-line JSON (NDJSON-friendly snapshot stream)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        items: [
          { path: 'a.md', namespace: 'memory', score: 0.91, hits: 1, excerpt: 'long body' },
        ],
        count: 1,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json', '--slim']);
    const out = stdout.join('');
    // Single-line: no internal newlines, just the trailing one.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1).includes('\n')).toBe(false);
    // No indentation noise (full --json uses 2-space indent;
    // --slim deliberately does NOT).
    expect(out).not.toMatch(/\n  /);
  });

  it('--paths-only wins over --slim (--paths-only is the EVEN-leaner emit shape)', async () => {
    // Precedence: --paths-only > --slim > full --json. --paths-only
    // is the EVEN-leaner shape (no JSON wrapper at all). Pin that
    // --slim does NOT inject JSON into the path-per-line stream
    // when both are set.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        path: 'foo.md',
        sourceChunkCount: 3,
        items: [
          { path: 'a.md', namespace: 'memory', score: 0.91, hits: 1, excerpt: '' },
          { path: 'b.md', namespace: 'memory', score: 0.55, hits: 2, excerpt: '' },
        ],
        count: 2,
      }), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--paths-only', '--json', '--slim']);
    expect(stdout.join('')).toBe('a.md\nb.md\n');
  });

  it('--slim WITHOUT --json is silently ignored (text mode unchanged)', async () => {
    // --slim only matters in --json mode (text mode for humans is
    // already the human-readable rendering). Mirrors the `feedback
    // prune --slim without --json silent-ignore` precedent.
    const payload = {
      path: 'foo.md',
      sourceChunkCount: 3,
      items: [
        { path: 'a.md', namespace: 'memory', score: 0.91, hits: 1, excerpt: 'body for a' },
      ],
      count: 1,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    const baseline = stdout.join('');
    stdout.length = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200 })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--slim']);
    expect(stdout.join('')).toBe(baseline);
  });
});

