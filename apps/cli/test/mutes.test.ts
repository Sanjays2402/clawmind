import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mutesCommand } from '../src/commands/mutes.js';

function stubFetch(payload: unknown, init: ResponseInit = { status: 200 }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })) as never;
}

describe('mutes cli', () => {
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
    await mutesCommand().parseAsync(['node', 'cli', 'list']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('mutes list failed: cannot reach');
    expect(out).toContain('fetch failed');
  });

  it('--paths emits one path per line with no styling, no headers, no reasons', async () => {
    stubFetch({
      items: [
        { path: '/noisy/a.md', reason: 'auto-generated', mutedAt: 1700000000000, mutedBy: 'me' },
        { path: '/noisy/b.md', mutedAt: 1700000001000, mutedBy: 'me' },
        { path: '/noisy/c.md', reason: 'duplicate', mutedAt: 1700000002000, mutedBy: 'me' },
      ],
      count: 3,
    });
    await mutesCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    expect(stdout.join('')).toBe('/noisy/a.md\n/noisy/b.md\n/noisy/c.md\n');
    // No human summary, no reason bodies, no "no muted sources" line.
    expect(stdout.join('')).not.toContain('by me');
    expect(stdout.join('')).not.toContain('auto-generated');
    expect(stdout.join('')).not.toContain('duplicate');
    // No ANSI styling — --paths feeds the next command unmodified.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('--paths with zero matches yields a clean empty stream (no "no muted" hint)', async () => {
    stubFetch({ items: [], count: 0 });
    await mutesCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--json continues to emit the full structured payload (no regression)', async () => {
    stubFetch({
      items: [{ path: '/noisy/a.md', reason: 'spam', mutedAt: 0, mutedBy: 'me' }],
      count: 1,
    });
    await mutesCommand().parseAsync(['node', 'cli', 'list', '--json']);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.count).toBe(1);
    expect(parsed.items[0].reason).toBe('spam');
  });
});
