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

  it('hits the json endpoint when --format json is passed', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('{"id":"abc"}', { status: 200 });
    }) as never;
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'json', '--api', 'http://x']);
    expect(seenUrl).toBe('http://x/v1/conversations/abc/export.json');
    expect(captured.join('')).toContain('"id":"abc"');
  });

  it('hits the csv endpoint when --format csv is passed', async () => {
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response('role,content\nuser,hi\n', { status: 200 });
    }) as never;
    const out = join(dir, 'conv.csv');
    await exportCommand().parseAsync(['node', 'cli', 'abc', '-f', 'csv', '-o', out, '--api', 'http://x']);
    expect(seenUrl).toBe('http://x/v1/conversations/abc/export.csv');
    expect(readFileSync(out, 'utf8')).toContain('role,content');
  });

  it('rejects unknown formats before calling the api', async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response('', { status: 200 }); }) as never;
    await expect(
      exportCommand().exitOverride().parseAsync(['node', 'cli', 'abc', '-f', 'pdf', '--api', 'http://x']),
    ).rejects.toThrow();
    expect(called).toBe(false);
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
