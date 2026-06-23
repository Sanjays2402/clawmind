import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tagsCommand } from '../src/commands/tags.js';

// `tags` is a sub-command suite over /v1/tags. Tests mirror the
// pins.test.ts / mutes.test.ts / aliases.test.ts shape so the
// `--paths` pipeline contract is verified the same way across every
// list-style command (one path per line, no ANSI, no headers, no
// hints, empty stream on zero matches).
function stubFetch(payload: unknown, init: ResponseInit = { status: 200 }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })) as never;
}

describe('tags paths cli', () => {
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

  it('--paths emits one path per line with no styling and no headers', async () => {
    stubFetch({
      tag: 'work',
      paths: ['/a.md', '/b.md', '/c.md'],
      count: 3,
    });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--paths']);
    // Exact byte layout — `wc -l` and `xargs -n1` must keep working.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    // No ANSI styling — pipeline mode must be plain text.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
    // No hint banner / count summary.
    expect(stdout.join('')).not.toContain('tagged');
    expect(stdout.join('')).not.toContain('work');
  });

  it('--paths with zero matches yields a clean empty stream (no "no sources tagged" hint)', async () => {
    stubFetch({ tag: 'unused', paths: [], count: 0 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'unused', '--paths']);
    // Critically: an empty result must NOT emit the gray "no sources
    // tagged unused" hint that the default text mode prints. A
    // `clawmind tags paths unused --paths | xargs ls` consumer needs an
    // empty stream so xargs runs zero times instead of being fed a hint
    // string as its argument.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--json still works when --paths is not set (no regression)', async () => {
    stubFetch({ tag: 'work', paths: ['/a.md'], count: 1 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--json']);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.tag).toBe('work');
    expect(parsed.paths).toEqual(['/a.md']);
    expect(parsed.count).toBe(1);
  });

  it('default text mode is unaffected (still prints the "no sources tagged" hint on empty)', async () => {
    stubFetch({ tag: 'unused', paths: [], count: 0 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'unused']);
    // The hint string only fires in default text mode — --paths and
    // --json both suppress it. The hint itself goes to stdout (styled
    // gray) so we just assert the substring without ANSI escape
    // sensitivity.
    expect(stdout.join('')).toContain('no sources tagged unused');
  });

  // -----------------------------------------------------------------
  // --paths-only: alias for --paths. Brings the tags surface in line
  // with the family-wide --paths-only naming (search/forget/related/
  // stale all expose --paths-only as the canonical spelling). Either
  // flag emits exactly the same byte stream so existing scripts using
  // --paths keep working unchanged. Mirrors the stale --paths /
  // --paths-only alias relationship byte-for-byte.
  // -----------------------------------------------------------------

  it('--paths-only emits the same byte stream as --paths (canonical-spelling alias)', async () => {
    stubFetch({
      tag: 'work',
      paths: ['/a.md', '/b.md', '/c.md'],
      count: 3,
    });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--paths-only']);
    // Byte-identical to the --paths case pinned above. The two
    // flags are genuine aliases — any divergence between them
    // would catch a regression where someone "optimized" one path
    // and not the other.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('--paths-only with zero matches yields a clean empty stream (xargs/wc-friendly)', async () => {
    stubFetch({ tag: 'unused', paths: [], count: 0 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'unused', '--paths-only']);
    // Same as --paths: no "no sources tagged" hint, no header,
    // no ANSI. wc -l sees exactly 0 lines.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths and --paths-only passed TOGETHER behave identically (no precedence — they are genuine aliases)', async () => {
    // The pair of flags is the alias relationship: --paths was the
    // original spelling, --paths-only is the family-wide canonical.
    // Passing both is harmless; the effect is identical.
    stubFetch({
      tag: 'work',
      paths: ['/a.md', '/b.md'],
      count: 2,
    });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--paths', '--paths-only']);
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
  });

  it('--paths-only short-circuits --json (pipeline-friendly trumps machine-readable)', async () => {
    // Matches the precedent set by search/forget/related/stale
    // --paths-only: the path-stream contract wins so a cron script
    // can pass --json unconditionally (for ApiError handling) but
    // get a path stream when --paths-only is also set.
    stubFetch({
      tag: 'work',
      paths: ['/a.md'],
      count: 1,
    });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--json', '--paths-only']);
    // Path stream, NOT JSON.
    expect(stdout.join('')).toBe('/a.md\n');
    expect(() => JSON.parse(stdout.join(''))).toThrow();
  });

  it('exposes --paths-only on the paths command surface', () => {
    const paths = tagsCommand().commands.find((c) => c.name() === 'paths')!;
    const flags = paths.options.map((o) => o.long);
    expect(flags).toContain('--paths-only');
    // --paths still exposed (back-compat).
    expect(flags).toContain('--paths');
  });
});

describe('tags list --sort / --top', () => {
  let originalFetch: typeof globalThis.fetch;
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let lastUrl: string;

  // The /v1/tags fixture matches the documented API order: count
  // descending with alphabetical tie-breaking. Three rows so
  // --top tests can verify cap-of-2 (head) vs cap-of-1 (one) vs
  // no-cap (all three).
  const FIXTURE_ITEMS = [
    { tag: 'work', count: 7 },
    { tag: 'memory', count: 4 },
    { tag: 'archive', count: 1 },
  ];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastUrl = '';
    originalFetch = globalThis.fetch;
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    globalThis.fetch = (async (u: string) => {
      lastUrl = String(u);
      return new Response(JSON.stringify({
        items: FIXTURE_ITEMS,
        count: FIXTURE_ITEMS.length,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
  });

  it('exposes --sort and --top on the list command surface', () => {
    const list = tagsCommand().commands.find((c) => c.name() === 'list')!;
    const flags = list.options.map((o) => o.long);
    expect(flags).toContain('--sort');
    expect(flags).toContain('--top');
  });

  it('--sort count (default) keeps the API order verbatim (count descending)', async () => {
    // The API already returns count descending; --sort count is a
    // no-op pass-through. We verify by checking the JSON payload
    // matches FIXTURE_ITEMS exactly.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string; count: number }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['work', 'memory', 'archive']);
  });

  it('--sort tag re-sorts to ascending alphabetical (diff-stable for cron snapshots)', async () => {
    // The cron use is a daily snapshot where the tag set should
    // diff cleanly even when counts flutter across ingests.
    // Alphabetical order makes the diff invariant in the count
    // field — only the count column changes between snapshots.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'tag']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['archive', 'memory', 'work']);
  });

  it('--sort with an unknown key aborts cleanly (no JSON emitted, exit 1)', async () => {
    // Mirrors `stats --sort`: a typo should not silently degrade
    // to the default order — the operator deserves a crisp error
    // pointing at the supported keys.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--sort', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('tags list failed: unknown --sort key "banana"');
    expect(stderr.join('')).toContain('expected: count, tag');
    // No JSON output should have been emitted.
    expect(stdout.join('')).toBe('');
  });

  it('--top caps the list at N entries AFTER sorting', async () => {
    // --top 2 takes the first two of count-descending => work, memory.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--top', '2']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[]; count: number };
    expect(parsed.items.map((i) => i.tag)).toEqual(['work', 'memory']);
    // The count field reflects the post-cap length so a downstream
    // `jq '.count'` consumer is not lied to (matches the contract
    // every other --top in the cli already preserves).
    expect(parsed.count).toBe(2);
  });

  it('--top composes with --sort (cap is applied AFTER the alphabetical re-sort)', async () => {
    // --sort tag then --top 1 yields the alphabetically first tag.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'tag', '--top', '1']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['archive']);
  });

  it('--top composes with -q (substring filter narrows first, then --top picks head)', async () => {
    // -q forwards to the API as ?q=<substr>; --top is applied
    // client-side after the API responds. We test that the URL
    // carries the q= parameter AND the result is capped.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '-q', 'mem', '--top', '5']);
    expect(lastUrl).toContain('/v1/tags?q=mem');
    // The fixture returns FIXTURE_ITEMS regardless of q (so we can
    // verify --top still slices); --top 5 is a no-op on a 3-row
    // fixture, all three pass through.
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['work', 'memory', 'archive']);
  });

  it('--top 0 falls back to no cap (matches stats --top clamping; no surprising empty table)', async () => {
    // A typo like `--top 0` would silently yield an empty table
    // under naive slice(0, 0) semantics. The clamp keeps the full
    // list so the operator's mistake is visible (they see all the
    // rows) rather than hidden (they see nothing and assume the
    // tag map is empty).
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--top', '0']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['work', 'memory', 'archive']);
  });

  it('--top with a non-numeric value falls back to no cap', async () => {
    // parseInt('banana', 10) returns NaN; the Number.isFinite gate
    // keeps the full list rather than crashing or silently
    // emptying the output.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--top', 'banana']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['work', 'memory', 'archive']);
  });

  it('text mode honours --sort tag (tag column ordering matches alphabetical)', async () => {
    // Default text mode emits "<tag> (<count>)" per line in the
    // sorted order. We verify by checking the line order in stdout.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--sort', 'tag']);
    const lines = stdout.join('').trim().split('\n');
    // Each line starts with the tag (under styled-bold which the
    // test environment renders as plain text); we strip ANSI just
    // in case and check the first three plain-text tokens are
    // alphabetical.
    const firstTags = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').split(' ')[0]);
    expect(firstTags).toEqual(['archive', 'memory', 'work']);
  });

  // --reverse: mirrors `stale --reverse` / `search --reverse` /
  // `related --reverse` / `feedback list --reverse` / `digest list
  // --reverse` / `aliases list --reverse` / `stats --reverse` byte-
  // for-byte. The 8th command in the family-wide reverse-modifier
  // sweep AND the third command (after stats) with the default-sort
  // deviation. Adds the secondary-by-original-index sort that
  // predated the family-wide contract on this command.
  // -----------------------------------------------------------------

  it('exposes --reverse on the list command surface', () => {
    const list = tagsCommand().commands.find((c) => c.name() === 'list')!;
    const flags = list.options.map((o) => o.long);
    expect(flags).toContain('--reverse');
  });

  it('--sort count --reverse orders tags asc (rarest tags first)', async () => {
    // Default --sort count is desc (loudest tags first); --reverse
    // gives asc — the "audit underused labels" question,
    // complementary to the "which labels dominate" default.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'count', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string; count: number }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['archive', 'memory', 'work']);
    expect(parsed.items.map((i) => i.count)).toEqual([1, 4, 7]);
  });

  it('--sort tag --reverse orders tags desc alphabetical (flips the default asc)', async () => {
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'tag', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['work', 'memory', 'archive']);
  });

  it('--sort count --reverse --top 1 surfaces the rarest tag (composition pin)', async () => {
    // --top applies to the head of the post-reverse ordering. So
    // `--sort count --reverse --top 1` is "the rarest tag" — NOT
    // the most common.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'count', '--reverse', '--top', '1']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string; count: number }[] };
    expect(parsed.items.map((i) => i.tag)).toEqual(['archive']);
    expect(parsed.items[0]?.count).toBe(1);
  });

  it('--sort count ties preserve API order via secondary-by-original-index sort (cross-snapshot determinism)', async () => {
    // The family-wide contract: ties at the same primary key carry
    // a secondary sort by original-input index for byte-stable
    // snapshots. Two tags with count=5 — pin that the relative order
    // matches API order regardless of V8's Array#sort stability.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'first-tied', count: 5 },
        { tag: 'loud-loner', count: 9 },
        { tag: 'second-tied', count: 5 },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'count']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string; count: number }[] };
    // loud-loner first (count=9), then the two tied entries in API
    // order (first-tied at idx 0, second-tied at idx 2).
    expect(parsed.items.map((i) => i.tag)).toEqual(['loud-loner', 'first-tied', 'second-tied']);
  });

  it('--sort count --reverse preserves cross-snapshot determinism on ties (secondary index also reversed)', async () => {
    // Under --reverse the secondary index sort is ALSO reversed so
    // the snapshot is byte-stable in either direction.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'first-tied', count: 5 },
        { tag: 'rare', count: 1 },
        { tag: 'second-tied', count: 5 },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'count', '--reverse']);
    const parsed = JSON.parse(stdout.join('')) as { items: { tag: string; count: number }[] };
    // Ascending: rare (1) first, then the two tied entries in
    // REVERSED original-index order (second-tied at idx 2 before
    // first-tied at idx 0).
    expect(parsed.items.map((i) => i.tag)).toEqual(['rare', 'second-tied', 'first-tied']);
  });

  it('--sort count determinism: two consecutive runs over identical-ties input produce byte-identical output', async () => {
    // End-to-end pin of the cron snapshot diff property — under
    // identical input the output is byte-stable across runs.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'alpha', count: 3 },
        { tag: 'bravo', count: 3 },
        { tag: 'charlie', count: 3 },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'count']);
    const tick1 = stdout.join('');
    stdout.length = 0;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'count']);
    const tick2 = stdout.join('');
    expect(tick1).toBe(tick2);
    // And the tied trio's order matches API order.
    const out = JSON.parse(tick1) as { items: { tag: string }[] };
    expect(out.items.map((i) => i.tag)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  // -----------------------------------------------------------------
  // tags list --json --slim: drop the per-entry `count` field (the
  // per-tag source count) and emit a `{count, tags}` shape. The
  // natural cron use is a dashboard panel polling "is the tag set
  // stable" once a minute. Mirrors `aliases list --json --slim` but
  // with the tag-name axis (the array is named `tags` not `names`).
  // -----------------------------------------------------------------

  it('exposes --slim on the tags list subcommand surface', () => {
    const list = tagsCommand().commands.find((c) => c.name() === 'list');
    expect(list).toBeDefined();
    const flags = list!.options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--json --slim emits {count, tags} and drops the per-entry count', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'alpha', count: 5 },
        { tag: 'bravo', count: 3 },
        { tag: 'charlie', count: 1 },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    // Top-level: exactly count + tags.
    expect(Object.keys(parsed).sort()).toEqual(['count', 'tags']);
    expect(parsed.count).toBe(3);
    expect(parsed.tags).toEqual(['alpha', 'bravo', 'charlie']);
    // No per-entry items[] or per-tag count leaks.
    const raw = stdout.join('');
    expect(raw).not.toContain('items');
    // We expect "count" once (the top-level), no per-tag count
    // sub-objects.
    expect((raw.match(/"count"/g) ?? []).length).toBe(1);
  });

  it('--json --slim emits tags in WHICHEVER ORDER --sort + --reverse produced', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'alpha', count: 1 },
        { tag: 'bravo', count: 2 },
        { tag: 'charlie', count: 3 },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    // --sort tag is asc alphabetical; --reverse gives desc.
    await tagsCommand().parseAsync([
      'node', 'cli', 'list', '--json', '--slim', '--sort', 'tag', '--reverse',
    ]);
    const parsed = JSON.parse(stdout.join('')) as { count: number; tags: string[] };
    expect(parsed.tags).toEqual(['charlie', 'bravo', 'alpha']);
    expect(parsed.count).toBe(3);
  });

  it('--json --slim composes with --top: slim count + tags describe the post-top survivors', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'alpha', count: 5 },
        { tag: 'bravo', count: 3 },
        { tag: 'charlie', count: 1 },
      ],
      count: 3,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    // --sort count desc (default), --top 2 keeps loudest two.
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--slim', '--top', '2']);
    const parsed = JSON.parse(stdout.join('')) as { count: number; tags: string[] };
    expect(parsed.tags).toEqual(['alpha', 'bravo']);
    expect(parsed.count).toBe(2);
  });

  it('--json --slim emits single-line JSON (NDJSON-friendly snapshot stream)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { tag: 'alpha', count: 1 },
        { tag: 'bravo', count: 1 },
      ],
      count: 2,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--slim']);
    const out = stdout.join('');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1).includes('\n')).toBe(false);
    expect(out).not.toMatch(/\n  /);
  });

  it('--slim WITHOUT --json is silently ignored (text mode unchanged)', async () => {
    const payload = {
      items: [{ tag: 'alpha', count: 5 }],
      count: 1,
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list']);
    const baseline = stdout.join('');
    stdout.length = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--slim']);
    expect(stdout.join('')).toBe(baseline);
  });

  it('--json --slim with zero matches yields {count: 0, tags: []}', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [], count: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await tagsCommand().parseAsync(['node', 'cli', 'list', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as { count: number; tags: string[] };
    expect(parsed.count).toBe(0);
    expect(parsed.tags).toEqual([]);
  });
});
