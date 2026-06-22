import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { staleCommand } from '../src/commands/stale.js';

describe('stale cli', () => {
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
    await staleCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stale failed: cannot reach');
    expect(out).toContain('fetch failed');
    // The stack trace must never leak; the message is the only thing
    // the operator sees, so make sure it's the single line we promised.
    expect(out.trim().split('\n')).toHaveLength(1);
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'manifest locked' }), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stale failed: (503');
    expect(out).toContain('manifest locked');
  });

  it('falls back to raw text when the error body is not json', async () => {
    globalThis.fetch = (async () =>
      new Response('upstream timeout', {
        status: 504,
        statusText: 'Gateway Timeout',
      })) as never;
    await staleCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stale failed: (504');
    expect(out).toContain('upstream timeout');
  });

  it('emits structured json with --json', async () => {
    const payload = {
      thresholdDays: 30,
      total: 1,
      items: [{ path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 }],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json']);
    expect(process.exitCode).toBeFalsy();
    const out = stdout.join('');
    expect(JSON.parse(out)).toEqual(payload);
  });

  it('prints just paths in --paths mode', async () => {
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 },
        { path: '/b.md', ageDays: 45, chunkCount: 1, size: 512 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths']);
    const out = stdout.join('');
    expect(out).toBe('/a.md\n/b.md\n');
  });

  it('--paths-only emits the same byte stream as --paths (canonical alias for family uniformity)', async () => {
    // --paths-only is the spelling used by search/forget/related/
    // pins/mutes/aliases/tags. We bring stale in line by accepting
    // both spellings — they are byte-equivalent so a downstream
    // pipeline that switched from `clawmind search foo --paths-only`
    // to `clawmind stale --paths-only` does not have to special-case
    // stale's older --paths naming.
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 },
        { path: '/b.md', ageDays: 45, chunkCount: 1, size: 512 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths-only']);
    const out = stdout.join('');
    // Same byte layout as the --paths test above so a side-by-side
    // diff confirms the alias is truly an alias, not a near-miss.
    expect(out).toBe('/a.md\n/b.md\n');
    // No ANSI styling — the pipeline-friendly contract is pinned.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('--paths and --paths-only together still emit the canonical byte stream (no doubled output)', async () => {
    // The two flags are intentionally byte-equivalent so passing
    // both should produce the same single-pass output, not the
    // double-emitted variant a naive implementation would produce
    // (one for each flag). This guards against future regressions
    // where one of the flags accidentally falls through to the
    // other code path AFTER emitting.
    const payload = {
      thresholdDays: 30,
      total: 1,
      items: [{ path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 }],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths', '--paths-only']);
    expect(stdout.join('')).toBe('/a.md\n');
  });

  it('--paths-only yields a clean empty stream when nothing is stale (xargs/wc-friendly)', async () => {
    const payload = { thresholdDays: 30, total: 0, items: [] };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths-only']);
    // Same contract as --paths: zero matches => empty stream so
    // `clawmind stale --paths-only | xargs ls` does not poison
    // ls with a "no sources stale" hint.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only composes with --since (filter applies before the path stream is emitted)', async () => {
    // The new alias must compose with the absolute-date filter the
    // same way --paths does. We re-use the deterministic
    // anchor-clock pattern so the assertion is independent of the
    // wall clock.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 2,
        items: [
          { path: '/old.md', ageDays: 100, chunkCount: 3, size: 1024 },
          { path: '/recent.md', ageDays: 5, chunkCount: 1, size: 512 },
        ],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      await staleCommand().parseAsync(['node', 'cli', '--paths-only', '--since', '2026-04-01']);
      // Only the 100-day-old row passes the cutoff.
      expect(stdout.join('')).toBe('/old.md\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits tab-separated rows in --tsv mode for awk/cut pipelines', async () => {
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 },
        { path: '/b.md', ageDays: 45, chunkCount: 1, size: 512 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv']);
    const out = stdout.join('');
    // Exact byte layout so downstream `cut -f2` / `awk -F'\t'` keeps working.
    expect(out).toBe('/a.md\t90\t3\t1024\n/b.md\t45\t1\t512\n');
    // No headers, no ANSI styling — tsv is meant to be machine-readable.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('omits no rows in --tsv mode when nothing is stale (clean empty stream)', async () => {
    const payload = { thresholdDays: 30, total: 0, items: [] };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--since drops rows whose effective lastIngestedAt is at-or-after the cutoff', async () => {
    // Anchor wall-clock so the test is deterministic. With the clock
    // pinned at 2026-06-20T00:00:00Z, a 100d-old file was ingested
    // 2026-03-12, and a 5d-old file was ingested 2026-06-15. With
    // `--since 2026-04-01` we should keep the 100d row and drop the
    // 5d row.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 2,
        items: [
          { path: '/old.md', ageDays: 100, chunkCount: 3, size: 1024 },
          { path: '/recent.md', ageDays: 5, chunkCount: 1, size: 512 },
        ],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      await staleCommand().parseAsync(['node', 'cli', '--json', '--since', '2026-04-01']);
      const out = JSON.parse(stdout.join(''));
      expect(out.items.map((i: { path: string }) => i.path)).toEqual(['/old.md']);
      // `total` reflects the filtered length so the text-mode header
      // ("N stale, showing M") stays accurate post-filter.
      expect(out.total).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('--since with no rows passing the cutoff yields an empty items array and total=0', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 1,
        items: [{ path: '/recent.md', ageDays: 1, chunkCount: 1, size: 512 }],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      await staleCommand().parseAsync(['node', 'cli', '--json', '--since', '2020-01-01']);
      const out = JSON.parse(stdout.join(''));
      expect(out.items).toEqual([]);
      expect(out.total).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('--since composes with --paths (emits only the filtered subset, one path per line)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 3,
        items: [
          { path: '/old1.md', ageDays: 100, chunkCount: 3, size: 1024 },
          { path: '/recent.md', ageDays: 5, chunkCount: 1, size: 512 },
          { path: '/old2.md', ageDays: 200, chunkCount: 2, size: 256 },
        ],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      await staleCommand().parseAsync(['node', 'cli', '--paths', '--since', '2026-04-01']);
      // Only the two "old" rows pass the cutoff; emitted as paths.
      expect(stdout.join('')).toBe('/old1.md\n/old2.md\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('--since with an invalid ISO date errors cleanly with a non-zero exit code', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ thresholdDays: 30, total: 0, items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('stale failed: --since value "banana" is not a valid ISO date');
  });

  // -------------------------------------------------------------
  // --tsv + --since composition. The two flags landed on stale at
  // different times (--tsv first to give awk/cut a tab-separated
  // shape; --since later to add an absolute-date cutoff alongside
  // the relative --days threshold). Each was pinned independently
  // but the COMBINED byte layout — the tab-separated rows that
  // survive the absolute-date filter — was never anchored. A
  // future change to the --since filter that altered the row
  // ordering, or to the --tsv shape that changed the field
  // delimiter / order, would silently break a cron pipeline like:
  //   clawmind stale --tsv --since "$(date -u -d '1 week ago' +%FT%TZ)" \
  //     | awk -F'\t' '$2 > 30 {print $1}'
  // These three tests pin the contract.
  // -------------------------------------------------------------

  it('--tsv --since emits ONLY the filtered subset in the canonical 4-col tab layout', async () => {
    // Wall-clock anchored so the assertion is deterministic. With
    // the clock pinned at 2026-06-20, a 100d-old file was ingested
    // 2026-03-12 (passes --since 2026-04-01) and a 5d-old file
    // was ingested 2026-06-15 (does NOT). The TSV rows in the
    // output must contain ONLY the surviving row, in the byte
    // layout `<path>\t<ageDays>\t<chunkCount>\t<size>\n` — same
    // as the unfiltered --tsv contract pinned above.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 2,
        items: [
          { path: '/old.md', ageDays: 100, chunkCount: 3, size: 1024 },
          { path: '/recent.md', ageDays: 5, chunkCount: 1, size: 512 },
        ],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      await staleCommand().parseAsync(['node', 'cli', '--tsv', '--since', '2026-04-01']);
      // EXACT byte layout: only the 100d-old row, in the canonical
      // path\tageDays\tchunkCount\tsize\n shape. No header, no
      // ANSI, no trailing extra newline. The recent.md row is
      // GONE (--since drops it before --tsv emits).
      expect(stdout.join('')).toBe('/old.md\t100\t3\t1024\n');
      // No ANSI styling slipped in despite the filter composition.
      expect(stdout.join('')).not.toMatch(/\x1b\[/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('--tsv --since with multiple survivors preserves the API row order in the TSV output', async () => {
    // The --since filter is a stable predicate-keep: it does NOT
    // reorder the surviving rows. The TSV shape inherits that
    // stability, so an operator who relied on the API's
    // newest-first / oldest-first ordering for --tsv (e.g. piping
    // through `head -5` to grab the worst offenders) keeps working
    // unchanged when --since is added.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 4,
        items: [
          // API returns oldest-first; rows that survive --since
          // 2026-04-01 are the two 100d+ rows in this fixture.
          { path: '/oldest.md', ageDays: 200, chunkCount: 5, size: 2048 },
          { path: '/old.md', ageDays: 100, chunkCount: 3, size: 1024 },
          { path: '/middle.md', ageDays: 50, chunkCount: 2, size: 768 },
          { path: '/recent.md', ageDays: 5, chunkCount: 1, size: 512 },
        ],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      await staleCommand().parseAsync(['node', 'cli', '--tsv', '--since', '2026-04-01']);
      // Order matches the input: /oldest.md before /old.md. NO
      // re-sort. /middle.md (50d-old → ingested ~2026-05-01, just
      // missing the cutoff) and /recent.md are dropped.
      expect(stdout.join('')).toBe(
        '/oldest.md\t200\t5\t2048\n' +
        '/old.md\t100\t3\t1024\n',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('--tsv --since with the cutoff dropping every row yields a clean empty stream (xargs/wc-friendly)', async () => {
    // The contract is "give me TSV rows, possibly none". A cron
    // pipeline like `clawmind stale --tsv --since X | wc -l` must
    // get 0 (not 1) when nothing survives — same as the
    // empty-state pins for --tsv-alone and --since-alone, but
    // explicitly composed.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 1,
        items: [{ path: '/recent.md', ageDays: 1, chunkCount: 1, size: 512 }],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      // Cutoff way in the past — nothing in the fixture is old
      // enough to pre-date 2020.
      await staleCommand().parseAsync(['node', 'cli', '--tsv', '--since', '2020-01-01']);
      // Empty stream — no header, no "no sources stale" hint, no
      // error. A downstream `wc -l` sees exactly 0 lines.
      expect(stdout.join('')).toBe('');
      expect(stderr.join('')).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  // ---------------------------------------------------------------
  // --tsv --header: prepend a single tab-separated schema row to the
  // body. The cron use is piping the stream into `column -ts$'\t'`
  // or pandas.read_csv(..., sep='\t') where a typed table consumer
  // wants the column names embedded in the stream. The schema row
  // is the contract — it fires unconditionally when --header is
  // set, including when zero data rows pass the filters, so a
  // downstream typed-table parser never has to special-case an
  // empty body.
  // ---------------------------------------------------------------

  it('--tsv --header prepends the canonical 4-col schema row to the body', async () => {
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 },
        { path: '/b.md', ageDays: 45, chunkCount: 1, size: 512 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv', '--header']);
    const out = stdout.join('');
    // Header row first, then the value rows in the same byte
    // layout the --tsv-alone test pins. The header names are
    // exactly the four value columns (`path`, `ageDays`,
    // `chunkCount`, `size`) so a column-count refactor of the
    // body without updating the header would surface as a
    // shape mismatch in tests.
    expect(out).toBe(
      'path\tageDays\tchunkCount\tsize\n' +
      '/a.md\t90\t3\t1024\n' +
      '/b.md\t45\t1\t512\n',
    );
    // No ANSI styling — same machine-readable contract as
    // --tsv-alone.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('--tsv --header still fires the header row when zero data rows pass the filters (schema-row-is-the-contract)', async () => {
    // A typed-table consumer parsing the stream into a dataframe
    // / Excel sheet wants the column names embedded even when the
    // body is empty — otherwise pandas.read_csv('--tsv --header'
    // on an empty workspace) blows up with "No columns to parse"
    // instead of producing a valid empty table. Pin the contract.
    const payload = { thresholdDays: 30, total: 0, items: [] };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv', '--header']);
    // Single line: the schema row, no body. wc -l = 1, not 0.
    expect(stdout.join('')).toBe('path\tageDays\tchunkCount\tsize\n');
    expect(stderr.join('')).toBe('');
  });

  it('--tsv without --header preserves the long-standing header-less awk-pipeline contract', async () => {
    // Regression guard: an unconditional header would break every
    // existing `clawmind stale --tsv | awk -F'\t' '{print $1}'`
    // script in the wild because the first iteration would now
    // emit the literal string "path" instead of the first
    // file's path. Pin that the body stays byte-identical to
    // the --tsv-alone contract.
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 },
        { path: '/b.md', ageDays: 45, chunkCount: 1, size: 512 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv']);
    // Byte-identical to the --tsv-alone pin above — NOT a
    // schema row in sight.
    expect(stdout.join('')).toBe(
      '/a.md\t90\t3\t1024\n' +
      '/b.md\t45\t1\t512\n',
    );
  });

  it('--header without --tsv is silently ignored (precedence: --json beats --header, --paths beats --header, default-text beats --header)', async () => {
    // --header is scoped to the --tsv shape only. The other
    // output modes (--json, --paths/--paths-only, default text)
    // have their own contracts pinned in tests; adding a header
    // line to any of them would break those byte layouts. Silent
    // ignore matches the precedent of --slim being silently
    // ignored without --json, --debounce silently no-op under
    // --once, etc. Pinning the --json case explicitly (the most
    // structurally different mode — the header would otherwise
    // be a literal text line preceding the JSON body).
    const payload = {
      thresholdDays: 30,
      total: 1,
      items: [{ path: '/a.md', ageDays: 90, chunkCount: 3, size: 1024 }],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--header']);
    const out = stdout.join('');
    // No header line — the output is parseable JSON with no
    // preamble.
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out.startsWith('path\t')).toBe(false);
    // Same body as plain --json: total/items preserved.
    const parsed = JSON.parse(out) as { items: { path: string }[] };
    expect(parsed.items).toHaveLength(1);
  });

  it('--tsv --header composes with --since (header fires once even when --since narrows the body)', async () => {
    // The realistic cron invocation: a daily snapshot of stale
    // files older than a fixed anchor, piped into a typed-table
    // consumer. --since narrows the body; --header anchors the
    // schema so the parser knows the column types regardless of
    // how many rows survived.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-06-20T00:00:00Z'));
    try {
      const payload = {
        thresholdDays: 1,
        total: 3,
        items: [
          { path: '/oldest.md', ageDays: 200, chunkCount: 5, size: 2048 },
          { path: '/old.md', ageDays: 100, chunkCount: 3, size: 1024 },
          { path: '/recent.md', ageDays: 5, chunkCount: 1, size: 512 },
        ],
      };
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as never;
      // /oldest.md (ingested ~2025-12-02) and /old.md (ingested
      // ~2026-03-12) both pre-date 2026-04-01; /recent.md
      // (ingested ~2026-06-15) does NOT.
      await staleCommand().parseAsync(['node', 'cli', '--tsv', '--header', '--since', '2026-04-01']);
      expect(stdout.join('')).toBe(
        'path\tageDays\tchunkCount\tsize\n' +
        '/oldest.md\t200\t5\t2048\n' +
        '/old.md\t100\t3\t1024\n',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // -----------------------------------------------------------------
  // --sort <age|path|size>: family-wide ordering primitive on stale.
  // Mirrors search/related/feedback/digest/aliases --sort:
  //   - applied AFTER -q / --since / --days (sort orders the survivors)
  //   - applied BEFORE every output mode so --json / --tsv / --paths /
  //     default text all see the SAME ordered subset
  //   - age (desc), path (asc), size (desc) are the three keys
  //   - ties carry a secondary sort by original index for determinism
  //   - unknown keys abort cleanly with exit 1
  // -----------------------------------------------------------------

  it('exposes --sort on the command surface', () => {
    const flags = staleCommand().options.map((o) => o.long);
    expect(flags).toContain('--sort');
  });

  it('--sort size orders rows desc by byte size (biggest stale files first for disk-recovery priority)', async () => {
    // Canonical cron use: `stale --sort size --paths | xargs forget`
    // — recover the most disk space first when the cleanup budget
    // is tight. The fixture has rows in age order; --sort size
    // must re-rank by byte size desc regardless of age.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/old-small.md', ageDays: 200, chunkCount: 1, size: 100 },
        { path: '/mid-mid.md', ageDays: 100, chunkCount: 5, size: 5000 },
        { path: '/young-huge.md', ageDays: 31, chunkCount: 20, size: 100_000 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'size']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string; size: number }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/young-huge.md', '/mid-mid.md', '/old-small.md']);
  });

  it('--sort path orders rows asc alphabetical (diff-stable cross-snapshot)', async () => {
    // For `stale --json` snapshots over time, the operator wants
    // diff-stable row order independent of which files happened
    // to be newest. --sort path is the answer.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/c.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/a.md', ageDays: 50, chunkCount: 2, size: 200 },
        { path: '/b.md', ageDays: 75, chunkCount: 3, size: 300 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'path']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/b.md', '/c.md']);
  });

  it('--sort age orders rows desc by ageDays (oldest first — matches the API default but pinned for symmetry)', async () => {
    // The API already returns oldest-first; --sort age must
    // produce the same order on a fixture that arrives in a
    // different order (simulating a future API change). Pins the
    // contract so the operator can rely on `--sort age` regardless
    // of what the API does.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/recent.md', ageDays: 35, chunkCount: 1, size: 100 },
        { path: '/oldest.md', ageDays: 365, chunkCount: 1, size: 100 },
        { path: '/middling.md', ageDays: 150, chunkCount: 1, size: 100 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'age']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/oldest.md', '/middling.md', '/recent.md']);
  });

  it('--sort with an unknown key aborts cleanly (exit 1, error mentions valid keys, NO body emitted)', async () => {
    // Mirrors the family contract: a typo cannot silently fall
    // back to API order (which would be indistinguishable from
    // the operator forgetting --sort entirely in the cron log).
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        thresholdDays: 30,
        total: 1,
        items: [{ path: '/a.md', ageDays: 50, chunkCount: 1, size: 100 }],
      }), { status: 200 })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('stale failed: --sort value must be one of: age, path, size');
    expect(stderr.join('')).toContain('banana');
    // No partial JSON body on stdout — the operator's --json
    // consumer must NOT see a half-baked payload.
    expect(stdout.join('')).toBe('');
  });

  it('--sort path composes with --tsv: TSV body order matches JSON body order (cross-mode consistency)', async () => {
    // Critical cross-mode pin: a downstream consumer parsing
    // --json and a sibling parsing --tsv must see byte-equivalent
    // row orders. If the sort were applied differently per output
    // mode, the two scripts would silently disagree.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/c.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/a.md', ageDays: 50, chunkCount: 2, size: 200 },
        { path: '/b.md', ageDays: 75, chunkCount: 3, size: 300 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv', '--sort', 'path']);
    // TSV rows in path order, alphabetical:
    expect(stdout.join('')).toBe(
      '/a.md\t50\t2\t200\n' +
      '/b.md\t75\t3\t300\n' +
      '/c.md\t100\t1\t100\n',
    );
  });

  it('--sort size composes with --paths: path emit order matches the size-sorted row order', async () => {
    // The canonical cron pipe:
    //   clawmind stale --sort size --paths | xargs -n1 clawmind forget --apply
    // The path-per-line emit MUST follow the same order the
    // --json / text modes see, so the operator never has to
    // guess which file gets forgotten first.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/small.md', ageDays: 200, chunkCount: 1, size: 100 },
        { path: '/large.md', ageDays: 50, chunkCount: 5, size: 50_000 },
        { path: '/medium.md', ageDays: 75, chunkCount: 3, size: 5_000 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths', '--sort', 'size']);
    expect(stdout.join('')).toBe('/large.md\n/medium.md\n/small.md\n');
  });

  it('--sort ties: rows at the same key preserved by secondary index sort (deterministic cross-snapshot)', async () => {
    // Two rows with identical size; the primary --sort size ties,
    // so the secondary-by-original-index sort kicks in and
    // preserves API order. Without the secondary sort, V8's
    // Array#sort is stable in practice but the contract would be
    // unenforced — this test pins it explicitly.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/first.md', ageDays: 100, chunkCount: 1, size: 1000 }, // tied size
        { path: '/big.md', ageDays: 50, chunkCount: 5, size: 5000 },
        { path: '/second.md', ageDays: 75, chunkCount: 2, size: 1000 }, // tied size
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'size']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    // /big.md leads (largest); the two size===1000 rows tie, so
    // the secondary index sort preserves their API order
    // (/first.md before /second.md).
    expect(parsed.items.map((i) => i.path)).toEqual(['/big.md', '/first.md', '/second.md']);
  });
});
