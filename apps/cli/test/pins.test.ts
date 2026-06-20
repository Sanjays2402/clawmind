import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { pinsCommand } from '../src/commands/pins.js';

// Captures every Response the test installs so we can assert on the path
// later if we need to. Mirrors the pattern in `aliases.test.ts` /
// `forget.test.ts` exactly so the file is easy to read alongside its
// siblings.
function stubFetch(payload: unknown, init: ResponseInit = { status: 200 }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })) as never;
}

describe('pins cli', () => {
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
    await pinsCommand().parseAsync(['node', 'cli', 'list']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('pins list failed: cannot reach');
    expect(out).toContain('fetch failed');
  });

  it('--paths emits one path per line with no styling, no headers, no notes', async () => {
    stubFetch({
      items: [
        { path: '/a.md', note: 'why a', pinnedAt: 1700000000000, pinnedBy: 'me' },
        { path: '/b.md', pinnedAt: 1700000001000, pinnedBy: 'me' },
        { path: '/c.md', note: 'why c', pinnedAt: 1700000002000, pinnedBy: 'me' },
      ],
      count: 3,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    // Exact byte layout so `xargs`/`wc -l` keep working.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    // No human summary, no note bodies, no "no pinned sources" line.
    expect(stdout.join('')).not.toContain('by me');
    expect(stdout.join('')).not.toContain('why');
    // No ANSI styling — --paths is meant for downstream commands.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
  });

  it('--paths with zero matches yields a clean empty stream (no "no pinned" hint)', async () => {
    stubFetch({ items: [], count: 0 });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--paths']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--json still works when --paths is not set', async () => {
    stubFetch({
      items: [{ path: '/a.md', pinnedAt: 0, pinnedBy: 'me' }],
      count: 1,
    });
    await pinsCommand().parseAsync(['node', 'cli', 'list', '--json']);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.count).toBe(1);
    expect(parsed.items[0].path).toBe('/a.md');
  });
});
