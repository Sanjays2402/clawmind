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
