import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { doctorCommand } from '../src/commands/doctor.js';

describe('doctor cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let originalStdout: typeof process.stdout.write;
  let originalStderr: typeof process.stderr.write;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    originalFetch = globalThis.fetch;
    originalStdout = process.stdout.write.bind(process.stdout);
    originalStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdoutChunks.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderrChunks.push(String(c)); return true; }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.exitCode = 0;
  });

  it('reports a clean error when the api is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as never;
    await doctorCommand().parseAsync(['node', 'cli']);
    const err = stderrChunks.join('');
    expect(err).toMatch(/doctor failed: cannot reach /);
    expect(err).toContain('ECONNREFUSED');
    expect(process.exitCode).toBe(1);
  });

  it('surfaces server json error message on non-2xx', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ message: 'manifest locked' }),
      { status: 503, statusText: 'Service Unavailable' },
    )) as never;
    await doctorCommand().parseAsync(['node', 'cli']);
    const err = stderrChunks.join('');
    expect(err).toMatch(/doctor failed \(503 /);
    expect(err).toContain('manifest locked');
    expect(process.exitCode).toBe(1);
  });

  it('emits JSON report when --json is passed', async () => {
    const report = {
      ok: true,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json']);
    const out = stdoutChunks.join('');
    expect(JSON.parse(out)).toEqual(report);
    expect(process.exitCode).toBeFalsy();
  });
});
