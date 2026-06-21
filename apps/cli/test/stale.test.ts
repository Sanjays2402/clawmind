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
});
