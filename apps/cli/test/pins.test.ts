import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pinsCommand } from '../src/commands/pins.js';

// Captures every Response the test installs so we can assert on the path
// later if we need to. Mirrors the pattern in `aliases.test.ts` /
// `forget.test.ts` exactly so the file is easy to read alongside its
// siblings.
function stubFetch(payload: unknown, init: ResponseInit = { status: 200 }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })) as never;
}

describe('pins cli', () => {
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
    await pinsCommand().parseAsync(['node', 'cli', 'list']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('pins list failed: cannot reach');
    expect(out).toContain('fetch failed');
  });

  it('--paths emits one path per line with no styling, no headers, no notes', async () => {
    stubFetch({
      items: [
        { path: '/a.md', note: 'why a', pinnedAt: 1700000000000, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 1700000001000, pinnedBy: 'me' },
        { path: '/c.md', note: 'why c', pinnedAt: 1700000002000, pinnedBy: 'me' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    // Exact byte layout so `xargs`/`wc -l` keep working.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    // No human summary, no note bodies, no "no pinned sources" line.
    expect(stdout.join('')).not.toContain('by me');
    expect(stdout.join('')).not.toContain('why');
    // No ANSI styling — --paths is meant for downstream commands.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('--paths with zero matches yields a clean empty stream (no "no pinned" hint)', async () => {
    stubFetch({ items: [], count: 0 });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--json still works when --paths is not set', async () => {
    stubFetch({
      items: [{ path: '/a.md', pinnedAt: 0, pinnedBy: 'me' }],
      count: 1,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--json']);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.count).toBe(1);
    expect(parsed.items[0].path).toBe('/a.md');
  });

  // ---------------------------------------------------------------
  // --since tests — client-side post-filter on pinnedAt. Cron use is
  // a daily snapshot of "what got pinned in the last 24h". Cutoff
  // INCLUSIVE (>=); parse failures abort with exit 1; filter applies
  // BEFORE --paths / --json / text so every output mode agrees.
  // Mirrors `mutes list --since` byte-for-byte.
  // ---------------------------------------------------------------

  it('--since keeps only pins whose pinnedAt is at-or-after the cutoff (json mode)', async () => {
    // Three rows with pinnedAt = 1000, 2000, 3000 ms. Cutoff at 2000
    // INCLUSIVE keeps pinnedAt >= 2000 — i.e. the two newest rows.
    stubFetch({
      items: [
        { path: '/a.md', pinnedAt: 3000, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 2000, pinnedBy: 'me' },
        { path: '/c.md', pinnedAt: 1000, pinnedBy: 'me' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list', '--since', new Date(2000).toISOString(), '--json',
    ]);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/b.md']);
    // Recomputed count reflects the filtered length, not the API total.
    expect(parsed.count).toBe(2);
  });

  it('--since composes with --paths (filter applies BEFORE the --paths short-circuit)', async () => {
    stubFetch({
      items: [
        { path: '/a.md', pinnedAt: 3000, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 2000, pinnedBy: 'me' },
        { path: '/c.md', pinnedAt: 1000, pinnedBy: 'me' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list', '--since', new Date(2500).toISOString(), '--paths',
    ]);
    // Only /a.md (pinnedAt 3000) is >= 2500. Exact byte layout so
    // xargs / wc keep working without conditional skips.
    expect(stdout.join('')).toBe('/a.md\n');
  });

  it('--since is INCLUSIVE: a pin at exactly the cutoff timestamp is KEPT', async () => {
    // The semantic match for the other --since flags in the cli
    // (stale, stats, digest show). An entry whose timestamp ===
    // cutoff is "from the cutoff onwards" by every colloquial
    // reading. Pinned exactly at 2000 with --since 2000 must be in.
    stubFetch({
      items: [{ path: '/exact.md', pinnedAt: 2000, pinnedBy: 'me' }],
      count: 1,
    });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list', '--since', new Date(2000).toISOString(), '--json',
    ]);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['/exact.md']);
    expect(parsed.count).toBe(1);
  });

  it('--since with zero matches yields a clean empty paths stream (no "no pinned" hint)', async () => {
    stubFetch({
      items: [{ path: '/old.md', pinnedAt: 1000, pinnedBy: 'me' }],
      count: 1,
    });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list', '--since', new Date(9000).toISOString(), '--paths',
    ]);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--since with an invalid ISO date aborts cleanly with exit code 1', async () => {
    // A typo'd cutoff must NOT silently degrade to "no filter" —
    // that would defeat the cron use of "show me only the recent
    // pins". Same shape as the typo-defence on stats / stale --since.
    stubFetch({ items: [], count: 0 });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list', '--since', 'banana',
    ]);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('pins list failed: --since value "banana" is not a valid ISO date');
  });

  // ---------------------------------------------------------------
  // --by <user> tests — client-side post-filter on pinnedBy.
  // EXACT-MATCH semantics (===, not substring) so overlapping
  // user-id prefixes do not bleed. Composes with -q + --since
  // as an intersection. Filter applies BEFORE --paths/--json/text
  // so every output mode sees the same filtered subset and the
  // recomputed count reflects the filtered length. Multi-user
  // workspaces grow these maps fast; --by is what makes the
  // per-user audit pattern (`pins list --by sanjay --since X`)
  // viable from cron.
  // ---------------------------------------------------------------

  it('--by keeps only pins whose pinnedBy === <user> (exact match, json mode)', async () => {
    stubFetch({
      items: [
        { path: '/a.md', pinnedAt: 3000, pinnedBy: 'sanjay' },
        { path: '/b.md', pinnedAt: 2000, pinnedBy: 'cake' },
        { path: '/c.md', pinnedAt: 1000, pinnedBy: 'sanjay' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--by', 'sanjay', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string; pinnedBy: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/c.md']);
    // Recomputed count reflects the filtered length, not the API total.
    expect(parsed.count).toBe(2);
    // Defensive: every surviving item carries the matching pinnedBy.
    expect(parsed.items.every((i) => i.pinnedBy === 'sanjay')).toBe(true);
  });

  it('--by uses EXACT match (overlapping user-id prefixes do NOT bleed)', async () => {
    // Critical contract: `sanjay-readonly` must NOT match `--by sanjay`.
    // Substring semantics would cause a multi-user workspace with
    // role-suffixed ids to bleed the per-user audit, which is the
    // exact failure mode --by exists to prevent.
    stubFetch({
      items: [
        { path: '/owner.md', pinnedAt: 3000, pinnedBy: 'sanjay' },
        { path: '/reader.md', pinnedAt: 2000, pinnedBy: 'sanjay-readonly' },
        { path: '/other.md', pinnedAt: 1000, pinnedBy: 'cake' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--by', 'sanjay', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    expect(parsed.items.map((i) => i.path)).toEqual(['/owner.md']);
    expect(parsed.count).toBe(1);
  });

  it('--by composes with --since as an intersection (creator AND recency)', async () => {
    // The natural cron use is "what did Sanjay pin in the last
    // 24h". --by narrows by creator; --since narrows by recency.
    // The intersection must require BOTH conditions. We seed three
    // sanjay-pins across time and one cake-pin at the boundary.
    stubFetch({
      items: [
        { path: '/recent-sanjay.md', pinnedAt: 3000, pinnedBy: 'sanjay' },
        { path: '/old-sanjay.md', pinnedAt: 1000, pinnedBy: 'sanjay' },
        { path: '/recent-cake.md', pinnedAt: 3500, pinnedBy: 'cake' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list',
      '--by', 'sanjay',
      '--since', new Date(2000).toISOString(),
      '--json',
    ]);
    const parsed = JSON.parse(stdout.join('')) as { items: { path: string }[]; count: number };
    // Only /recent-sanjay.md satisfies BOTH (sanjay AND >= 2000).
    expect(parsed.items.map((i) => i.path)).toEqual(['/recent-sanjay.md']);
    expect(parsed.count).toBe(1);
  });

  it('--by composes with --paths (filter applies BEFORE the --paths short-circuit)', async () => {
    stubFetch({
      items: [
        { path: '/a.md', pinnedAt: 3000, pinnedBy: 'sanjay' },
        { path: '/b.md', pinnedAt: 2000, pinnedBy: 'cake' },
        { path: '/c.md', pinnedAt: 1000, pinnedBy: 'sanjay' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--by', 'sanjay', '--paths']);
    // Exact byte layout — only Sanjay's two paths.
    expect(stdout.join('')).toBe('/a.md\n/c.md\n');
  });

  it('--by with zero matches yields a clean empty paths stream (no "no pinned" hint)', async () => {
    stubFetch({
      items: [{ path: '/a.md', pinnedAt: 3000, pinnedBy: 'cake' }],
      count: 1,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--by', 'sanjay', '--paths']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--by with zero matches in text mode prints the "no pinned sources" hint (count reflects filter)', async () => {
    // Text mode renders the empty-state hint based on the
    // recomputed count, which reflects the filter. We assert the
    // hint appears even though the API returned a non-empty list —
    // proves the recomputed count drives the hint, not the API total.
    stubFetch({
      items: [{ path: '/a.md', pinnedAt: 3000, pinnedBy: 'cake' }],
      count: 1,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--by', 'sanjay']);
    expect(stdout.join('')).toContain('no pinned sources');
  });

  // -----------------------------------------------------------------
  // --paths-only: family-wide canonical alias for --paths. Both flags
  // emit the byte-identical stream. Mirrors `stale --paths-only` /
  // `tags paths --paths-only` byte-for-byte.
  // -----------------------------------------------------------------

  it('--paths-only emits the byte-identical stream as --paths', async () => {
    stubFetch({
      items: [
        { path: '/a.md', note: 'why a', pinnedAt: 1700000000000, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 1700000001000, pinnedBy: 'me' },
        { path: '/c.md', note: 'why c', pinnedAt: 1700000002000, pinnedBy: 'me' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths-only']);
    // Exact same byte layout as --paths — pin the contract.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
    expect(stdout.join('')).not.toContain('by me');
    expect(stdout.join('')).not.toContain('why');
  });

  it('--paths and --paths-only together produce the same stream (true alias)', async () => {
    // Passing BOTH flags is harmless — they take the same branch.
    // Pin that no double-emit happens and no flag overrides the other.
    stubFetch({
      items: [
        { path: '/a.md', pinnedAt: 1, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 2, pinnedBy: 'me' },
      ],
      count: 2,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths', '--paths-only']);
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
  });

  it('--paths-only composes with --since (filter applies BEFORE the --paths-only short-circuit)', async () => {
    stubFetch({
      items: [
        { path: '/a.md', pinnedAt: 3000, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 2000, pinnedBy: 'me' },
        { path: '/c.md', pinnedAt: 1000, pinnedBy: 'me' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync([
      'node', 'cli', 'list', '--since', new Date(2500).toISOString(), '--paths-only',
    ]);
    // Same survivor as the --paths + --since test (proves
    // --paths-only is byte-faithful with --paths).
    expect(stdout.join('')).toBe('/a.md\n');
  });

  it('--paths-only with zero matches yields a clean empty stream (no "no pinned" hint)', async () => {
    stubFetch({ items: [], count: 0 });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths-only']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });
});
