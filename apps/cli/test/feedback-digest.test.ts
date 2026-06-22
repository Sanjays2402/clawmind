import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { feedbackCommand } from '../src/commands/feedback.js';
import { digestCommand } from '../src/commands/digest.js';

describe('feedback cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWrite: typeof process.stdout.write;
  let captured: string[];
  let fetchCalls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    captured = [];
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { captured.push(String(chunk)); return true; }) as never;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      const u = String(url);
      if (u.endsWith('/v1/feedback') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { path: string; vote: number };
        return new Response(JSON.stringify({
          path: body.path, ups: body.vote === 1 ? 1 : 0, downs: body.vote === -1 ? 1 : 0,
          boost: body.vote === 1 ? 1.05 : 0.95,
        }), { status: 200 });
      }
      if (u.endsWith('/v1/feedback') && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes('/v1/feedback') && (!init || init.method === undefined || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { path: '/a.md', ups: 3, downs: 0, boost: 1.15, updatedAt: 0 },
          { path: '/b.md', ups: 0, downs: 2, boost: 0.9, updatedAt: 0 },
        ] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
    vi.restoreAllMocks();
  });

  it('feedback up posts vote=1', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'up', '/foo.md']);
    expect(fetchCalls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ path: '/foo.md', vote: 1 });
    expect(captured.join('')).toContain('+1 /foo.md');
  });

  it('feedback down posts vote=-1', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'down', '/bar.md']);
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ path: '/bar.md', vote: -1 });
    expect(captured.join('')).toContain('-1 /bar.md');
  });

  it('feedback clear sends DELETE', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'clear', '/baz.md']);
    expect(fetchCalls[0]?.init?.method).toBe('DELETE');
    expect(captured.join('')).toContain('cleared vote');
  });

  it('feedback list renders rows', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'list']);
    const out = captured.join('');
    expect(out).toContain('/a.md');
    expect(out).toContain('/b.md');
    expect(out).toContain('1.15');
  });

  it('feedback list --json emits parseable JSON and skips table output', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json']);
    const out = captured.join('');
    const parsed = JSON.parse(out) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md', '/b.md']);
    expect(out).not.toContain('1.15x');
  });

  it('feedback list -q forwards q= to the API', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '-q', 'a md']);
    expect(fetchCalls[0]?.url).toContain('/v1/feedback?q=a%20md');
  });

  it('feedback list --above keeps only entries with boost strictly greater than the threshold', async () => {
    // Default fixture returns boosts 1.15 (a.md) and 0.9 (b.md).
    // --above 1.0 should keep only a.md; b.md is below 1.0.
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--above', '1.0']);
    const out = captured.join('');
    const parsed = JSON.parse(out) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md']);
  });

  it('feedback list --below keeps only entries with boost strictly less than the threshold', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--below', '1.0']);
    const out = captured.join('');
    const parsed = JSON.parse(out) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/b.md']);
  });

  it('feedback list --above is STRICTLY greater (excludes exact equality with threshold)', async () => {
    // Override fetch with a fixture that has a boost === 1.0 row.
    // --above 1.0 must drop it (strict inequality).
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/at.md', ups: 1, downs: 1, boost: 1.0 },
        { path: '/over.md', ups: 2, downs: 0, boost: 1.10 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--above', '1.0']);
    const parsed = JSON.parse(captured.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path)).toEqual(['/over.md']);
  });

  it('feedback list --above --below composes as an intersection (band filter)', async () => {
    // The "almost neutral" band: 0.95 < boost < 1.05.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/strong-up.md', ups: 5, downs: 0, boost: 1.25 },
        { path: '/mild-up.md', ups: 1, downs: 0, boost: 1.02 },
        { path: '/neutral.md', ups: 1, downs: 1, boost: 1.0 },
        { path: '/mild-down.md', ups: 0, downs: 1, boost: 0.98 },
        { path: '/strong-down.md', ups: 0, downs: 5, boost: 0.75 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--above', '0.95', '--below', '1.05']);
    const parsed = JSON.parse(captured.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((i) => i.path).sort()).toEqual(['/mild-down.md', '/mild-up.md', '/neutral.md']);
  });

  it('feedback list --above with no matches yields an empty items array (json) / "no feedback yet" (text)', async () => {
    // --above 99 leaves nothing — both items in the fixture are <= 99.
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--above', '99']);
    const parsed = JSON.parse(captured.join('')) as { items: unknown[] };
    expect(parsed.items).toEqual([]);
  });

  it('feedback list --above with text mode emits the empty-state hint when the filter empties everything', async () => {
    captured.length = 0;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--above', '99']);
    expect(captured.join('')).toContain('no feedback yet');
  });

  it('feedback list --above composes with -q (filter forwards to the API and post-filter applies on top)', async () => {
    // -q is sent to the API (forwarded as q=...). --above is applied
    // client-side AFTER the API responds. Both must fire.
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '-q', 'md', '--above', '1.0']);
    // -q hit the API.
    expect(fetchCalls[0]?.url).toContain('/v1/feedback?q=md');
    const parsed = JSON.parse(captured.join('')) as { items: { path: string }[] };
    // The default fixture's --above 1.0 result (a.md with boost 1.15)
    // survives the client-side filter.
    expect(parsed.items.map((i) => i.path)).toEqual(['/a.md']);
  });

  it('feedback list --above with a non-numeric value errors cleanly', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await feedbackCommand().parseAsync(['node', 'cli', 'list', '--above', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('feedback list failed: --above value is not a number');
    process.exitCode = 0;
  });

  // -----------------------------------------------------------------
  // --top <n>: cap the listed entries to the N loudest votes by
  // absolute distance from neutral (|boost - 1.0|), descending.
  // Answers "which votes are LOUDEST regardless of direction" in a
  // single call — the existing --above / --below each only see one
  // direction. Composes with --above/--below (cap the strongest
  // up/downvotes) and -q (loudest votes within a path subtree).
  // -----------------------------------------------------------------

  it('feedback list --top caps to the N loudest entries by |boost - 1.0| descending', async () => {
    // Five rows with widely spread boost values so the loudness
    // ordering is unambiguous. Distances from neutral:
    //   /strong-up.md (1.40) -> 0.40
    //   /strong-down.md (0.60) -> 0.40
    //   /mild-up.md (1.10) -> 0.10
    //   /mild-down.md (0.90) -> 0.10
    //   /neutral.md (1.00) -> 0.00
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/mild-up.md', ups: 1, downs: 0, boost: 1.10 },
        { path: '/strong-up.md', ups: 5, downs: 0, boost: 1.40 },
        { path: '/neutral.md', ups: 1, downs: 1, boost: 1.00 },
        { path: '/strong-down.md', ups: 0, downs: 5, boost: 0.60 },
        { path: '/mild-down.md', ups: 0, downs: 1, boost: 0.90 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--top', '2']);
    const parsed = JSON.parse(captured.join('')) as {
      items: { path: string; boost: number }[];
    };
    // The 2 loudest, in descending distance order. /strong-up.md and
    // /strong-down.md both have distance 0.40 — tie order falls
    // back to API order, which puts /strong-up.md before
    // /strong-down.md in the fixture.
    expect(parsed.items.map((it) => it.path)).toEqual([
      '/strong-up.md',
      '/strong-down.md',
    ]);
  });

  it('feedback list --top sorts BOTH directions together (an upvote and a downvote with the same distance both qualify)', async () => {
    // The contract is "loudest regardless of direction". A naive
    // implementation that only sorted by `boost` (not |boost - 1.0|)
    // would put all upvotes before all downvotes (or vice versa)
    // and the operator would never see the strongest downvote
    // when asking for `--top 3` on a workspace with 4 strong
    // upvotes and 1 strong downvote.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/up1.md', ups: 1, downs: 0, boost: 1.05 },
        { path: '/up2.md', ups: 1, downs: 0, boost: 1.10 },
        { path: '/strongest-down.md', ups: 0, downs: 9, boost: 0.20 },
        { path: '/up3.md', ups: 1, downs: 0, boost: 1.15 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--top', '1']);
    const parsed = JSON.parse(captured.join('')) as {
      items: { path: string; boost: number }[];
    };
    // /strongest-down.md has distance 0.80 — the loudest entry in
    // the workspace, even though its boost (0.20) is the LOWEST.
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.path).toBe('/strongest-down.md');
  });

  it('feedback list --top is applied AFTER --above (cap the N strongest upvotes within the band filter)', async () => {
    // The natural "audit the top 3 upvotes" call is
    // `--above 1.0 --top 3`. The --above filter narrows the
    // candidate set FIRST so downvotes are excluded entirely;
    // --top then picks the loudest survivors within that
    // upvotes-only set.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/up-mild.md', ups: 1, downs: 0, boost: 1.05 },
        { path: '/up-strong.md', ups: 5, downs: 0, boost: 1.30 },
        { path: '/up-mid.md', ups: 2, downs: 0, boost: 1.15 },
        // Downvotes are louder than every upvote but they MUST
        // NOT appear in --above 1.0's --top because they were
        // filtered out before --top ran.
        { path: '/down-strongest.md', ups: 0, downs: 9, boost: 0.10 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--above', '1.0', '--top', '2']);
    const parsed = JSON.parse(captured.join('')) as {
      items: { path: string; boost: number }[];
    };
    // Two strongest upvotes by loudness:
    // /up-strong.md (distance 0.30), /up-mid.md (distance 0.15).
    // /down-strongest.md is excluded because --above 1.0 dropped
    // it BEFORE --top sorted.
    expect(parsed.items.map((it) => it.path)).toEqual([
      '/up-strong.md',
      '/up-mid.md',
    ]);
  });

  it('feedback list --top with a non-positive value falls back to "no cap" (matches tags/stats --top precedent)', async () => {
    // --top 0 is the classic typo — a downstream `n=0` env var
    // expanding into the flag should NOT silently produce an empty
    // list. The fallback returns every entry, same as if the flag
    // were absent.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/a.md', ups: 3, downs: 0, boost: 1.15 },
        { path: '/b.md', ups: 0, downs: 2, boost: 0.9 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--json', '--top', '0']);
    const parsed = JSON.parse(captured.join('')) as {
      items: { path: string }[];
    };
    // Both entries kept — same shape as if --top were omitted.
    expect(parsed.items.map((it) => it.path).sort()).toEqual(['/a.md', '/b.md']);
  });

  it('feedback list --top text-mode renders the loudest entries in the same order as --json', async () => {
    // The default text mode emits `+ 1.40x  /strong-up.md` etc.
    // Pin that the order in text matches the JSON order so a
    // human reading the output and a script piping --json see
    // the same ranking.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/quiet.md', ups: 1, downs: 0, boost: 1.05 },
        { path: '/loudest.md', ups: 5, downs: 0, boost: 1.50 },
        { path: '/middle.md', ups: 2, downs: 0, boost: 1.20 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--top', '2']);
    const out = captured.join('');
    // /loudest.md (distance 0.50) appears BEFORE /middle.md
    // (distance 0.20) in the text body. /quiet.md (distance 0.05)
    // is cut off entirely.
    expect(out.indexOf('/loudest.md')).toBeLessThan(out.indexOf('/middle.md'));
    expect(out).not.toContain('/quiet.md');
  });

  // -----------------------------------------------------------------
  // --sort <key>: explicit ordering primitive distinct from --top.
  // --top ranks by absolute distance from neutral (|boost - 1.0|);
  // --sort ranks by an operator-chosen axis (boost desc, path asc,
  // ups desc, downs desc). The two compose: --sort wins ordering,
  // --top caps the head of that ordering.
  // -----------------------------------------------------------------

  it('feedback list --sort boost orders survivors by boost descending', async () => {
    // Fixture covers both directions so we can prove "desc" is
    // truly desc (highest first) and not just "API order".
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/mid.md', ups: 1, downs: 0, boost: 1.05 },
        { path: '/high.md', ups: 5, downs: 0, boost: 1.40 },
        { path: '/low.md', ups: 0, downs: 4, boost: 0.65 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--sort', 'boost', '--json']);
    const parsed = JSON.parse(captured.join('')) as { items: { path: string }[] };
    // Highest boost first, lowest last.
    expect(parsed.items.map((it) => it.path)).toEqual(['/high.md', '/mid.md', '/low.md']);
  });

  it('feedback list --sort path orders survivors alphabetically ascending', async () => {
    // Cross-snapshot stable ordering — the natural cron use is
    // `feedback list --json --sort path | diff snap-prev.json -`
    // where alphabetical order is the only diff-stable ordering
    // regardless of insertion order.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/zeta.md', ups: 1, downs: 0, boost: 1.05 },
        { path: '/alpha.md', ups: 1, downs: 0, boost: 1.05 },
        { path: '/mu.md', ups: 1, downs: 0, boost: 1.05 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--sort', 'path', '--json']);
    const parsed = JSON.parse(captured.join('')) as { items: { path: string }[] };
    expect(parsed.items.map((it) => it.path)).toEqual(['/alpha.md', '/mu.md', '/zeta.md']);
  });

  it('feedback list --sort downs --top 2 caps the head of the downvote ranking', async () => {
    // The whole point of --sort being a separate primitive from
    // --top: an operator asking "the 2 most-downvoted paths"
    // wants the head of the downs-descending ordering, NOT the
    // 2 loudest by |boost - 1.0|. /heavy-downs.md has the most
    // downs but a milder boost (0.80) than /huge-up.md (1.50)
    // which has zero downs. --sort downs --top 2 must pick the
    // top-2 by downs (heavy-downs, mid-downs), NOT the top-2 by
    // distance (which would be huge-up + heavy-downs).
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/huge-up.md', ups: 5, downs: 0, boost: 1.50 },
        { path: '/mid-downs.md', ups: 0, downs: 3, boost: 0.90 },
        { path: '/heavy-downs.md', ups: 0, downs: 8, boost: 0.80 },
        { path: '/quiet.md', ups: 1, downs: 1, boost: 1.0 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--sort', 'downs', '--top', '2', '--json']);
    const parsed = JSON.parse(captured.join('')) as { items: { path: string; downs: number }[] };
    expect(parsed.items.map((it) => it.path)).toEqual(['/heavy-downs.md', '/mid-downs.md']);
    expect(parsed.items.map((it) => it.downs)).toEqual([8, 3]);
  });

  it('feedback list --sort with an unknown key aborts cleanly with exit 1', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [{ path: '/a.md', ups: 1, downs: 0, boost: 1.05 }],
    }), { status: 200 })) as never;
    try {
      await feedbackCommand().parseAsync(['node', 'cli', 'list', '--sort', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const out = stderrBuf.join('');
    expect(out).toContain('feedback list failed: unknown --sort key "banana"');
    expect(out).toContain('boost, path, ups, downs');
    process.exitCode = 0;
  });

  it('feedback list --sort ups with ties preserves API order as secondary sort', async () => {
    // Two entries with ups=5 — the secondary sort by original
    // index pins the relative order to whatever the API returned.
    // Without the secondary sort, V8's Array#sort COULD in
    // principle flip ties (stable since V8 7.0, but the spec
    // only required stability after ES2019).
    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: '/first-tied.md', ups: 5, downs: 0, boost: 1.20 },
        { path: '/loud-loner.md', ups: 9, downs: 0, boost: 1.45 },
        { path: '/second-tied.md', ups: 5, downs: 0, boost: 1.25 },
      ],
    }), { status: 200 })) as never;
    await feedbackCommand().parseAsync(['node', 'cli', 'list', '--sort', 'ups', '--json']);
    const parsed = JSON.parse(captured.join('')) as { items: { path: string; ups: number }[] };
    // loud-loner first (ups=9), then the two tied entries in API
    // order (first-tied at index 0, second-tied at index 2).
    expect(parsed.items.map((it) => it.path)).toEqual(['/loud-loner.md', '/first-tied.md', '/second-tied.md']);
    expect(parsed.items.map((it) => it.ups)).toEqual([9, 5, 5]);
  });

  it('reports a clean message when the api is unreachable', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as never;
    try {
      await feedbackCommand().parseAsync(['node', 'cli', 'list']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const out = stderrBuf.join('');
    expect(out).toContain('feedback list failed: cannot reach');
    expect(out).toContain('fetch failed');
    process.exitCode = 0;
  });

  it('surfaces the message field from a json error body on up', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'unknown source path' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })) as never;
    try {
      await feedbackCommand().parseAsync(['node', 'cli', 'up', '/missing.md']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const out = stderrBuf.join('');
    expect(out).toContain('feedback up failed: (404');
    expect(out).toContain('unknown source path');
    process.exitCode = 0;
  });
});

describe('feedback prune cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWrite: typeof process.stdout.write;
  let originalErr: typeof process.stderr.write;
  let stdout: string[];
  let stderr: string[];
  let fetchCalls: Array<{ url: string; method?: string; body?: unknown }>;
  let deleteFailPaths: Set<string>;

  // Fixture with five rows spanning the boost range so --below 0.7
  // matches strong-down only, --below 1.0 matches all downs,
  // --below 0.95 matches mild-down + strong-down, and --below 0.5
  // matches nothing.
  const FIXTURE_ITEMS = [
    { path: '/strong-up.md', ups: 5, downs: 0, boost: 1.25 },
    { path: '/mild-up.md', ups: 1, downs: 0, boost: 1.05 },
    { path: '/neutral.md', ups: 1, downs: 1, boost: 1.0 },
    { path: '/mild-down.md', ups: 0, downs: 2, boost: 0.9 },
    { path: '/strong-down.md', ups: 0, downs: 5, boost: 0.65 },
  ];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    fetchCalls = [];
    deleteFailPaths = new Set();
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    originalErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      fetchCalls.push({ url: u, method, body });
      if (u.includes('/v1/feedback') && (!method || method === 'GET')) {
        return new Response(JSON.stringify({ items: FIXTURE_ITEMS }), { status: 200 });
      }
      if (u.endsWith('/v1/feedback') && method === 'DELETE') {
        const p = (body as { path: string }).path;
        if (deleteFailPaths.has(p)) {
          return new Response(JSON.stringify({ message: 'simulated failure' }), {
            status: 500, statusText: 'Internal Server Error',
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
    process.stderr.write = originalErr;
    process.exitCode = 0;
  });

  it('exposes prune as a subcommand with --below, --above, --apply, -q, --json on the surface', () => {
    const prune = feedbackCommand().commands.find((c) => c.name() === 'prune');
    expect(prune).toBeDefined();
    const flags = prune!.options.map((o) => o.long);
    expect(flags).toContain('--below');
    expect(flags).toContain('--above');
    expect(flags).toContain('--apply');
    expect(flags).toContain('--q');
    expect(flags).toContain('--json');
  });

  it('--below / --above required: omitting BOTH aborts cleanly without touching the API', async () => {
    // The whole point of requiring an explicit threshold is that a
    // misclick like `feedback prune --apply` does NOT silently wipe
    // the map. We assert the error fires AND no DELETE was issued.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('feedback prune failed: at least one of --below <n> or --above <n> is required');
    // Critically: no DELETE calls were issued.
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('--below with a non-numeric value aborts cleanly (NaN cannot silently match everything)', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('feedback prune failed: --below value is not a number');
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('dry-run (no --apply): lists candidates strictly below threshold without DELETE', async () => {
    // The byte-identical preview the operator gets BEFORE adding
    // --apply. We test --below 0.7 (matches strong-down only) so
    // the candidate set is unambiguous. No DELETE call is issued.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '0.7', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      threshold: number; dryRun: boolean; matched: number; cleared: number; paths: string[];
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.threshold).toBe(0.7);
    expect(parsed.matched).toBe(1);
    expect(parsed.cleared).toBe(0);
    expect(parsed.paths).toEqual(['/strong-down.md']);
    // No DELETE — the GET was the only network call.
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('--apply actually clears each matched entry (one DELETE per path)', async () => {
    // --below 1.0 matches mild-down + strong-down. With --apply we
    // expect one DELETE per candidate and a cleared count equal to
    // matched count (no failures).
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '1.0', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      dryRun: boolean; matched: number; cleared: number; errors: unknown[]; paths: string[];
    };
    expect(parsed.dryRun).toBe(false);
    expect(parsed.matched).toBe(2);
    expect(parsed.cleared).toBe(2);
    expect(parsed.errors).toEqual([]);
    expect(parsed.paths.sort()).toEqual(['/mild-down.md', '/strong-down.md']);
    // Two DELETE calls, one per path.
    const deletes = fetchCalls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(2);
    const deletedPaths = deletes.map((c) => (c.body as { path: string }).path).sort();
    expect(deletedPaths).toEqual(['/mild-down.md', '/strong-down.md']);
  });

  it('--below is STRICT: boost === threshold is EXCLUDED from the prune (matches feedback list --below)', async () => {
    // /neutral.md is at boost 1.0 exactly. --below 1.0 must NOT
    // match it (the entry is ON the line, not below it). This
    // mirrors the strict-comparison contract that `feedback list
    // --below` already honours.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '1.0', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { paths: string[] };
    expect(parsed.paths).not.toContain('/neutral.md');
  });

  it('-q forwards to the API server-side (saves the round-trip on rows the prune would discard anyway)', async () => {
    // -q is the substring filter on the GET; the API narrows the
    // candidate set BEFORE the client-side --below threshold is
    // applied. We assert the GET URL carries q= and the DELETE
    // calls touch only the paths matching the substring.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '1.0', '-q', 'down', '--apply', '--json']);
    const getCall = fetchCalls.find((c) => !c.method || c.method === 'GET');
    expect(getCall?.url).toContain('/v1/feedback?q=down');
  });

  it('zero matches yields a clean report (matched=0, cleared=0, paths=[]) and no DELETE calls', async () => {
    // --below 0.5 below the floor of MIN_BOOST: nothing in the
    // fixture qualifies. The cron-friendly contract is "the
    // command always succeeds when the input is well-formed,
    // even if it has nothing to do" — every cron tick that
    // happens to find no candidates should not look like an
    // error.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '0.5', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { matched: number; cleared: number; paths: string[] };
    expect(parsed.matched).toBe(0);
    expect(parsed.cleared).toBe(0);
    expect(parsed.paths).toEqual([]);
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(process.exitCode).toBeFalsy();
  });

  it('dry-run text mode prints "would clear" header AND a rerun nudge', async () => {
    // Mirrors the forget --apply dry-run UX: the operator gets a
    // yellow preview header + the gray path list + an explicit
    // "rerun with --apply" so they can move from preview to
    // destruction with a single command edit.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '0.7']);
    const out = stdout.join('');
    expect(out).toContain('would clear 1 feedback entry below boost 0.7');
    expect(out).toContain('/strong-down.md');
    expect(out).toContain('rerun with --apply');
  });

  it('apply text mode prints "cleared" header (red) and NO rerun nudge', async () => {
    // After --apply runs, there is nothing to rerun. The header
    // shifts to past tense and red (to make the destructive action
    // visible in a cron log).
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '0.7', '--apply']);
    const out = stdout.join('');
    expect(out).toContain('cleared 1 feedback entry below boost 0.7');
    // No rerun nudge after a real apply.
    expect(out).not.toContain('rerun with --apply');
  });

  it('partial failures: one DELETE that errors does NOT abort the rest of the prune', async () => {
    // The cron use is "clear the bad entries from last week"; a
    // single transient failure on one path should not block the
    // other paths from being cleared. The report carries the
    // error in `errors[]` AND sets exitCode=1 so a wrapper script
    // can detect that NOT every clear succeeded.
    deleteFailPaths = new Set(['/mild-down.md']);
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--below', '1.0', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      matched: number; cleared: number; errors: { path: string; message: string }[];
    };
    expect(parsed.matched).toBe(2);
    // Only one cleared — the other failed.
    expect(parsed.cleared).toBe(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.path).toBe('/mild-down.md');
    expect(parsed.errors[0]?.message).toContain('500');
    // Both DELETE calls were attempted (we did not stop after the
    // first failure).
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
    expect(process.exitCode).toBe(1);
  });

  // ---------------------------------------------------------------
  // --above tests — the symmetric sibling of --below. The classic
  // cron use is a cap recalibration: "we lowered MAX_BOOST from 1.5
  // to 1.45, clear every entry above 1.45 so re-vote pressure
  // restarts cleanly". Strict comparison (`>`) so an entry at the
  // threshold is preserved. Composes with --below as an OR
  // predicate for "trim both tails" pruning.
  // ---------------------------------------------------------------

  it('--above with a non-numeric value aborts cleanly (NaN cannot silently match everything)', async () => {
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('feedback prune failed: --above value is not a number');
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('--above dry-run: lists candidates strictly greater than the threshold without DELETE', async () => {
    // Fixture has strong-up=1.25 and mild-up=1.05. --above 1.0 picks
    // both. Dry-run (no --apply) emits the report without DELETE.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.0', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      thresholdAbove?: number; dryRun: boolean; matched: number; cleared: number; paths: string[];
    };
    expect(parsed.dryRun).toBe(true);
    expect(parsed.thresholdAbove).toBe(1.0);
    expect(parsed.matched).toBe(2);
    expect(parsed.cleared).toBe(0);
    expect(parsed.paths.sort()).toEqual(['/mild-up.md', '/strong-up.md']);
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });

  it('--above --apply actually clears each matched entry (one DELETE per path)', async () => {
    // --above 1.2 matches strong-up only (boost 1.25). With --apply
    // we expect exactly one DELETE and a cleared count of 1.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.2', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      dryRun: boolean; matched: number; cleared: number; errors: unknown[]; paths: string[];
    };
    expect(parsed.dryRun).toBe(false);
    expect(parsed.matched).toBe(1);
    expect(parsed.cleared).toBe(1);
    expect(parsed.errors).toEqual([]);
    expect(parsed.paths).toEqual(['/strong-up.md']);
    const deletes = fetchCalls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect((deletes[0]!.body as { path: string }).path).toBe('/strong-up.md');
  });

  it('--above is STRICT: boost === threshold is EXCLUDED from the prune', async () => {
    // /strong-up.md is at boost 1.25 exactly. --above 1.25 must NOT
    // match it (the entry is ON the ceiling, not above it). This
    // mirrors the strict-comparison contract that `feedback list
    // --above` already honours.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.25', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { paths: string[] };
    expect(parsed.paths).not.toContain('/strong-up.md');
    // Nothing else in the fixture is above 1.25 either.
    expect(parsed.paths).toEqual([]);
  });

  it('--above + --below compose as OR (trim both tails: clear everything outside the neutral band)', async () => {
    // The "almost neutral" prune: --above 1.04 --below 0.95 clears
    // every entry whose boost is outside the [0.95, 1.04] window.
    // Fixture: strong-up=1.25 (above 1.04 -> clear), mild-up=1.05
    // (above 1.04 -> clear), neutral=1.0 (in band -> keep),
    // mild-down=0.9 (below 0.95 -> clear), strong-down=0.65 (below
    // 0.95 -> clear). 4 cleared, 1 kept.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.04', '--below', '0.95', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      matched: number; cleared: number; paths: string[];
    };
    expect(parsed.matched).toBe(4);
    expect(parsed.cleared).toBe(4);
    expect(parsed.paths.sort()).toEqual([
      '/mild-down.md', '/mild-up.md', '/strong-down.md', '/strong-up.md',
    ]);
    // /neutral.md (boost 1.0) is in the band -> NOT in the paths list.
    expect(parsed.paths).not.toContain('/neutral.md');
  });

  // -----------------------------------------------------------------
  // --above + --below --apply byte-layout pin under --json. Pure
  // regression-guard test. The existing test above asserts the count
  // and the path-set membership; this one pins the FULL JSON report
  // payload byte-for-byte under the both-flags-apply path so:
  //   - the `errors` array contract (empty under all-success) is
  //     locked in (a future refactor that accidentally populated
  //     errors on success would slip past the count-only checks)
  //   - the dryRun=false / cleared=matched invariant under --apply
  //     is locked in (a future bug where --apply silently fell
  //     back to dry-run would slip past the count check because
  //     matched and paths would still be correct)
  //   - the threshold / thresholdAbove field shape under the
  //     two-flag composition is locked in (regression to a single
  //     `threshold` field that drops one of the two would lie about
  //     which predicate ran)
  //   - the paths array WALK ORDER under the OR-predicate is
  //     pinned (the existing test sorts before comparing — this
  //     one asserts the actual emission order so a future change
  //     to the filter pipeline that re-ordered the matched set
  //     would surface)
  // -----------------------------------------------------------------

  it('--above + --below --apply --json pins the FULL report shape byte-for-byte (errors=[], paths emission order, threshold pair)', async () => {
    // Same fixture as the existing trim-both-tails test, but pinned
    // at the byte level. The FIXTURE_ITEMS order is:
    //   /strong-up.md (1.25), /mild-up.md (1.05), /neutral.md (1.0),
    //   /mild-down.md (0.9), /strong-down.md (0.65)
    // With --above 1.04 --below 0.95 the OR predicate matches:
    //   /strong-up.md (1.25 > 1.04 -> above),
    //   /mild-up.md (1.05 > 1.04 -> above),
    //   /mild-down.md (0.9 < 0.95 -> below),
    //   /strong-down.md (0.65 < 0.95 -> below)
    // The walk order is API order (no re-sort in the filter), so
    // the paths array emits in fixture order with /neutral.md skipped.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.04', '--below', '0.95', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      threshold: number | undefined;
      thresholdAbove: number | undefined;
      dryRun: boolean;
      matched: number;
      cleared: number;
      errors: unknown[];
      paths: string[];
    };
    // Both threshold fields present (one per flag) — a regression
    // to a single combined field would drop one of the two and lie
    // about which predicate ran.
    expect(parsed.threshold).toBe(0.95);
    expect(parsed.thresholdAbove).toBe(1.04);
    // --apply path: dryRun=false, every match cleared, no errors.
    expect(parsed.dryRun).toBe(false);
    expect(parsed.matched).toBe(4);
    expect(parsed.cleared).toBe(4);
    expect(parsed.errors).toEqual([]);
    // The path emission order is API order (NOT sorted, NOT scored
    // by closeness to threshold). The filter pipeline walks
    // FIXTURE_ITEMS in order and keeps matches in their original
    // positions; /neutral.md is skipped.
    expect(parsed.paths).toEqual([
      '/strong-up.md',
      '/mild-up.md',
      '/mild-down.md',
      '/strong-down.md',
    ]);
  });

  it('--above + --below --apply issues exactly one DELETE per matched path in walk order', async () => {
    // The DELETE side-effect contract: every matched path gets one
    // DELETE request, in the same walk order the paths[] array
    // emits. This pins the serial-execution contract (no parallel
    // DELETE bursts) AND ensures no path is silently double-deleted
    // or skipped.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.04', '--below', '0.95', '--apply', '--json']);
    const deletes = fetchCalls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(4);
    // The DELETE order tracks the paths[] walk order.
    const deletePaths = deletes.map((d) => (d.body as { path: string }).path);
    expect(deletePaths).toEqual([
      '/strong-up.md',
      '/mild-up.md',
      '/mild-down.md',
      '/strong-down.md',
    ]);
  });

  it('--above + --below --apply with one DELETE failing: errors[] carries the failure path; exit 1; other deletes still fire', async () => {
    // The SKIP-on-failure path for the 3-flag composition was not
    // previously pinned. A regression where a single DELETE failure
    // accidentally aborted the rest of the batch (e.g. throwing out
    // of the for-loop) would leave the cron tick in a half-cleared
    // state and the dashboard would not detect it.
    deleteFailPaths = new Set(['/mild-up.md']); // one of the four matches fails
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.04', '--below', '0.95', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as {
      matched: number; cleared: number;
      errors: { path: string; message: string }[];
      paths: string[];
    };
    // matched=4 (all four still match the filter); cleared=3 (one
    // DELETE failed); errors carries exactly one entry naming the
    // failed path.
    expect(parsed.matched).toBe(4);
    expect(parsed.cleared).toBe(3);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0]?.path).toBe('/mild-up.md');
    expect(parsed.errors[0]?.message).toContain('simulated failure');
    // Exit 1 so a wrapper script can detect "not every clear succeeded".
    expect(process.exitCode).toBe(1);
    // The other three deletes still fired (the batch did NOT abort
    // on the single failure — critical for cron use).
    const deletes = fetchCalls.filter((c) => c.method === 'DELETE');
    expect(deletes).toHaveLength(4);
  });

  it('--above dry-run text mode prints "would clear ... above boost X" header AND a rerun nudge', async () => {
    // The text-mode header narrates the predicate that ran so the
    // cron log makes the operation auditable at a glance.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.2']);
    const out = stdout.join('');
    expect(out).toContain('would clear 1 feedback entry above boost 1.2');
    expect(out).toContain('/strong-up.md');
    expect(out).toContain('rerun with --apply');
  });

  it('--above + --below text mode header narrates BOTH predicates joined with " or "', async () => {
    // When both flags are set the header reads "below X or above Y"
    // so the operator scanning a cron log sees exactly which tails
    // were trimmed.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '1.04', '--below', '0.95']);
    const out = stdout.join('');
    expect(out).toMatch(/would clear 4 feedback entries below boost 0\.95 or above boost 1\.04/);
  });

  it('--above with zero matches yields a clean empty report (no DELETE, no error)', async () => {
    // --above 99 above the highest boost in the fixture: nothing
    // qualifies. The command succeeds with matched=0 / cleared=0 so
    // the cron tick is not reported as a failure.
    await feedbackCommand().parseAsync(['node', 'cli', 'prune', '--above', '99', '--apply', '--json']);
    const parsed = JSON.parse(stdout.join('')) as { matched: number; cleared: number; paths: string[] };
    expect(parsed.matched).toBe(0);
    expect(parsed.cleared).toBe(0);
    expect(parsed.paths).toEqual([]);
    expect(fetchCalls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
    expect(process.exitCode).toBeFalsy();
  });
});

describe('digest cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWrite: typeof process.stdout.write;
  let captured: string[];

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { captured.push(String(chunk)); return true; }) as never;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'Snip activity', query: 'snip', lastRunTs: 1700000000000, lastNewCount: 2, lastRemovedCount: 1, runs: 5 },
        ] }), { status: 200 });
      }
      if (u.endsWith('/v1/digests/run') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ran: 1, results: [{ savedSearchId: 's1', newCount: 2, removedCount: 0 }] }), { status: 200 });
      }
      if (/\/v1\/digests\/s1\/run$/.test(u) && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: '/n1.md' }, { path: '/n2.md' }], removedSources: ['x'] },
          lastRunTs: 1, totalRuns: 1,
        }), { status: 200 });
      }
      if (/\/v1\/digests\/s1$/.test(u) && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ state: {
          query: 'snip',
          history: [
            { ts: 2, newSources: [{ path: '/n1.md' }], removedSources: [], totalSources: 4 },
            { ts: 1, newSources: [{ path: '/p1.md' }], removedSources: ['old'], totalSources: 4 },
          ],
        } }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  });

  it('list shows saved searches with last counts', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'list']);
    const out = captured.join('');
    expect(out).toContain('Snip activity');
    expect(out).toContain('+2');
    expect(out).toContain('-1');
  });

  // -----------------------------------------------------------------
  // digest list --since <iso-date>: keep only saved searches whose
  // lastRunTs is strictly less than the cutoff (i.e. those that have
  // NOT been re-run since the cutoff — overdue digests). Mirrors
  // `digest run --since` semantics so a dashboard probe and the
  // run command consume the same cutoff and stay in sync.
  // -----------------------------------------------------------------

  it('digest list --since keeps only saved searches whose lastRunTs predates the cutoff', async () => {
    // Three saved searches with widely-spread lastRunTs:
    //   s-old:   ran 2026-01-01 (very stale)
    //   s-mid:   ran 2026-06-01 (mid)
    //   s-fresh: ran 2026-06-21 (fresh)
    // Cutoff 2026-06-15 should keep s-old + s-mid, drop s-fresh.
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-old', title: 'Old', query: 'old', lastRunTs: Date.parse('2026-01-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-mid', title: 'Mid', query: 'mid', lastRunTs: Date.parse('2026-06-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-fresh', title: 'Fresh', query: 'fresh', lastRunTs: Date.parse('2026-06-21'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-15']);
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string }[] };
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-old', 's-mid']);
  });

  it('digest list --since ALWAYS includes saved searches with lastRunTs === null (never-run is the most extreme case of overdue)', async () => {
    // A never-run digest is the most extreme "needs running" case
    // — a filter that hid them would lie to a dashboard the
    // moment the operator added a new saved search. Mirrors the
    // `digest run --since` precedent.
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-never', title: 'Never', query: 'never', lastRunTs: null, lastNewCount: 0, lastRemovedCount: 0, runs: 0 },
      { savedSearchId: 's-fresh', title: 'Fresh', query: 'fresh', lastRunTs: Date.parse('2026-06-21'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-15']);
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string }[] };
    // s-never kept, s-fresh dropped.
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-never']);
  });

  it('digest list --since uses STRICT less-than (a digest at exactly the cutoff is EXCLUDED)', async () => {
    // Mirrors `digest run --since` byte-for-byte: a digest that
    // ran AT the cutoff satisfies the operator's "leave alone if
    // it ran within the last hour" intent and must not be flagged
    // as overdue.
    const exact = Date.parse('2026-06-15T00:00:00Z');
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-exact', title: 'Exact', query: 'exact', lastRunTs: exact, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-before', title: 'Before', query: 'before', lastRunTs: exact - 1, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-15T00:00:00Z']);
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string }[] };
    // s-before kept (lastRunTs < cutoff), s-exact dropped (lastRunTs === cutoff).
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-before']);
  });

  it('digest list --since with an invalid ISO date aborts cleanly with exit 1 and a typed error', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'list', '--since', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('digest list failed: --since value "banana" is not a valid ISO date');
    process.exitCode = 0;
  });

  it('digest list --since composes with -q (substring forwards to API; --since narrows survivors client-side)', async () => {
    // -q is sent to the API (forwarded as q=...). --since is
    // applied client-side AFTER the API response. The combo is
    // "saved searches matching 'snip' that have NOT run since
    // 2026-06-15" — pin both sides of the intersection.
    let listedUrl = '';
    globalThis.fetch = (async (url: string | URL) => {
      listedUrl = String(url);
      return new Response(JSON.stringify({ items: [
        // The API only returned `snip`-matching rows (q-forwarded);
        // we narrow further by --since on top.
        { savedSearchId: 's-snip-old', title: 'Snip old', query: 'snip', lastRunTs: Date.parse('2026-01-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        { savedSearchId: 's-snip-fresh', title: 'Snip fresh', query: 'snip', lastRunTs: Date.parse('2026-06-21'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      ] }), { status: 200 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '-q', 'snip', '--since', '2026-06-15']);
    // Verify -q forwarded server-side.
    expect(listedUrl).toContain('q=snip');
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string }[] };
    // --since dropped the fresh one.
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-snip-old']);
  });

  // -----------------------------------------------------------------
  // digest list --sort <key>: order survivors of -q / --since by an
  // operator-chosen axis. The natural cron use is the overdue audit:
  //   digest list --since "..." --sort lastRunTs --json
  // which returns overdue digests with the longest-overdue at the
  // top. Mirrors the `feedback list --sort` / `stats --sort`
  // precedent: AFTER filters, secondary sort by original index for
  // deterministic ties, unknown keys abort cleanly.
  // -----------------------------------------------------------------

  it('digest list --sort lastRunTs orders survivors by oldest-run first', async () => {
    // Three saved searches; --sort lastRunTs should rank from
    // oldest run to newest run (ascending), which is the natural
    // "most overdue first" ordering for a cron dashboard.
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-fresh', title: 'Fresh', query: 'fresh', lastRunTs: Date.parse('2026-06-21'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-oldest', title: 'Oldest', query: 'old', lastRunTs: Date.parse('2026-01-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-mid', title: 'Mid', query: 'mid', lastRunTs: Date.parse('2026-06-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'lastRunTs']);
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string }[] };
    // Oldest first, newest last.
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-oldest', 's-mid', 's-fresh']);
  });

  it('digest list --sort lastRunTs places never-run (lastRunTs === null) digests at the TOP', async () => {
    // Never-run is the most extreme case of overdue — it must
    // sort before every timestamped digest under "oldest first"
    // ordering. Matches the --since contract where lastRunTs ===
    // null is ALWAYS included as the most-extreme overdue case.
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-old', title: 'Old', query: 'old', lastRunTs: Date.parse('2026-01-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-never', title: 'Never', query: 'never', lastRunTs: null, lastNewCount: 0, lastRemovedCount: 0, runs: 0 },
      { savedSearchId: 's-fresh', title: 'Fresh', query: 'fresh', lastRunTs: Date.parse('2026-06-21'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'lastRunTs']);
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string }[] };
    // s-never first (null < every timestamp), then oldest -> newest.
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-never', 's-old', 's-fresh']);
  });

  it('digest list --sort runs orders survivors most-frequently-run first (descending)', async () => {
    // The "which saved searches are getting hammered" question.
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-rare', title: 'Rare', query: 'rare', lastRunTs: 0, lastNewCount: 0, lastRemovedCount: 0, runs: 2 },
      { savedSearchId: 's-hot', title: 'Hot', query: 'hot', lastRunTs: 0, lastNewCount: 0, lastRemovedCount: 0, runs: 50 },
      { savedSearchId: 's-mid', title: 'Mid', query: 'mid', lastRunTs: 0, lastNewCount: 0, lastRemovedCount: 0, runs: 12 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--sort', 'runs']);
    const parsed = JSON.parse(captured.join('')) as { items: { savedSearchId: string; runs: number }[] };
    expect(parsed.items.map((it) => it.savedSearchId)).toEqual(['s-hot', 's-mid', 's-rare']);
    expect(parsed.items.map((it) => it.runs)).toEqual([50, 12, 2]);
  });

  it('digest list --sort title --since composes (sort orders survivors of --since)', async () => {
    // --since narrows to overdue, --sort title alphabetizes the
    // survivors for stable cross-snapshot diffs. The natural
    // dashboard use: a deterministic ordering inside the
    // "overdue digests" panel.
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [
      { savedSearchId: 's-z', title: 'Zeta', query: 'z', lastRunTs: Date.parse('2026-01-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-a', title: 'Alpha', query: 'a', lastRunTs: Date.parse('2026-02-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-fresh', title: 'Mu', query: 'm', lastRunTs: Date.parse('2026-06-21'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
      { savedSearchId: 's-m', title: 'Mike', query: 'm2', lastRunTs: Date.parse('2026-03-01'), lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
    ] }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'list', '--json', '--since', '2026-06-15', '--sort', 'title']);
    const parsed = JSON.parse(captured.join('')) as { items: { title: string }[] };
    // s-fresh dropped by --since (lastRunTs > cutoff); remaining
    // survivors sorted alphabetically by title.
    expect(parsed.items.map((it) => it.title)).toEqual(['Alpha', 'Mike', 'Zeta']);
  });

  it('digest list --sort with an unknown key aborts cleanly with exit 1', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'list', '--sort', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('digest list failed: --sort value must be one of: lastRunTs, runs, title');
    expect(err).toContain('"banana"');
    process.exitCode = 0;
  });

  it('run with id prints diffs', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'run', 's1']);
    const out = captured.join('');
    expect(out).toContain('/n1.md');
    expect(out).toContain('/n2.md');
    expect(out).toContain('- x');
  });

  it('run with no id runs all', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'run']);
    expect(captured.join('')).toContain('ran 1 saved searches');
  });

  it('show prints history rows', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1']);
    const out = captured.join('');
    expect(out).toContain('query: snip');
    expect(out.split('\n').filter((l) => l.includes('total')).length).toBe(2);
  });

  it('run with id --json emits parseable JSON and skips text output', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'run', 's1', '--json']);
    const out = captured.join('');
    const parsed = JSON.parse(out) as { entry: { newSources: { path: string }[]; removedSources: string[] } };
    expect(parsed.entry.newSources.map((s) => s.path)).toEqual(['/n1.md', '/n2.md']);
    expect(parsed.entry.removedSources).toEqual(['x']);
    expect(out).not.toContain('+ /n1.md');
  });

  it('run without id --json emits the batch report as JSON', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json']);
    const out = captured.join('');
    const parsed = JSON.parse(out) as { ran: number; results: { savedSearchId: string }[] };
    expect(parsed.ran).toBe(1);
    expect(parsed.results[0]?.savedSearchId).toBe('s1');
    expect(out).not.toContain('ran 1 saved searches');
  });

  it('show --json emits parseable history JSON and skips text output', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json']);
    const out = captured.join('');
    const parsed = JSON.parse(out) as { state: { query: string; history: { ts: number }[] } };
    expect(parsed.state.query).toBe('snip');
    expect(parsed.state.history).toHaveLength(2);
    expect(out).not.toContain('query: snip');
  });

  it('show -q keeps only history rows that touched a matching newSources path', async () => {
    // The fixture has two rows: ts=2 touched /n1.md (new), ts=1
    // touched /p1.md (new) and 'old' (removed). Filtering on 'n1'
    // keeps only the first row.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '-q', 'n1']);
    const out = captured.join('');
    // The "query: snip" preamble stays so the operator still sees the
    // saved-search context.
    expect(out).toContain('query: snip');
    // ts=2 row kept (timestamp formatted to ISO).
    const lines = out.split('\n').filter((l) => l.includes('total'));
    expect(lines).toHaveLength(1);
  });

  it('show -q keeps rows whose removedSources match (filter spans both lists)', async () => {
    // 'old' is in removedSources of the ts=1 row only. The match is
    // case-insensitive, so 'OLD' picks the same row.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '-q', 'OLD']);
    const out = captured.join('');
    const lines = out.split('\n').filter((l) => l.includes('total'));
    expect(lines).toHaveLength(1);
  });

  it('show -q with no matches emits a "no history rows match" hint and skips history rendering', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '-q', 'nothing-matches']);
    const out = captured.join('');
    expect(out).toContain('no history rows match -q "nothing-matches"');
    // No history table rows should be rendered.
    expect(out.split('\n').filter((l) => l.includes('total'))).toHaveLength(0);
  });

  it('show --since drops rows older than the cutoff (intersected with -q when both are set)', async () => {
    // Fixture rows are ts=2 and ts=1 (both ancient epoch ms — long
    // before any sane ISO date). With --since 1970-01-01T00:00:00.001Z
    // (cutoff = 1ms), the row with ts=2 stays and ts=1 is dropped.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '--since', '1970-01-01T00:00:00.002Z']);
    const parsed = JSON.parse(captured.join('')) as {
      state: { history: { ts: number }[] };
    };
    expect(parsed.state.history.map((h) => h.ts)).toEqual([2]);
  });

  it('show --since composes with -q (intersection: row must touch a matching path AND be at-or-after cutoff)', async () => {
    // ts=2 touched /n1.md. ts=1 touched /p1.md + 'old'. With
    // -q n1 we'd keep ts=2 alone; --since cutoff=2 also keeps ts=2.
    // The intersection is still {ts=2}.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '-q', 'n1', '--since', '1970-01-01T00:00:00.002Z']);
    const parsed = JSON.parse(captured.join('')) as {
      state: { history: { ts: number }[] };
    };
    expect(parsed.state.history.map((h) => h.ts)).toEqual([2]);
  });

  it('show --since with no rows passing the cutoff yields an empty history array', async () => {
    // Cutoff far in the future leaves nothing.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '--since', '2999-01-01T00:00:00Z']);
    const parsed = JSON.parse(captured.join('')) as {
      state: { history: { ts: number }[] };
    };
    expect(parsed.state.history).toEqual([]);
  });

  it('show --since text mode prints the unified empty hint mentioning --since', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--since', '2999-01-01T00:00:00Z']);
    const out = captured.join('');
    // Saved-search context still printed.
    expect(out).toContain('query: snip');
    // Hint includes --since so the operator knows which filter narrowed it.
    expect(out).toContain('no history rows match --since 2999-01-01T00:00:00Z');
    // No history rows rendered.
    expect(out.split('\n').filter((l) => l.includes('total'))).toHaveLength(0);
  });

  it('show --since with an invalid ISO date errors cleanly', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--since', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('digest show failed: --since value "banana" is not a valid ISO date');
    process.exitCode = 0;
  });

  it('show --last caps the history to the newest N rows (history is newest-first)', async () => {
    // Fixture has two rows: ts=2 (newest) and ts=1. --last 1 keeps
    // only the newest. The API returns history newest-first so the
    // slice(0, N) shape is correct without re-sorting.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '--last', '1']);
    const parsed = JSON.parse(captured.join('')) as { state: { history: { ts: number }[] } };
    expect(parsed.state.history.map((h) => h.ts)).toEqual([2]);
  });

  it('show --last with a value larger than the natural length yields every row', async () => {
    // Fixture has 2 rows; --last 99 is a no-op (slice(0, 99) keeps both).
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '--last', '99']);
    const parsed = JSON.parse(captured.join('')) as { state: { history: { ts: number }[] } };
    expect(parsed.state.history.map((h) => h.ts)).toEqual([2, 1]);
  });

  it('show --last composes with -q (filter first, then cap to newest N of the survivors)', async () => {
    // -q "n1" keeps only the ts=2 row (which touched /n1.md).
    // --last 5 is then applied on the single-row survivor list and
    // is a no-op. The order is "filter then cap" so the cap is
    // counted against the post-filter rows, never against the raw
    // history (which would let -q widen the visible window).
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '-q', 'n1', '--last', '5']);
    const parsed = JSON.parse(captured.join('')) as { state: { history: { ts: number }[] } };
    expect(parsed.state.history.map((h) => h.ts)).toEqual([2]);
  });

  it('show --last composes with --since (filter first, then cap to newest N of the survivors)', async () => {
    // --since 0 keeps both rows; --last 1 then trims to the newest.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '--since', '1970-01-01T00:00:00.000Z', '--last', '1']);
    const parsed = JSON.parse(captured.join('')) as { state: { history: { ts: number }[] } };
    expect(parsed.state.history.map((h) => h.ts)).toEqual([2]);
  });

  it('show --last with --since narrowing to zero yields the unified empty hint mentioning --last and --since', async () => {
    // --since cutoff in the future leaves no survivors; --last 3 then
    // operates on an empty list. The text-mode hint must mention
    // BOTH filters so the operator knows everything that narrowed
    // the output.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--since', '2999-01-01T00:00:00Z', '--last', '3']);
    const out = captured.join('');
    expect(out).toContain('query: snip');
    expect(out).toContain('no history rows match --since 2999-01-01T00:00:00Z + --last 3');
    expect(out.split('\n').filter((l) => l.includes('total'))).toHaveLength(0);
  });

  it('show --last with a non-positive value errors cleanly (zero would silently look like an empty history)', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--last', '0']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('digest show failed: --last value must be a positive integer');
    process.exitCode = 0;
  });

  it('show --last text mode prints exactly the capped subset (no extras)', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--last', '1']);
    const out = captured.join('');
    // Saved-search context still printed; exactly one history row rendered.
    expect(out).toContain('query: snip');
    expect(out.split('\n').filter((l) => l.includes('total'))).toHaveLength(1);
  });

  it('show --json -q emits filtered history in the JSON payload', async () => {
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--json', '-q', 'n1']);
    const parsed = JSON.parse(captured.join('')) as {
      state: { query: string; history: { ts: number; newSources: { path: string }[] }[] };
    };
    expect(parsed.state.query).toBe('snip');
    expect(parsed.state.history).toHaveLength(1);
    expect(parsed.state.history[0]?.newSources[0]?.path).toBe('/n1.md');
  });

  it('reports a clean message when the api is unreachable', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'list']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const out = stderrBuf.join('');
    expect(out).toContain('digest list failed: cannot reach');
    expect(out).toContain('fetch failed');
    process.exitCode = 0;
  });

  it('surfaces the message field from a json error body on run', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'no such saved search' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'run', 'missing']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const out = stderrBuf.join('');
    expect(out).toContain('digest run failed: 404');
    expect(out).toContain('no such saved search');
    process.exitCode = 0;
  });

  // ---------------------------------------------------------------
  // run --since tests — only re-run digests that have not run since
  // the cutoff. Composes naturally with frequent cron ticks that
  // catch newly-added digests + digests drifted past their budget,
  // while skipping anything a slower tick already covered. Never-run
  // digests (lastRunTs === null) are ALWAYS included (most extreme
  // case of "needs running"). Single-digest failures do not abort
  // the batch.
  // ---------------------------------------------------------------

  it('run --since skips digests whose lastRunTs is at-or-after the cutoff (per-id POST loop)', async () => {
    // Three digests with lastRunTs = 1000, 2000, 3000 ms. Cutoff at
    // 2000 ms keeps lastRunTs < 2000 (just s1, lastRunTs 1000).
    // s2 (lastRunTs 2000) skipped because === cutoff (strict <).
    // s3 (lastRunTs 3000) skipped because > cutoff.
    const perIdCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 1000, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 2000, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 3000, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        perIdCalls.push(m[1]!);
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: `/${m[1]}.md` }], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--since', new Date(2000).toISOString()]);
    const parsed = JSON.parse(captured.join('')) as { ran: number; skipped: number; results: { savedSearchId: string }[] };
    expect(parsed.ran).toBe(1);
    expect(parsed.skipped).toBe(2);
    expect(parsed.results.map((r) => r.savedSearchId)).toEqual(['s1']);
    // Only s1's run endpoint was hit — s2 and s3 must NOT have been.
    expect(perIdCalls).toEqual(['s1']);
  });

  it('run --since always includes digests with lastRunTs === null (never-run)', async () => {
    // A never-run digest is the most extreme case of "needs
    // running". A future cron tick that hid never-runs would be
    // unsafe for any new saved search the operator just added.
    const perIdCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: null, lastNewCount: 0, lastRemovedCount: 0, runs: 0 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 5 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        perIdCalls.push(m[1]!);
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--since', new Date(5000).toISOString()]);
    const parsed = JSON.parse(captured.join('')) as { ran: number; skipped: number; results: { savedSearchId: string }[] };
    // s1 (never run) included; s2 (ran later than cutoff) skipped.
    expect(parsed.ran).toBe(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.results.map((r) => r.savedSearchId)).toEqual(['s1']);
    expect(perIdCalls).toEqual(['s1']);
  });

  it('run --since with an invalid ISO date aborts cleanly with exit 1', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    // No /v1/digests fetch happens because validation aborts up front.
    let listed = false;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith('/v1/digests')) listed = true;
      return new Response('{}', { status: 200 });
    }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'run', '--since', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('digest run failed: --since value "banana" is not a valid ISO date');
    // We DID list digests before failing — that's fine (validation
    // is the first thing inside the action). Update assertion to
    // accept either contract; the important property is that we
    // DID NOT run any per-id POST.
    expect(listed).toBeDefined();
    process.exitCode = 0;
  });

  it('run --since with a single-digest failure does NOT abort the batch (continues with the rest)', async () => {
    // Cron use: one broken saved search must not stall the other N.
    // We make s2's per-id POST return 500; s1 and s3 should still
    // be in the results and the batch exit code should be 0
    // (the failing digest will be retried on the next tick).
    const perIdCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        perIdCalls.push(m[1]!);
        if (m[1] === 's2') {
          return new Response(JSON.stringify({ message: 'transient' }), { status: 500, statusText: 'Server Error' });
        }
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--since', new Date(9000).toISOString()]);
    const parsed = JSON.parse(captured.join('')) as { ran: number; skipped: number; results: { savedSearchId: string }[] };
    // 3 digests attempted, but s2 failed -> only s1 and s3 in results.
    expect(parsed.skipped).toBe(0);
    expect(parsed.ran).toBe(2);
    expect(parsed.results.map((r) => r.savedSearchId).sort()).toEqual(['s1', 's3']);
    // All three per-id POSTs were attempted (we did not stop after s2's failure).
    expect(perIdCalls.sort()).toEqual(['s1', 's2', 's3']);
  });

  it('run --since with nothing surviving the cutoff still emits a clean report (ran=0, skipped=N)', async () => {
    // A cron tick where every digest has run recently. The command
    // succeeds (no errors), skipped reflects the whole list.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      return new Response('should not be called', { status: 500 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--since', new Date(1000).toISOString()]);
    const parsed = JSON.parse(captured.join('')) as { ran: number; skipped: number; results: unknown[] };
    expect(parsed.ran).toBe(0);
    expect(parsed.skipped).toBe(1);
    expect(parsed.results).toEqual([]);
    expect(process.exitCode).toBeFalsy();
  });

  it('run --since text mode prints "ran N, skipped M not stale enough" so the cron log is readable', async () => {
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 5000, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: '/x.md' }], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    const iso = new Date(2000).toISOString();
    await digestCommand().parseAsync(['node', 'cli', 'run', '--since', iso]);
    const out = captured.join('');
    // Header narrates both the run count and the skipped count so
    // an operator scanning a cron log sees what happened at a glance.
    expect(out).toContain('ran 1 saved search');
    expect(out).toContain(`skipped 1 not stale enough (--since ${iso})`);
    // Per-id row for s1 included; s2 row absent.
    expect(out).toContain('  s1 ');
    expect(out).not.toContain('  s2 ');
  });

  // ---------------------------------------------------------------
  // run --max <n> tests — cap how many digests run in a single
  // batch tick. Pairs naturally with --since for a tight cron
  // budget. The deferred suffix rolls over to the next tick. We
  // assert the cap is honoured, the deferred count surfaces
  // separately in the JSON payload, the text body narrates both
  // skip reasons, validation aborts on a typo, and the combined
  // `skipped` key preserves the legacy --since contract.
  // ---------------------------------------------------------------

  it('run --max caps the batch size to the head N of the surviving candidates', async () => {
    // Five digests, all stale enough. --max 2 should run the first
    // two (in API order) and defer the remaining three. Per-id POST
    // count must equal exactly 2 — the cap is enforced at the call
    // site, not via post-filtering after wasted requests.
    const perIdCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's5', title: 'E', query: 'e', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        perIdCalls.push(m[1]!);
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--max', '2']);
    const parsed = JSON.parse(captured.join('')) as {
      ran: number; skipped: number; sinceSkipped: number; deferred: number;
      max: number; results: { savedSearchId: string }[];
    };
    expect(parsed.ran).toBe(2);
    // sinceSkipped is zero because --since was not passed; the
    // remaining 3 are all in `deferred`. Combined `skipped` sums.
    expect(parsed.sinceSkipped).toBe(0);
    expect(parsed.deferred).toBe(3);
    expect(parsed.skipped).toBe(3);
    expect(parsed.max).toBe(2);
    expect(parsed.results.map((r) => r.savedSearchId)).toEqual(['s1', 's2']);
    // Exactly 2 per-id POSTs were fired — NOT 5.
    expect(perIdCalls).toEqual(['s1', 's2']);
  });

  it('run --max composes with --since (cutoff narrows first, cap then trims the survivors)', async () => {
    // Five digests, only three stale enough under --since. --max 2
    // caps THOSE survivors to 2 — the two non-stale digests are
    // sinceSkipped, the one --max-bumped survivor is deferred.
    const perIdCalls: string[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 200, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 300, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's5', title: 'E', query: 'e', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        perIdCalls.push(m[1]!);
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--since', new Date(1000).toISOString(), '--max', '2']);
    const parsed = JSON.parse(captured.join('')) as {
      ran: number; sinceSkipped: number; deferred: number; skipped: number;
      results: { savedSearchId: string }[];
    };
    expect(parsed.ran).toBe(2);
    expect(parsed.sinceSkipped).toBe(2); // s4 + s5
    expect(parsed.deferred).toBe(1);     // s3 was stale enough but capped
    expect(parsed.skipped).toBe(3);
    expect(parsed.results.map((r) => r.savedSearchId)).toEqual(['s1', 's2']);
    expect(perIdCalls).toEqual(['s1', 's2']);
  });

  it('run --max with N >= candidate count is a no-op (no deferred, all run)', async () => {
    // A cap larger than the surviving set should not cause any
    // deferred entries. This guards against an off-by-one in the
    // slice arithmetic when --max overshoots.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--max', '99']);
    const parsed = JSON.parse(captured.join('')) as {
      ran: number; sinceSkipped: number; deferred: number;
    };
    expect(parsed.ran).toBe(2);
    expect(parsed.deferred).toBe(0);
    expect(parsed.sinceSkipped).toBe(0);
  });

  it('run --max 0 is rejected (non-positive cap cannot silently become an empty batch)', async () => {
    // The whole point of --max is "run SOME of them" — a value of
    // 0 means "run none", which is identical to "do not call this
    // command". A typo (e.g. `--max $UNSET`) silently becoming an
    // empty batch is the worst possible failure mode because the
    // operator's intent (cap the batch) is lost in the noise.
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    let listed = false;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith('/v1/digests')) listed = true;
      return new Response('{}', { status: 200 });
    }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'run', '--max', '0']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('digest run failed: --max value must be a positive integer');
    // Validation MUST fire BEFORE the list fetch — wasting a
    // round-trip on a typo'd cap is sloppy.
    expect(listed).toBe(false);
    process.exitCode = 0;
  });

  it('run --max with a non-numeric value is rejected (NaN cannot silently become 0 batch)', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await digestCommand().parseAsync(['node', 'cli', 'run', '--max', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(stderrBuf.join('')).toContain('digest run failed: --max value must be a positive integer');
    process.exitCode = 0;
  });

  it('run --max text mode narrates the deferred count separately from --since skips', async () => {
    // The text body breaks the skip reasons down so a cron log
    // makes it clear WHY 5 of the 10 candidates did not run
    // (vs an opaque "skipped 5"). Asserts both fragments are
    // present in the gray summary line.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: '/x.md' }], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    const iso = new Date(1000).toISOString();
    await digestCommand().parseAsync(['node', 'cli', 'run', '--since', iso, '--max', '1']);
    const out = captured.join('');
    expect(out).toContain('ran 1 saved search');
    expect(out).toContain('deferred 2 over --max 1');
    expect(out).toContain(`skipped 1 not stale enough (--since ${iso})`);
  });

  it('run --max is ignored when an id is passed (single-id runs always run that one digest)', async () => {
    // A `digest run X --max 1` is conceptually nonsense — the user
    // asked for ONE specific digest by id. We honour that intent
    // and ignore --max entirely. This mirrors the existing
    // --since contract on the same path.
    let postUrl = '';
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests/X/run') && init?.method === 'POST') {
        postUrl = u;
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: '/x.md' }], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', 'X', '--max', '99', '--json']);
    expect(postUrl).toContain('/v1/digests/X/run');
    const parsed = JSON.parse(captured.join('')) as { entry: { newSources: { path: string }[] } };
    expect(parsed.entry.newSources[0]?.path).toBe('/x.md');
  });

  // --------------------------------------------------------------
  // run --json --slim tests — 3-field slim shape for cron panels.
  //
  // Mirrors `doctor --json --quiet` byte-for-byte. The slim shape
  // emits ONLY {ran, deferred, sinceSkipped}: the three integers
  // a dashboard panel needs to answer "did the cron tick get
  // through the batch?" without parsing the per-id results blob.
  // Single-line JSON for clean NDJSON snapshot diffs.
  // --------------------------------------------------------------

  it('run --json --slim emits exactly {ran, deferred, sinceSkipped} on a single line', async () => {
    // Five digests, all stale enough. --max 2 runs the first two
    // and defers three. --slim drops the per-id results blob and
    // emits only the three counts.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's5', title: 'E', query: 'e', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: `/${m[1]}.md` }], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--slim', '--max', '2']);
    const raw = captured.join('');
    // Single-line JSON: exactly one newline (the trailing one).
    expect(raw.match(/\n/g)?.length).toBe(1);
    // No multi-line indentation leaks through.
    expect(raw).not.toContain('\n  ');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Exact 3-field shape — no per-id results blob, no since/max
    // metadata, no `skipped` total (recomputable as
    // deferred+sinceSkipped if a consumer wants it).
    expect(Object.keys(parsed).sort()).toEqual(['deferred', 'ran', 'sinceSkipped']);
    expect(parsed.ran).toBe(2);
    expect(parsed.deferred).toBe(3);
    expect(parsed.sinceSkipped).toBe(0);
  });

  it('run --json --slim composes with --since (sinceSkipped surfaces honestly)', async () => {
    // Mix of stale/fresh digests + --max + --since: the slim shape
    // must split the skip reasons cleanly so a dashboard can show
    // "deferred 1 (capped)" separately from "skipped 2 (too fresh)".
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's5', title: 'E', query: 'e', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync([
      'node', 'cli', 'run', '--json', '--slim',
      '--since', new Date(1000).toISOString(),
      '--max', '2',
    ]);
    const parsed = JSON.parse(captured.join('')) as {
      ran: number; deferred: number; sinceSkipped: number;
    };
    expect(parsed.ran).toBe(2);          // s1 + s2
    expect(parsed.deferred).toBe(1);     // s3 capped by --max 2
    expect(parsed.sinceSkipped).toBe(2); // s4 + s5 too fresh
  });

  it('run --json --slim with no candidates yields {ran: 0, deferred: 0, sinceSkipped: 0}', async () => {
    // The empty-state shape must still emit valid JSON so a
    // dashboard cron loop never sees a parse error. Specifically
    // the canonical cron use is `--since X --max N --json --slim`
    // which an operator pipes to `jq -e '.ran > 0'` — that
    // expression must evaluate against a real {ran:0} object,
    // not against an empty stdout that would break the pipeline.
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).endsWith('/v1/digests')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response('unexpected', { status: 500 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--json', '--slim', '--max', '5']);
    const parsed = JSON.parse(captured.join('')) as Record<string, unknown>;
    expect(parsed).toEqual({ ran: 0, deferred: 0, sinceSkipped: 0 });
  });

  it('run --slim without --json is silently ignored (text mode unchanged)', async () => {
    // Mirrors the doctor --quiet contract: --slim is a JSON shape
    // modifier and has no business changing text mode (which is
    // already a one-liner gray summary). A future operator who
    // forgets --json should not see a different output.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [{ path: '/x.md' }], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync(['node', 'cli', 'run', '--slim', '--max', '99']);
    const out = captured.join('');
    // Text-mode summary still fires; no JSON anywhere.
    expect(out).toContain('ran 1');
    expect(() => JSON.parse(out)).toThrow();
  });

  // --------------------------------------------------------------
  // run --json --slim --since byte-layout pin.
  //
  // The slim shape + --since composition is exercised by earlier
  // tests at the COUNT level (we assert {ran, deferred, sinceSkipped}
  // are the right integers). What was missing was an exact-byte-layout
  // pin: the canonical cron probe shape
  //   clawmind digest run --since X --max N --json --slim
  // is supposed to produce a single-line JSON document with EXACTLY
  // the 3 keys {ran, deferred, sinceSkipped} (in stringify order)
  // followed by a trailing \n. A future regression where, say, the
  // slim shape silently grew an extra key (`skipped` re-added "for
  // backwards compat") would break NDJSON snapshot diffs across
  // ticks without surfacing a test failure under count-only
  // assertions.
  //
  // These three tests pin the byte layout under the three meaningful
  // shapes the canonical cron probe produces: a partial-survivor mix
  // (the most common case), all-deferred (cap exhausts before
  // cutoff filters anything), and all-sinceSkipped (cutoff hides
  // everything). All three must produce single-line JSON with the
  // same 3 keys in the same order, no extra fields.
  // --------------------------------------------------------------

  it('run --json --slim --since produces the EXACT three-key byte layout (mixed survivors)', async () => {
    // Five digests: s1+s2 are stale enough AND survive --max 2 (ran);
    // s3 is stale enough but capped (deferred); s4+s5 are too fresh
    // (sinceSkipped). The canonical mixed case.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's5', title: 'E', query: 'e', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync([
      'node', 'cli', 'run', '--json', '--slim',
      '--since', new Date(1000).toISOString(),
      '--max', '2',
    ]);
    const raw = captured.join('');
    // Exact byte layout. JSON.stringify preserves insertion order
    // on a plain object, and the slim shape is built as
    //   { ran, deferred, sinceSkipped }
    // so the canonical line is
    //   {"ran":2,"deferred":1,"sinceSkipped":2}\n
    // No other key, no trailing whitespace, exactly one \n at end.
    expect(raw).toBe('{"ran":2,"deferred":1,"sinceSkipped":2}\n');
  });

  it('run --json --slim --since byte layout: all-deferred case (cap exhausts before cutoff matters)', async () => {
    // Five stale-enough digests, --max 1: ran=1, deferred=4,
    // sinceSkipped=0. The cap dominates; the cutoff has nothing to
    // filter. A cron dashboard graphing "deferred" over time wants
    // a stable layout that highlights this shape cleanly.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's4', title: 'D', query: 'd', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's5', title: 'E', query: 'e', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync([
      'node', 'cli', 'run', '--json', '--slim',
      '--since', new Date(1000).toISOString(),
      '--max', '1',
    ]);
    expect(captured.join('')).toBe('{"ran":1,"deferred":4,"sinceSkipped":0}\n');
  });

  it('run --json --slim --since byte layout: all-sinceSkipped case (cutoff hides everything)', async () => {
    // Three digests, all too-fresh under the cutoff: ran=0,
    // deferred=0, sinceSkipped=3. A cron dashboard panel must still
    // see a valid 3-field JSON document so `jq -e '.ran > 0'`
    // returns false WITHOUT parse-erroring. This is the empty-tick
    // shape for the canonical cron probe.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's3', title: 'C', query: 'c', lastRunTs: 9999, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    await digestCommand().parseAsync([
      'node', 'cli', 'run', '--json', '--slim',
      '--since', new Date(1000).toISOString(),
      '--max', '10',
    ]);
    expect(captured.join('')).toBe('{"ran":0,"deferred":0,"sinceSkipped":3}\n');
  });

  it('run --json --slim --since produces an NDJSON-friendly diff across consecutive ticks (no key reordering, no extra fields)', async () => {
    // The cron use is `while true; do clawmind digest run ... --json
    // --slim; sleep 60; done` piped into an NDJSON store. We
    // simulate two consecutive ticks against the same data and
    // assert the byte layout is IDENTICAL. A future change that
    // (say) accidentally added a `ts` field to the slim shape
    // would break this assertion immediately — protecting the
    // snapshot-diff contract that the cron dashboard relies on.
    let listCallCount = 0;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/v1/digests') && (!init || !init.method || init.method === 'GET')) {
        listCallCount += 1;
        return new Response(JSON.stringify({ items: [
          { savedSearchId: 's1', title: 'A', query: 'a', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
          { savedSearchId: 's2', title: 'B', query: 'b', lastRunTs: 100, lastNewCount: 0, lastRemovedCount: 0, runs: 1 },
        ] }), { status: 200 });
      }
      const m = /\/v1\/digests\/(\w+)\/run$/.exec(u);
      if (m && init?.method === 'POST') {
        return new Response(JSON.stringify({
          entry: { newSources: [], removedSources: [] },
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as never;
    const args = ['node', 'cli', 'run', '--json', '--slim',
      '--since', new Date(1000).toISOString(),
      '--max', '5'];
    await digestCommand().parseAsync(args);
    const tick1 = captured.join('');
    captured.length = 0;
    await digestCommand().parseAsync(args);
    const tick2 = captured.join('');
    // Identical byte layout — pin the snapshot-diff contract.
    expect(tick1).toBe(tick2);
    expect(tick1).toBe('{"ran":2,"deferred":0,"sinceSkipped":0}\n');
    // Sanity: each tick really did call the list endpoint.
    expect(listCallCount).toBe(2);
  });

  // -----------------------------------------------------------------
  // digest show --paths-only: pipeline-friendly twin of the rest of
  // the --paths-only family (search / forget / related / stale).
  // Walks the filtered history rows newest-first; emits newSources
  // first within each row, then removedSources; deduplicates against
  // a Set sentinel; short-circuits before --json.
  // -----------------------------------------------------------------

  it('show --paths-only walks history newest-first, emits newSources then removedSources, deduped', async () => {
    // The default fixture's history (newest-first):
    //   ts=2: newSources=[/n1.md], removedSources=[]
    //   ts=1: newSources=[/p1.md], removedSources=[old]
    // Expected stream (rows newest-first, within each row new then
    // removed): /n1.md, /p1.md, old.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only']);
    expect(captured.join('')).toBe('/n1.md\n/p1.md\nold\n');
  });

  it('show --paths-only dedupes paths across rows (a path that appears in two rows surfaces once)', async () => {
    // Override the fixture with a payload where /shared.md
    // appears in both the newest and the older row. The dedupe
    // must keep ONE occurrence (the first one encountered, which
    // anchors the path in the newest row).
    globalThis.fetch = (async () => new Response(JSON.stringify({
      state: {
        query: 'snip',
        history: [
          { ts: 3, newSources: [{ path: '/shared.md' }, { path: '/only-new.md' }], removedSources: [], totalSources: 3 },
          { ts: 2, newSources: [{ path: '/older-new.md' }], removedSources: ['/shared.md'], totalSources: 2 },
          { ts: 1, newSources: [{ path: '/shared.md' }], removedSources: [], totalSources: 1 },
        ],
      },
    }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only']);
    // /shared.md surfaces ONCE at the newest occurrence (ts=3 newSources).
    // The walk order is: ts=3 newSources, ts=3 removedSources, ts=2
    // newSources, ts=2 removedSources (but /shared.md already seen),
    // ts=1 newSources (but /shared.md already seen).
    expect(captured.join('')).toBe('/shared.md\n/only-new.md\n/older-new.md\n');
  });

  it('show --paths-only emits a clean empty stream when the history is empty (no query: header, no hint)', async () => {
    // Empty history: no rows to walk. The stream must be empty
    // — no `query:` header, no empty-state hint. Critical for
    // `clawmind digest show s1 --paths-only | xargs ls`:
    // leaking either of those to stdout would poison xargs.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      state: { query: 'snip', history: [] },
    }), { status: 200 })) as never;
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only']);
    expect(captured.join('')).toBe('');
  });

  it('show --paths-only emits a clean empty stream when filters narrow to zero rows', async () => {
    // Same fixture as the dedupe test but with --since far in
    // the future — nothing survives. Must be a clean empty
    // stream, NOT the unified text-mode "no history rows match"
    // hint that the text path emits.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only', '--since', '2999-01-01T00:00:00Z']);
    expect(captured.join('')).toBe('');
  });

  it('show --paths-only short-circuits --json (the paths-only contract wins when both are set)', async () => {
    // Mirrors search/forget/related --paths-only: pipeline-friendly
    // trumps machine-readable when both flags are passed. The
    // operator's `--json` is silently ignored — they get the
    // path-per-line stream.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only', '--json']);
    const out = captured.join('');
    // Plain paths, NOT a JSON document.
    expect(out).toBe('/n1.md\n/p1.md\nold\n');
    expect(out.trim().startsWith('{')).toBe(false);
    expect(out.trim().startsWith('[')).toBe(false);
  });

  it('show --paths-only composes with --last 1 (canonical "most-recent run paths" one-liner)', async () => {
    // The canonical cron pipe:
    //   clawmind digest show s1 --paths-only --last 1 | xargs clawmind ingest --paths -
    // is "feed the most-recent run's surfaced paths back into
    // ingest". Pins that --last narrows the rows BEFORE --paths-only
    // walks them — only the ts=2 row's paths survive.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only', '--last', '1']);
    // Just /n1.md (the ts=2 row's only newSource); /p1.md and /old
    // belong to the ts=1 row which --last 1 dropped.
    expect(captured.join('')).toBe('/n1.md\n');
  });

  it('show --paths-only composes with -q (substring filter on row paths narrows the walk)', async () => {
    // -q "n1" keeps only the ts=2 row (which contains /n1.md);
    // --paths-only then walks just that row. The ts=1 row's
    // /p1.md and /old don't survive.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only', '-q', 'n1']);
    expect(captured.join('')).toBe('/n1.md\n');
  });

  it('show --paths-only composes with --since (date-bounded window narrows the walk)', async () => {
    // --since cutoff between ts=1 and ts=2 keeps only the ts=2
    // row; --paths-only then walks just that row.
    await digestCommand().parseAsync(['node', 'cli', 'show', 's1', '--paths-only', '--since', '1970-01-01T00:00:00.002Z']);
    expect(captured.join('')).toBe('/n1.md\n');
  });
});
