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
});
