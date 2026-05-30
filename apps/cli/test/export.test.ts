import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportCommand } from '../src/commands/export.js';

describe('export cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let captured: string[];
  let originalWrite: typeof process.stdout.write;
  let dir: string;
  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => { captured.push(String(c)); return true; }) as never;
    dir = mkdtempSync(join(tmpdir(), 'cm-export-'));
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('writes markdown to stdout when --out is omitted', async () => {
    globalThis.fetch = (async () => new Response('# hi\n\nbody\n', { status: 200 })) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    expect(captured.join('')).toContain('# hi');
  });

  it('writes to file when --out is provided', async () => {
    globalThis.fetch = (async () => new Response('# file\n', { status: 200 })) as never;
    const out = join(dir, 'conv.md');
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-o', out, '--api', 'http://x']);
    expect(readFileSync(out, 'utf8')).toBe('# file\n');
    expect(captured.join('')).toContain(`-> ${out}`);
  });

  it('reports failure with exit code on non-2xx', async () => {
    globalThis.fetch = (async () => new Response('not found', { status: 404, statusText: 'Not Found' })) as never;
    const stderr: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    try {
      await exportCommand().parseAsync(['node', 'cli', 'abc', '--api', 'http://x']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('export failed');
  });
});
