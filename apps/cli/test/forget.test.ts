import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { forgetCommand } from '../src/commands/forget.js';

describe('forget cli', () => {
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
    await forgetCommand().parseAsync(['node', 'cli', '**/*.tmp']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('forget failed: cannot reach');
    expect(out).toContain('fetch failed');
    // Single-line operator-visible error: no node stack frames may leak.
    expect(out).not.toContain('at ');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'pattern rejected: absolute path required' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', 'relative-pattern.md']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('forget failed: (400');
    expect(out).toContain('pattern rejected: absolute path required');
  });

  it('emits structured json with --json on success', async () => {
    const payload = {
      matched: 2,
      removedChunks: 5,
      removedPaths: ['/a.md', '/b.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json']);
    expect(process.exitCode).toBeFalsy();
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.patterns).toEqual(['/tmp/*.md']);
    expect(parsed.matched).toBe(2);
    expect(parsed.dryRun).toBe(true);
  });

  it('prints the dry-run summary and rerun hint without --apply', async () => {
    const payload = {
      matched: 1,
      removedChunks: 2,
      removedPaths: ['/x.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md']);
    const out = stdout.join('');
    expect(out).toContain('would remove 1 source(s) and 2 chunk(s)');
    expect(out).toContain('/x.md');
    expect(out).toContain('rerun with --apply');
  });

  it('--paths-only emits one matched path per line with no styling or summary', async () => {
    const payload = {
      matched: 3,
      removedChunks: 7,
      removedPaths: ['/a.md', '/b.md', '/c.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--paths-only']);
    const out = stdout.join('');
    // Exact byte layout so `xargs`/`wc -l` keep working.
    expect(out).toBe('/a.md\n/b.md\n/c.md\n');
    // No human-facing summary should leak in.
    expect(out).not.toContain('would remove');
    expect(out).not.toContain('rerun with --apply');
    // No ANSI styling — paths-only is meant for downstream commands.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('--paths-only with zero matches yields a clean empty stream', async () => {
    const payload = {
      matched: 0,
      removedChunks: 0,
      removedPaths: [],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/nope/*', '--paths-only']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only honours --apply (lists the same paths after deletion)', async () => {
    // The behaviour does not change between dry-run and apply — the API
    // returns the same `removedPaths` shape. The flag pair is mostly a
    // sanity check that we do not accidentally suppress paths when the
    // command is actually destructive.
    const payload = {
      matched: 1,
      removedChunks: 4,
      removedPaths: ['/gone.md'],
      dryRun: false,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--paths-only']);
    expect(stdout.join('')).toBe('/gone.md\n');
  });

  it('--confirm refuses to apply when the dry-run count does not match the declared expectation', async () => {
    // The cli performs a dry-run pre-flight first (dryRun: true) to
    // learn the real count, then compares to --confirm. We stub both
    // responses sequentially so the test exercises the full flow.
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      // Pre-flight reports 42 matches — but the operator declared 5.
      return new Response(JSON.stringify({
        matched: 42,
        removedChunks: 100,
        removedPaths: Array.from({ length: 42 }, (_, i) => `/p${i}.md`),
        dryRun: body.dryRun,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/**/*.md', '--apply', '--confirm', '5']);
    // The mismatch must abort BEFORE the destructive call. Only one
    // request (the dry-run pre-flight) should have been made.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.dryRun).toBe(true);
    expect(process.exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('--confirm 5 does not match actual count 42');
    // The error spells out the right value to use so the operator can
    // copy-paste a correct re-run.
    expect(err).toContain('re-run with --confirm 42');
    expect(err).toContain('--confirm -1 to bypass');
  });

  it('--confirm with matching count proceeds to apply (two requests: dry-run + apply)', async () => {
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      return new Response(JSON.stringify({
        matched: 3,
        removedChunks: 9,
        removedPaths: ['/a.md', '/b.md', '/c.md'],
        dryRun: body.dryRun,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--confirm', '3']);
    // Two calls: pre-flight dry-run, then the actual apply.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.dryRun).toBe(true);
    expect(calls[1]?.dryRun).toBe(false);
    expect(process.exitCode).toBeFalsy();
    // The "removed" (not "would remove") summary fires because the apply
    // call returned dryRun: false.
    expect(stdout.join('')).toContain('removed 3 source(s)');
  });

  it('--confirm -1 bypasses the count check (explicit opt-out for unknown-size scripts)', async () => {
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      // Big match count — would normally need an exact --confirm value.
      return new Response(JSON.stringify({
        matched: 999,
        removedChunks: 5000,
        removedPaths: ['/lots.md'],
        dryRun: body.dryRun,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/**/*', '--apply', '--confirm', '-1']);
    // Still two calls — pre-flight stays so the operator at least sees
    // the count in the apply output below.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.dryRun).toBe(false);
    expect(process.exitCode).toBeFalsy();
    expect(stdout.join('')).toContain('removed 999 source(s)');
  });

  it('--confirm without --apply is silently ignored (dry-run is already safe)', async () => {
    // --confirm guards the apply path. A bare `forget pattern --confirm 5`
    // (without --apply) is just a regular dry-run, no pre-flight, no
    // gate. This matches the principle that --confirm is a TRIPWIRE,
    // not a filter.
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      return new Response(JSON.stringify({
        matched: 42, removedChunks: 100, removedPaths: ['/a.md'], dryRun: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--confirm', '5']);
    // Exactly one call (the regular dry-run), no gate.
    expect(calls).toHaveLength(1);
    expect(process.exitCode).toBeFalsy();
    expect(stdout.join('')).toContain('would remove 42');
  });

  it('--confirm with a non-numeric value errors cleanly without touching the API', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--confirm', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(fetchCalled).toBe(false);
    expect(stderr.join('')).toContain('--confirm value "banana" is not a number');
  });
});
