import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { relatedCommand } from '../src/commands/related.js';

describe('related cli', () => {
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
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('related failed: cannot reach');
    expect(out).toContain('fetch failed');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'path not indexed' }), {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('related failed (404');
    expect(out).toContain('path not indexed');
  });

  it('prints results in text mode', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          path: 'foo.md',
          sourceChunkCount: 3,
          items: [
            { path: 'bar.md', namespace: 'memory', score: 0.812, hits: 2, excerpt: 'hello world' },
          ],
          count: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md']);
    const out = stdout.join('');
    expect(out).toContain('bar.md');
    expect(out).toContain('0.812');
    expect(out).toContain('hello world');
  });

  it('emits structured json with --json', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ path: 'foo.md', sourceChunkCount: 0, items: [], count: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as never;
    await relatedCommand().parseAsync(['node', 'cli', 'foo.md', '--json']);
    const out = stdout.join('');
    const parsed = JSON.parse(out);
    expect(parsed.path).toBe('foo.md');
    expect(parsed.count).toBe(0);
  });
});
