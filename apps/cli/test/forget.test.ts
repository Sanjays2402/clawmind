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
});
