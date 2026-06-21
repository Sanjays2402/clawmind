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
});
