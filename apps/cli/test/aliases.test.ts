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
});
