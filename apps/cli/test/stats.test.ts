import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { statsCommand } from '../src/commands/stats.js';

const sampleReport = {
  totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
  byNamespace: [
    { namespace: 'memory', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [{ ext: 'md', count: 10 }] },
    { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [{ ext: 'json', count: 5 }] },
    { namespace: 'projects', files: 15, chunks: 150, bytes: 15_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [{ ext: 'ts', count: 15 }] },
  ],
  generatedAt: 0,
};

describe('stats cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let captured: string[];
  let originalWrite: typeof process.stdout.write;
  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => { captured.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () => new Response(JSON.stringify(sampleReport), { status: 200 })) as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  });

  it('emits full report as json without filter', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json']);
    const out = JSON.parse(captured.join(''));
    expect(out.totals.namespaces).toBe(3);
    expect(out.byNamespace).toHaveLength(3);
  });

  it('-q substring filters namespaces and recomputes totals', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'sess']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace).toHaveLength(1);
    expect(out.byNamespace[0].namespace).toBe('sessions');
    expect(out.totals).toEqual({ files: 5, chunks: 50, bytes: 5_000, namespaces: 1 });
  });

  it('-q is case-insensitive', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'MEM']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual(['memory']);
  });

  it('-q with no matches yields empty list and zeroed totals', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'nope']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace).toHaveLength(0);
    expect(out.totals).toEqual({ files: 0, chunks: 0, bytes: 0, namespaces: 0 });
  });

  it('text mode renders only the filtered namespace', async () => {
    await statsCommand().parseAsync(['node', 'cli', '-q', 'proj']);
    const text = captured.join('');
    expect(text).toContain('projects');
    expect(text).not.toContain('memory ');
    expect(text).not.toContain('sessions ');
  });
});

describe('stats cli error handling', () => {
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
    await statsCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stats failed: cannot reach');
    expect(out).toContain('fetch failed');
    // No node stack frames should leak: the operator sees one styled line.
    expect(out).not.toContain('at ');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'storage corrupt' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await statsCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stats failed: (500');
    expect(out).toContain('storage corrupt');
  });

  it('falls back to raw text when the error body is not json', async () => {
    globalThis.fetch = (async () =>
      new Response('plain text error', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as never;
    await statsCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stats failed: (502');
    expect(out).toContain('plain text error');
  });
});
