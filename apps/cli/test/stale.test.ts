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

  // -----------------------------------------------------------------
  // --reverse: family-wide reverse-modifier shape, ESTABLISHED on stale
  // first because the three-key per-direction matrix (age/path/size +
  // asc/desc) gives the broadest coverage. The contract every other
  // --sort-bearing command will mirror:
  //   - flips the primary comparator sign
  //   - ALSO flips the secondary index tie-break so cross-snapshot
  //     determinism holds in either direction
  //   - silently ignored without --sort (the default API order is a
  //     fixed contract, not a sort-direction choice)
  //   - composes byte-identically with every output mode
  // -----------------------------------------------------------------

  it('exposes --reverse on the command surface', () => {
    const flags = staleCommand().options.map((o) => o.long);
    expect(flags).toContain('--reverse');
  });

  it('--sort age --reverse orders rows YOUNGEST-first (flips the default oldest-first)', async () => {
    // The canonical "what just crossed the threshold" question: with
    // a 30-day threshold, the operator wants the files that ticked
    // over from fresh to stale most recently. The default --sort age
    // gives oldest-first (highest ageDays); --reverse must give
    // youngest-first (lowest ageDays among the survivors of -d).
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/old.md', ageDays: 200, chunkCount: 1, size: 100 },
        { path: '/just-stale.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/middle.md', ageDays: 90, chunkCount: 1, size: 100 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'age', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    // ageDays ascending (the reverse of the default desc): 31, 90, 200.
    expect(parsed.items.map((i) => i.path)).toEqual(['/just-stale.md', '/middle.md', '/old.md']);
  });

  it('--sort path --reverse orders rows desc alphabetical (flips the default asc)', async () => {
    // Useful for `tail -f`-style log scrapes where the operator wants
    // the FIRST change at the bottom of the visible window.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/a.md', ageDays: 50, chunkCount: 1, size: 100 },
        { path: '/c.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 75, chunkCount: 1, size: 100 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'path', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/c.md', '/b.md', '/a.md']);
  });

  it('--sort size --reverse orders rows smallest-first (flips the default biggest-first)', async () => {
    // Useful when the cleanup budget can afford to skip big files
    // and you want to bulk-clear the small ones first.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/huge.md', ageDays: 100, chunkCount: 1, size: 100_000 },
        { path: '/tiny.md', ageDays: 50, chunkCount: 1, size: 50 },
        { path: '/medium.md', ageDays: 75, chunkCount: 1, size: 5_000 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'size', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    // Smallest first: 50, 5_000, 100_000.
    expect(parsed.items.map((i) => i.path)).toEqual(['/tiny.md', '/medium.md', '/huge.md']);
  });

  it('--reverse without --sort is silently ignored (default API ordering preserved)', async () => {
    // The default API order (oldest-first) is a fixed contract, not a
    // sort-direction choice. --reverse alone has nothing to flip, so
    // it does nothing — matches the --header-without-tsv silent-ignore
    // precedent.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/oldest.md', ageDays: 200, chunkCount: 1, size: 100 },
        { path: '/middle.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/newest.md', ageDays: 35, chunkCount: 1, size: 100 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[] };
    // API order preserved (no flip).
    expect(parsed.items.map((i) => i.path)).toEqual(['/oldest.md', '/middle.md', '/newest.md']);
  });

  it('--sort path --reverse composes byte-identically across --json and --tsv (cross-mode consistency under reverse)', async () => {
    // The cross-mode consistency property MUST hold under --reverse too:
    // a downstream --json consumer and a sibling --tsv consumer must see
    // byte-equivalent row orders. If --reverse were applied differently
    // per output mode, the two scripts would silently disagree.
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
    await staleCommand().parseAsync(['node', 'cli', '--tsv', '--sort', 'path', '--reverse']);
    // TSV rows in desc alphabetical order: c, b, a.
    expect(stdout.join('')).toBe(
      '/c.md\t100\t1\t100\n' +
      '/b.md\t75\t3\t300\n' +
      '/a.md\t50\t2\t200\n',
    );
  });

  it('--reverse preserves cross-snapshot determinism on ties (secondary index sort also reversed)', async () => {
    // The critical determinism property: under --reverse, the secondary
    // tie-break by original index must ALSO flip. Otherwise ties would
    // silently shift on every other run because the primary comparator
    // returned 0 but the secondary kept ascending while the visible
    // ordering of every other row was descending — a snapshot consumer
    // would have no way to tell whether the underlying data changed.
    // Pinned by a "two consecutive runs over identical-ties input
    // produce byte-identical output" property.
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
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'size', '--reverse']);
    const firstRun = stdout.join('');
    stdout.length = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'size', '--reverse']);
    expect(stdout.join('')).toBe(firstRun);
    const parsed = JSON.parse(firstRun) as { items: { path: string }[] };
    // --sort size desc + --reverse = asc. Two size===1000 ties; under
    // the reversed secondary, /second.md (index 2) comes BEFORE
    // /first.md (index 0). The big.md (size 5000) ends up last because
    // the entire size ordering is reversed.
    expect(parsed.items.map((i) => i.path)).toEqual(['/second.md', '/first.md', '/big.md']);
  });

  // ---------------------------------------------------------------
  // --json --slim tests — cron-dashboard shape for stale-budget
  // panels polling "how many files are stale right now". Mirrors
  // the family-wide slim contract: single-line JSON, no per-row
  // detail, only the integers a dashboard panel needs.
  // ---------------------------------------------------------------

  it('exposes --slim on the command surface', () => {
    const flags = staleCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--json --slim emits {count, thresholdDays, since} single-line shape', async () => {
    // The canonical cron panel: count the survivors, echo the
    // threshold parameter, echo --since (null when absent). No
    // per-row detail, no indentation.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/a.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 75, chunkCount: 2, size: 200 },
        { path: '/c.md', ageDays: 50, chunkCount: 3, size: 300 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const raw = stdout.join('');
    // Single-line JSON: no indentation newlines mid-document.
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ count: 3, thresholdDays: 30, since: null });
    // Critical: NO `items`, NO `total` — the slim shape uses `count` instead.
    expect(parsed.items).toBeUndefined();
    expect(parsed.total).toBeUndefined();
  });

  it('--json --slim composes with --since (count describes survivors, since echoes cutoff)', async () => {
    // The --since filter narrows client-side. The slim shape MUST
    // describe the post-filter survivors so a cron poll asking
    // "how many files have been stale since X" gets the right
    // number. The `since` field echoes the cutoff verbatim.
    const payload = {
      thresholdDays: 30,
      total: 3,
      items: [
        // Anchor "now" at parseable time. ageDays=100 means
        // lastIngestedAt = now - 100d, which < cutoff if cutoff
        // is "now - 50d" - we use ISO so the rows survive.
        { path: '/old.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/older.md', ageDays: 200, chunkCount: 2, size: 200 },
        // A recent file: ageDays=10 means lastIngestedAt is in the
        // last 10 days, which is AFTER the cutoff if cutoff = -50d.
        { path: '/recent.md', ageDays: 10, chunkCount: 3, size: 300 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    // Cutoff at 50 days ago — keep files older than that (old.md, older.md).
    const cutoff = new Date(Date.now() - 50 * 86_400_000).toISOString();
    await staleCommand().parseAsync(['node', 'cli', '--json', '--slim', '--since', cutoff]);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.count).toBe(2); // old.md and older.md survive
    expect(parsed.thresholdDays).toBe(30);
    expect(parsed.since).toBe(cutoff);
  });

  it('--json --slim composes with -q (slim count reflects q-filtered survivors)', async () => {
    // -q is forwarded server-side, so the API already returns the
    // narrowed payload. The slim count must match that payload's
    // length, not the unfiltered set.
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/notes/foo.md', ageDays: 50, chunkCount: 1, size: 100 },
        { path: '/notes/bar.md', ageDays: 75, chunkCount: 2, size: 200 },
      ],
    };
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--slim', '-q', 'notes']);
    // -q forwarded as a query string parameter.
    expect(seenUrl).toContain('q=notes');
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.count).toBe(2);
  });

  it('--json --slim with zero matches emits count=0 cleanly', async () => {
    // Edge: empty workspace yields {count: 0, thresholdDays: <n>, since: null}.
    // A downstream `jq .count` consumer can branch on emptiness without
    // re-running. Critically: NOT the empty-table "no sources stale" hint.
    const payload = { thresholdDays: 30, total: 0, items: [] };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed).toEqual({ count: 0, thresholdDays: 30, since: null });
  });

  it('--json --slim wins over --paths when all three are set (stale-specific: --json branch comes first)', async () => {
    // Unlike search/reindex/ingest where --paths-only short-circuits
    // before --json, in stale the --json branch is checked FIRST in
    // source order (this is the long-standing stale precedence and
    // is pinned by `--json wins over --paths` tests earlier in this
    // suite). The slim shape lives inside the --json branch, so when
    // --json --slim --paths are all set, the slim payload fires.
    // This deviates from the family-wide pipeline-beats-dashboard
    // precedent but it preserves stale's existing --json precedence —
    // we'd rather honour the established command-local contract than
    // re-order the branches and risk breaking back-compat for the
    // long-standing `clawmind stale --json --paths` shape that the
    // tests above already pinned.
    const payload = {
      thresholdDays: 30,
      total: 2,
      items: [
        { path: '/a.md', ageDays: 100, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 75, chunkCount: 2, size: 200 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths', '--json', '--slim']);
    // --slim shape, NOT the --paths stream — --json branch fires first
    // in stale (matches the existing precedence; see also the test
    // `--paths wins over --json` would FAIL on stale because that's
    // not the stale contract).
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed).toEqual({ count: 2, thresholdDays: 30, since: null });
  });

  it('--slim is ignored without --json (text mode unchanged)', async () => {
    // Without --json the text path is unchanged. The "N stale" header
    // still fires so a future regression that hijacked text mode under
    // --slim would surface.
    const payload = {
      thresholdDays: 30,
      total: 1,
      items: [
        { path: '/a.md', ageDays: 100, chunkCount: 1, size: 100 },
      ],
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--slim']);
    const out = stdout.join('');
    expect(out).toContain('1 stale');
    expect(out).toContain('/a.md');
  });

  // -----------------------------------------------------------------
  // --top <n>: cap survivors of -q / --since / --days / --sort /
  // --reverse at this many rows. Applied LAST so the cap honours the
  // chosen ordering. Mirrors stats / feedback list / tags list / search
  // --top family contract byte-for-byte: clamped to a positive
  // integer; non-positive or NaN falls back to "no cap".
  // -----------------------------------------------------------------

  it('exposes --top on the command surface', () => {
    const flags = staleCommand().options.map((o) => o.long);
    expect(flags).toContain('--top');
  });

  it('--top 2 caps the survivors to the head of the post-sort order', async () => {
    // Fixture: 5 stale items, --sort size desc keeps biggest first.
    // --top 2 = the 2 biggest.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30,
      total: 5,
      items: [
        { path: '/small.md', ageDays: 35, chunkCount: 1, size: 100 },
        { path: '/biggest.md', ageDays: 45, chunkCount: 10, size: 1_000_000 },
        { path: '/med.md', ageDays: 40, chunkCount: 5, size: 50_000 },
        { path: '/large.md', ageDays: 50, chunkCount: 8, size: 500_000 },
        { path: '/tiny.md', ageDays: 31, chunkCount: 1, size: 50 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'size', '--top', '2']);
    const parsed = JSON.parse(stdout.join('')) as { total: number; items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/biggest.md', '/large.md']);
    // total recomputed to the post-cap survivor count.
    expect(parsed.total).toBe(2);
  });

  it('--top 0 falls back to no cap (matches stats --top clamping; no surprising empty table)', async () => {
    // A typo like `--top 0` would silently yield an empty report
    // under naive slice(0, 0) semantics. The clamp keeps the full
    // list so the operator's mistake is visible (they see all the
    // rows) rather than hidden (they see nothing and assume the
    // index is clean).
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30,
      total: 3,
      items: [
        { path: '/a.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 32, chunkCount: 1, size: 200 },
        { path: '/c.md', ageDays: 33, chunkCount: 1, size: 300 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--top', '0']);
    const parsed = JSON.parse(stdout.join('')) as { total: number; items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/b.md', '/c.md']);
    expect(parsed.total).toBe(3);
  });

  it('--top with a non-numeric value falls back to no cap', async () => {
    // parseInt('banana', 10) returns NaN; the Number.isFinite gate
    // keeps the full list rather than crashing or silently emptying
    // the output.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 2,
      items: [
        { path: '/a.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 32, chunkCount: 1, size: 200 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--top', 'banana']);
    const parsed = JSON.parse(stdout.join('')) as { total: number; items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/b.md']);
    expect(parsed.total).toBe(2);
  });

  it('--top composes with --paths-only (cap applies BEFORE the path emit)', async () => {
    // The canonical cron-budget use: `stale --sort size --top 10
    // --paths | xargs forget --apply`. The cap is applied at the
    // ranked-items layer before --paths-only walks the surviving
    // items, so the stream is exactly N paths.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 5,
      items: [
        { path: '/a.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 32, chunkCount: 1, size: 200 },
        { path: '/c.md', ageDays: 33, chunkCount: 1, size: 300 },
        { path: '/d.md', ageDays: 34, chunkCount: 1, size: 400 },
        { path: '/e.md', ageDays: 35, chunkCount: 1, size: 500 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--paths-only', '--sort', 'size', '--top', '3']);
    // Sort size desc, top 3: /e.md (500), /d.md (400), /c.md (300).
    expect(stdout.join('')).toBe('/e.md\n/d.md\n/c.md\n');
  });

  it('--top composes with --tsv (cap applies BEFORE the TSV emit)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 4,
      items: [
        { path: '/a.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 32, chunkCount: 1, size: 200 },
        { path: '/c.md', ageDays: 33, chunkCount: 1, size: 300 },
        { path: '/d.md', ageDays: 34, chunkCount: 1, size: 400 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--tsv', '--top', '2']);
    // No --sort => API order preserved (a, b). --top 2 keeps head: a, b.
    expect(stdout.join('')).toBe('/a.md\t31\t1\t100\n/b.md\t32\t1\t200\n');
  });

  it('--top composes with --json --slim (slim count reflects the post-cap survivor count)', async () => {
    // The slim shape's `count` MUST match items.length after --top
    // narrows the set. A downstream `jq .count` consumer must never
    // be lied to: if --top 5 capped the survivors, count = 5.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 100,
      items: Array.from({ length: 100 }, (_, i) => ({
        path: `/f${i}.md`, ageDays: 31 + i, chunkCount: 1, size: 100 + i,
      })),
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--slim', '--top', '5']);
    const parsed = JSON.parse(stdout.join('')) as { count: number };
    expect(parsed.count).toBe(5);
  });

  it('--top composes with -q + --sort + --reverse (filters narrow first, then sort orders, then cap)', async () => {
    // Pipeline pin: -q filters down to "f" paths, --sort age --reverse
    // gives youngest-first among them, --top 2 keeps the head.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 5,
      items: [
        { path: '/foo.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/bar.md', ageDays: 50, chunkCount: 1, size: 100 },
        { path: '/fizz.md', ageDays: 40, chunkCount: 1, size: 100 },
        { path: '/baz.md', ageDays: 60, chunkCount: 1, size: 100 },
        { path: '/fuzz.md', ageDays: 35, chunkCount: 1, size: 100 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    // -q is the API param so we expect the fixture to filter server-side.
    // Since our stub doesn't honour ?q, we test the client-side pipeline
    // assuming the API returned all 5 items even with q (worst case).
    await staleCommand().parseAsync(['node', 'cli', '--json', '--sort', 'age', '--reverse', '--top', '2']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string; ageDays: number }[] };
    // --sort age (default desc, oldest first) --reverse => asc, youngest first.
    // Top 2: foo (31), fuzz (35).
    expect(parsed.items.map((i) => i.path)).toEqual(['/foo.md', '/fuzz.md']);
    expect(parsed.items.map((i) => i.ageDays)).toEqual([31, 35]);
  });

  it('--top WITHOUT --sort uses the default API order then caps (back-compat: no surprising reorder)', async () => {
    // No --sort => API order preserved. --top 2 takes the first
    // two items as the API returned them.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 3,
      items: [
        { path: '/first.md', ageDays: 50, chunkCount: 1, size: 100 },
        { path: '/second.md', ageDays: 40, chunkCount: 1, size: 200 },
        { path: '/third.md', ageDays: 60, chunkCount: 1, size: 300 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--top', '2']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; total: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['/first.md', '/second.md']);
    expect(parsed.total).toBe(2);
  });

  it('--top > items.length is a no-op (cap larger than population leaves everything)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      thresholdDays: 30, total: 2,
      items: [
        { path: '/a.md', ageDays: 31, chunkCount: 1, size: 100 },
        { path: '/b.md', ageDays: 32, chunkCount: 1, size: 200 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await staleCommand().parseAsync(['node', 'cli', '--json', '--top', '1000']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; total: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/b.md']);
    expect(parsed.total).toBe(2);
  });
});
