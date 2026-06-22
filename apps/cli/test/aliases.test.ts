import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { aliasesCommand } from '../src/commands/aliases.js';

describe('aliases cli', () => {
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
    await aliasesCommand().parseAsync(['node', 'cli', 'list']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('aliases list failed: cannot reach');
    expect(out).toContain('fetch failed');
  });

  it('surfaces the message field from a json error body on add', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'invalid alias name' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'add', 'BAD!', '/tmp']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('aliases add failed: (400');
    expect(out).toContain('invalid alias name');
  });

  it('prints text rows in list mode', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          items: [{ name: 'notes', path: '/n', createdAt: 0, createdBy: 'me' }],
          count: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list']);
    const out = stdout.join('');
    expect(out).toContain('@notes');
    expect(out).toContain('/n');
  });

  it('emits structured json with --json', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json']);
    const out = stdout.join('');
    const parsed = JSON.parse(out);
    expect(parsed.count).toBe(0);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  it('--paths emits one alias target per line with no @name, arrow, or styling', async () => {
    // Three aliases, one with a long path, one ordinary, one nested. We
    // assert the exact byte layout so `xargs -n1 clawmind ingest` or
    // `xargs ls -la` keeps working without conditional skips. The shape
    // mirrors `pins list --paths` and `mutes list --paths`.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          items: [
            { name: 'notes', path: '/Users/me/.openclaw/workspace/notes', createdAt: 1700000000000, createdBy: 'me' },
            { name: 'work',  path: '/Users/me/work', createdAt: 1700000001000, createdBy: 'me' },
            { name: 'wiki',  path: '/Volumes/data/wiki', createdAt: 1700000002000, createdBy: 'me' },
          ],
          count: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    expect(stdout.join('')).toBe(
      '/Users/me/.openclaw/workspace/notes\n' +
      '/Users/me/work\n' +
      '/Volumes/data/wiki\n',
    );
    // No @name leaks through — --paths is the path-only contract.
    expect(stdout.join('')).not.toContain('@');
    // No arrow / timestamp / "by me" trailer.
    expect(stdout.join('')).not.toContain('->');
    expect(stdout.join('')).not.toContain('by me');
    // No ANSI styling — meant to feed the next command directly.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('--paths with zero matches yields a clean empty stream (no "no aliases" hint)', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  // -----------------------------------------------------------------
  // --since <iso-date>: keep only aliases whose createdAt is at-or-
  // after the cutoff. Mirrors `pins list --since` / `mutes list
  // --since` byte-for-byte (cutoff is INCLUSIVE: >=, composes with
  // -q as an intersection, parse failures abort with exit 1).
  // -----------------------------------------------------------------

  it('--since keeps only aliases created at-or-after the ISO cutoff', async () => {
    // Three aliases spanning a wide date range:
    //   notes:  created 2026-01-15 (old)
    //   work:   created 2026-06-15 (mid)
    //   wiki:   created 2026-06-21 (fresh)
    // Cutoff 2026-06-01 should drop notes, keep work + wiki.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'notes', path: '/n', createdAt: Date.parse('2026-01-15'), createdBy: 'me' },
          { name: 'work',  path: '/w', createdAt: Date.parse('2026-06-15'), createdBy: 'me' },
          { name: 'wiki',  path: '/wk', createdAt: Date.parse('2026-06-21'), createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-01']);
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[]; count: number };
    expect(parsed.items.map((it) => it.name)).toEqual(['work', 'wiki']);
    // Recomputed count matches the post-filter body — a downstream
    // `jq .count` consumer sees 2, not 3.
    expect(parsed.count).toBe(2);
  });

  it('--since cutoff is INCLUSIVE (an alias created exactly at the cutoff is kept)', async () => {
    // Matches `pins list --since` / `mutes list --since` byte-for-
    // byte: colloquial "since X" means X itself counts.
    const exact = Date.parse('2026-06-15T00:00:00Z');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'before', path: '/b', createdAt: exact - 1,    createdBy: 'me' },
          { name: 'exact',  path: '/e', createdAt: exact,         createdBy: 'me' },
          { name: 'after',  path: '/a', createdAt: exact + 1000,  createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-15T00:00:00Z']);
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[] };
    // exact + after kept; before dropped (createdAt < cutoff).
    expect(parsed.items.map((it) => it.name)).toEqual(['exact', 'after']);
  });

  it('--since composes with --paths (path-stream survivors carry the same byte layout as --since-less --paths)', async () => {
    // The natural cron one-liner is
    //   clawmind aliases list --paths --since "$(...)" | xargs ls -la
    // Pin that the path stream is byte-faithful to the --paths
    // contract with only the post-filter survivors.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'old',   path: '/old.md',   createdAt: Date.parse('2026-01-01'), createdBy: 'me' },
          { name: 'fresh', path: '/fresh.md', createdAt: Date.parse('2026-06-21'), createdBy: 'me' },
        ],
        count: 2,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths', '--since', '2026-06-15']);
    // Only /fresh.md survives, and the byte layout matches the
    // --paths contract (one path per line, no styling, no header).
    expect(stdout.join('')).toBe('/fresh.md\n');
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('--since with an invalid ISO date aborts cleanly with exit 1', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [], count: 0 }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('aliases list failed: --since value "banana" is not a valid ISO date');
  });

  it('--since composes with -q (substring forwards to API; --since narrows survivors client-side)', async () => {
    let listedUrl = '';
    globalThis.fetch = (async (url: string | URL) => {
      listedUrl = String(url);
      return new Response(JSON.stringify({
        items: [
          // The API only returned `work`-matching rows (q-forwarded);
          // we narrow further by --since on top.
          { name: 'work-old',   path: '/wo', createdAt: Date.parse('2026-01-01'), createdBy: 'me' },
          { name: 'work-fresh', path: '/wf', createdAt: Date.parse('2026-06-21'), createdBy: 'me' },
        ],
        count: 2,
      }), { status: 200 });
    }) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '-q', 'work', '--since', '2026-06-15']);
    expect(listedUrl).toContain('q=work');
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[] };
    expect(parsed.items.map((it) => it.name)).toEqual(['work-fresh']);
  });

  // -----------------------------------------------------------------
  // --sort <key>: order survivors of -q / --since by an operator-
  // chosen axis. `name` is alphabetical (matches API default,
  // useful for symmetry); `createdAt` is newest-first (the natural
  // "what got added recently" ordering that pairs with --since).
  // Mirrors `feedback list --sort` / `digest list --sort` precedent.
  // -----------------------------------------------------------------

  it('--sort createdAt orders survivors newest-first', async () => {
    // Three aliases with widely-spread createdAt values. The API
    // returns them in name-alphabetical order (its native sort);
    // --sort createdAt overrides to newest-first.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'aaa', path: '/a', createdAt: Date.parse('2026-01-01'), createdBy: 'me' },
          { name: 'mmm', path: '/m', createdAt: Date.parse('2026-06-21'), createdBy: 'me' },
          { name: 'zzz', path: '/z', createdAt: Date.parse('2026-03-15'), createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'createdAt']);
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[] };
    // Newest first (mmm 2026-06-21), then 2026-03-15 (zzz),
    // then oldest (aaa 2026-01-01).
    expect(parsed.items.map((it) => it.name)).toEqual(['mmm', 'zzz', 'aaa']);
  });

  it('--sort createdAt composes with --since (sort orders survivors of --since)', async () => {
    // The canonical cron use: "what got added since yesterday,
    // newest first". --since drops the old entries, --sort
    // createdAt orders the survivors newest-first.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'old',    path: '/o', createdAt: Date.parse('2026-01-01'), createdBy: 'me' },
          { name: 'fresh1', path: '/f1', createdAt: Date.parse('2026-06-20'), createdBy: 'me' },
          { name: 'fresh2', path: '/f2', createdAt: Date.parse('2026-06-21'), createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-15', '--sort', 'createdAt']);
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[] };
    // old dropped by --since; fresh2 then fresh1 (newest first).
    expect(parsed.items.map((it) => it.name)).toEqual(['fresh2', 'fresh1']);
  });

  it('--sort name orders survivors alphabetically ascending', async () => {
    // Even when the API returns rows in non-alphabetical order
    // (e.g. a future API change to insertion-order), --sort name
    // produces a deterministic alphabetical stream.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'zzz', path: '/z', createdAt: 0, createdBy: 'me' },
          { name: 'aaa', path: '/a', createdAt: 0, createdBy: 'me' },
          { name: 'mmm', path: '/m', createdAt: 0, createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'name']);
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[] };
    expect(parsed.items.map((it) => it.name)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('--sort with an unknown key aborts cleanly with exit 1', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [], count: 0 }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--sort', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('aliases list failed: --sort value must be one of: name, createdAt');
    expect(stderr.join('')).toContain('"banana"');
  });

  it('--sort createdAt with ties preserves API order as secondary sort', async () => {
    // Two aliases at the same createdAt — the secondary sort by
    // original index pins the relative order to whatever the API
    // returned, so cross-snapshot diffs stay byte-stable.
    const tiedTs = Date.parse('2026-06-21T12:00:00Z');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'tied-first',  path: '/tf', createdAt: tiedTs, createdBy: 'me' },
          { name: 'newer',       path: '/n',  createdAt: tiedTs + 1000, createdBy: 'me' },
          { name: 'tied-second', path: '/ts', createdAt: tiedTs, createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'createdAt']);
    const parsed = JSON.parse(stdout.join('')) as { items: { name: string }[] };
    // newer first (latest createdAt), then the two tied entries
    // in API order (tied-first at index 0, tied-second at index 2).
    expect(parsed.items.map((it) => it.name)).toEqual(['newer', 'tied-first', 'tied-second']);
  });

  // -----------------------------------------------------------------
  // --paths-only: family-wide canonical alias for --paths. Both flags
  // emit the byte-identical stream. Mirrors `pins list --paths-only`
  // / `mutes list --paths-only` / `stale --paths-only` / `tags paths
  // --paths-only`.
  // -----------------------------------------------------------------

  it('--paths-only emits the byte-identical stream as --paths', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'notes', path: '/Users/me/.openclaw/workspace/notes', createdAt: 1700000000000, createdBy: 'me' },
          { name: 'work',  path: '/Users/me/work', createdAt: 1700000001000, createdBy: 'me' },
          { name: 'wiki',  path: '/Volumes/data/wiki', createdAt: 1700000002000, createdBy: 'me' },
        ],
        count: 3,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths-only']);
    expect(stdout.join('')).toBe(
      '/Users/me/.openclaw/workspace/notes\n' +
      '/Users/me/work\n' +
      '/Volumes/data/wiki\n',
    );
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
    expect(stdout.join('')).not.toContain('@');
    expect(stdout.join('')).not.toContain('->');
  });

  it('--paths and --paths-only together produce the same stream (true alias)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'a', path: '/a', createdAt: 1, createdBy: 'me' },
          { name: 'b', path: '/b', createdAt: 2, createdBy: 'me' },
        ],
        count: 2,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths', '--paths-only']);
    // Same branch — passing both is harmless.
    expect(stdout.join('')).toBe('/a\n/b\n');
  });

  it('--paths-only composes with --since (filter applies BEFORE the --paths-only short-circuit)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        items: [
          { name: 'old',   path: '/old.md',   createdAt: Date.parse('2026-01-01'), createdBy: 'me' },
          { name: 'fresh', path: '/fresh.md', createdAt: Date.parse('2026-06-21'), createdBy: 'me' },
        ],
        count: 2,
      }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths-only', '--since', '2026-06-15']);
    // Same survivor as the --paths + --since test (proves
    // --paths-only is byte-faithful with --paths).
    expect(stdout.join('')).toBe('/fresh.md\n');
  });

  it('--paths-only with zero matches yields a clean empty stream (no "no aliases" hint)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [], count: 0 }), { status: 200 })) as never;
    await aliasesCommand().parseAsync(['node', 'cli', 'list', '--paths-only']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });
});
