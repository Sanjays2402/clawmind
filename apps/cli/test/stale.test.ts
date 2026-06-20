import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
