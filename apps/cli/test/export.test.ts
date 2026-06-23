import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCommand } from '../src/commands/export.js';

describe('export cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let captured: string[];
  let originalWrite: typeof process.stdout.write;
  let dir: string;
  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => { captured.push(String(c)); return true; }) as never;
    dir = mkdtempSync(join(tmpdir(), 'cm-export-'));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('writes markdown to stdout when --out is omitted', async () => {
    globalThis.fetch = (async () => new Response('# hi\n\nbody\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    expect(captured.join('')).toContain('# hi');
  });

  it('writes to file when --out is provided', async () => {
    globalThis.fetch = (async () => new Response('# file\n', { status: 200 })) as never;
    const out = join(dir, 'conv.md');
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-o', out, '--api', 'http://x']);
    expect(readFileSync(out, 'utf8')).toBe('# file\n');
    expect(captured.join('')).toContain(`-> ${out}`);
  });

  it('hits the json endpoint when --format json is passed', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('{"id":"abc"}', { status: 200 });
    }) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'json', '--api', 'http://x']);
    expect(seenUrl).toBe('http://x/v1/conversations/abc/export.json');
    expect(captured.join('')).toContain('"id":"abc"');
  });

  it('hits the csv endpoint when --format csv is passed', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('role,content\nuser,hi\n', { status: 200 });
    }) as never;
    const out = join(dir, 'conv.csv');
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'csv', '-o', out, '--api', 'http://x']);
    expect(seenUrl).toBe('http://x/v1/conversations/abc/export.csv');
    expect(readFileSync(out, 'utf8')).toContain('role,content');
  });

  it('rejects unknown formats before calling the api', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('', { status: 200 }); }) as never;
    await expect(
      exportCommand().exitOverride().parseAsync(['node', 'cli', 'abc', '-f', 'pdf', '--api', 'http://x']),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });

  it('reports failure with exit code on non-2xx', async () => {
    globalThis.fetch = (async () => new Response('not found', { status: 404, statusText: 'Not Found' })) as never;
    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    try {
      await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('export failed');
    expect(stderr.join('')).toContain('not found');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'conversation abc not found' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })) as never;
    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    try {
      await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('conversation abc not found');
  });

  it('reports a clean message when the api is unreachable', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as never;
    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    try {
      await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('cannot reach http://x');
    expect(out).toContain('fetch failed');
  });

  // ---------------------------------------------------------------
  // --since <iso-date> tests — forward as ?since=<value> to the API
  // for an incremental dump (mirrors the --since contract across
  // stale/stats/digest show/pins/mutes/ingest/reindex byte-for-byte).
  // Validation hard-fails up front so a typo cannot silently degrade
  // to the full export and double-bill the bandwidth budget. Empty
  // windows yield a well-formed export with zero turns, NOT a 404,
  // so a cron polling a quiet conversation does not alarm.
  // ---------------------------------------------------------------

  it('--since forwards as ?since=<value> to the export endpoint (md format)', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('# narrowed\n', { status: 200 });
    }) as never;
    const cutoff = new Date(2000).toISOString();
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--since', cutoff, '--api', 'http://x']);
    expect(seenUrl).toBe(`http://x/v1/conversations/abc/export.md?since=${encodeURIComponent(cutoff)}`);
    expect(captured.join('')).toContain('# narrowed');
  });

  it('--since forwards on the json format too (cron incremental json backups)', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('{"version":1,"conversation":{"turns":[]}}', { status: 200 });
    }) as never;
    const cutoff = new Date(3000).toISOString();
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'json', '--since', cutoff, '--api', 'http://x']);
    expect(seenUrl).toBe(`http://x/v1/conversations/abc/export.json?since=${encodeURIComponent(cutoff)}`);
  });

  it('--since forwards on the csv format too', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('turn_id,role\n', { status: 200 });
    }) as never;
    const cutoff = new Date(4000).toISOString();
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'csv', '--since', cutoff, '--api', 'http://x']);
    expect(seenUrl).toBe(`http://x/v1/conversations/abc/export.csv?since=${encodeURIComponent(cutoff)}`);
  });

  it('without --since, the URL is byte-for-byte unchanged from the legacy contract', async () => {
    // Critical regression: every existing script / dashboard / cron job
    // that called `export <id>` without --since must hit the EXACT same
    // URL as before — no trailing `?since=` empty querystring, no stray
    // `?` separator. We assert the absence rather than just the prefix
    // so a future refactor cannot silently append empty parameters.
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('# legacy\n', { status: 200 });
    }) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    expect(seenUrl).toBe('http://x/v1/conversations/abc/export.md');
    expect(seenUrl).not.toContain('?');
  });

  it('--since with an invalid ISO date aborts cleanly with exit 1 BEFORE any network round-trip', async () => {
    // The whole point of validating client-side is that a typo'd
    // cutoff cannot waste a round-trip on the API's generic 400 wrap.
    // We confirm the fetch was never called.
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('', { status: 200 }); }) as never;
    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    try {
      await exportCommand().parseAsync(['node', 'cli', 'abc', '--since', '2026-13-01', '--api', 'http://x']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(called).toBe(false);
    expect(stderr.join('')).toContain('export failed: --since value "2026-13-01" is not a valid ISO date');
  });

  it('--since cutoff is properly URL-encoded (colons and pluses survive the querystring)', async () => {
    // ISO dates carry a `:` (and sometimes `+` for tz offsets) so a
    // naïve string concat would silently corrupt the cutoff. We
    // encodeURIComponent the value before splicing; assert the
    // colons land as %3A in the final URL so a cron-encoded value
    // round-trips to the API verbatim.
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('# encoded\n', { status: 200 });
    }) as never;
    const cutoff = '2026-06-21T10:11:12.000Z';
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--since', cutoff, '--api', 'http://x']);
    expect(seenUrl).toContain('since=2026-06-21T10%3A11%3A12.000Z');
  });

  it('--since composes with -o (file write still happens with the narrowed body)', async () => {
    globalThis.fetch = (async () => new Response('# narrowed\n', { status: 200 })) as never;
    const out = join(dir, 'narrow.md');
    const cutoff = new Date(5000).toISOString();
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--since', cutoff, '-o', out, '--api', 'http://x']);
    expect(readFileSync(out, 'utf8')).toBe('# narrowed\n');
    expect(captured.join('')).toContain(`-> ${out}`);
  });

  // ---------------------------------------------------------------
  // --slim tests — dashboard probe shape `{format, since, bytes}`
  // that drops the conversation body and reports only the response
  // byte length. The classic cron use is
  //   clawmind export <id> --since <iso> --slim
  // polled every minute to answer "did this conversation grow since
  // the cutoff, and by how much" without paying the wire cost of
  // the full transcript.
  // ---------------------------------------------------------------

  it('exposes --slim on the command surface', () => {
    const flags = exportCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--slim emits the {format, since, bytes} 3-key dashboard probe shape (md default)', async () => {
    // Default format is md; --slim must report bytes === body.length.
    // Fixture body is exactly 11 bytes ("# narrowed\n").
    globalThis.fetch = (async () => new Response('# narrowed\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--slim', '--api', 'http://x']);
    const out = captured.join('');
    const doc = JSON.parse(out);
    expect(doc).toEqual({ format: 'md', since: null, bytes: 11 });
  });

  it('--slim suppresses the conversation body on stdout (no transcript leak)', async () => {
    // The headline contract: the body must NOT land on stdout. A
    // dashboard polling --slim should never accidentally surface
    // the transcript into its NDJSON stream (the slim payload
    // would still be parseable but the stream would carry
    // arbitrary user content between snapshots).
    globalThis.fetch = (async () => new Response('# sensitive transcript\n\nmore content\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--slim', '--api', 'http://x']);
    const out = captured.join('');
    expect(out).not.toContain('sensitive transcript');
    expect(out).not.toContain('more content');
    // The slim JSON is parseable.
    const doc = JSON.parse(out);
    expect(typeof doc.bytes).toBe('number');
  });

  it('--slim is single-line JSON with a trailing newline (NDJSON-friendly)', async () => {
    // The slim shape is the cron-snapshot contract. `while true;
    // do clawmind export <id> --since X --slim; sleep 60; done`
    // must produce clean NDJSON. We pin: no embedded newlines in
    // the body, exactly one trailing newline.
    globalThis.fetch = (async () => new Response('# body\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--slim', '--api', 'http://x']);
    const out = captured.join('');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1)).not.toContain('\n');
    // No indentation — single-line JSON.stringify.
    expect(out).not.toContain('  "');
  });

  it('--slim composes with --since (echoes the cutoff in the payload)', async () => {
    // The `since` echo is the multi-cutoff dashboard contract: a
    // panel polling several time windows uses this key to identify
    // which row it is reading. Mirrors the reindex/ingest slim
    // since-anchor convention byte-for-byte.
    globalThis.fetch = (async () => new Response('# delta\n', { status: 200 })) as never;
    const cutoff = '2026-06-01T00:00:00.000Z';
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--since', cutoff, '--slim', '--api', 'http://x']);
    const doc = JSON.parse(captured.join(''));
    expect(doc.since).toBe(cutoff);
    expect(doc.format).toBe('md');
    expect(doc.bytes).toBe('# delta\n'.length);
  });

  it('--slim composes with -f json (format echo carries through)', async () => {
    // A multi-format dashboard polling md/json/csv for the same
    // conversation uses the format echo to label rows. The slim
    // shape must surface whichever format was requested.
    globalThis.fetch = (async () => new Response('{"version":1,"conversation":{"turns":[]}}', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'json', '--slim', '--api', 'http://x']);
    const doc = JSON.parse(captured.join(''));
    expect(doc.format).toBe('json');
    expect(doc.bytes).toBe('{"version":1,"conversation":{"turns":[]}}'.length);
  });

  it('--slim composes with -f csv', async () => {
    globalThis.fetch = (async () => new Response('turn_id,role\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'csv', '--slim', '--api', 'http://x']);
    const doc = JSON.parse(captured.join(''));
    expect(doc.format).toBe('csv');
    expect(doc.bytes).toBe('turn_id,role\n'.length);
  });

  it('--slim with -o SKIPS the file write (probe shape, not persistence shape)', async () => {
    // The -o file write is intentionally skipped under --slim: the
    // body has been discarded, the slim probe is a polling shape,
    // not a persistence shape. An operator who wants both must run
    // twice. We assert no file was written.
    globalThis.fetch = (async () => new Response('# would-be-saved\n', { status: 200 })) as never;
    const target = join(dir, 'should-not-exist.md');
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--slim', '-o', target, '--api', 'http://x']);
    // The slim JSON is on stdout.
    const doc = JSON.parse(captured.join(''));
    expect(doc.bytes).toBe('# would-be-saved\n'.length);
    // The target file MUST NOT exist (write skipped).
    expect(() => readFileSync(target, 'utf8')).toThrow();
  });

  it('--slim does not fire on a non-2xx (standard error path takes over first)', async () => {
    // The slim probe is for HEALTHY exports only. A non-2xx response
    // hits the existing `export failed (<code>)` error path and
    // exits 1 BEFORE reaching the slim branch — a dashboard polling
    // --slim should see an empty stdout (no JSON line to confuse the
    // NDJSON parser) and a non-zero exit so the cron wrapper alerts.
    globalThis.fetch = (async () => new Response('not found', { status: 404, statusText: 'Not Found' })) as never;
    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    try {
      await exportCommand().parseAsync(['node', 'cli', 'abc', '--slim', '--api', 'http://x']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(captured.join('')).toBe('');
    expect(stderr.join('')).toContain('export failed');
  });

  it('--slim reports bytes=0 for an empty cutoff-window (md format)', async () => {
    // An empty cutoff-window returns a well-formed export with zero
    // turns. For md format, that collapses to an empty body
    // (0 bytes). A dashboard wiring `bytes > 0` distinguishes a
    // real delta from an empty window without parsing the body.
    globalThis.fetch = (async () => new Response('', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--since', '2099-01-01', '--slim', '--api', 'http://x']);
    const doc = JSON.parse(captured.join(''));
    expect(doc.bytes).toBe(0);
    expect(doc.since).toBe('2099-01-01');
  });

  it('without --slim, the legacy stdout / -o emit is byte-for-byte unchanged (no regression)', async () => {
    // The slim shape is opt-in; the absence of --slim must yield
    // exactly the pre-existing behaviour. We re-run the most basic
    // case (md to stdout) and assert the body still lands there.
    globalThis.fetch = (async () => new Response('# legacy\n\nbody\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    expect(captured.join('')).toContain('# legacy');
    expect(captured.join('')).toContain('body');
    // It is NOT JSON.
    expect(() => JSON.parse(captured.join(''))).toThrow();
  });
});
