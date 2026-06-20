import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock buildRuntime so the test does not spin up MLX / LanceDB / OpenAI.
// We control the latency reported by each probe by inserting a small
// synthetic delay; the assertion only checks the ordering (probe
// latencies > 0) so a slow CI box does not turn this test flaky.
vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    env: { CLAWMIND_API_HOST: '127.0.0.1', CLAWMIND_API_PORT: 7410 },
    workspace: '/tmp/workspace',
    manifest: { size: () => 12 },
    bm25: { size: () => 34 },
    lance: { count: async () => 56 },
    embed: {
      async health() {
        await new Promise((r) => setTimeout(r, 5));
        return true;
      },
    },
    llm: {
      async health() {
        await new Promise((r) => setTimeout(r, 5));
        return false;
      },
    },
  }),
}));

import { statusCommand } from '../src/commands/status.js';

describe('status cli', () => {
  let stdout: string[];
  let origOut: typeof process.stdout.write;
  beforeEach(() => {
    stdout = [];
    origOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.exitCode = 0;
  });

  it('emits the resolved api base url and per-probe latency in --json mode', async () => {
    await statusCommand().parseAsync(['node', 'cli', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out.workspace).toBe('/tmp/workspace');
    expect(out.apiBase).toBe('http://127.0.0.1:7410');
    expect(out.documents).toBe(12);
    expect(out.chunks).toBe(56);
    expect(out.bm25Docs).toBe(34);
    expect(out.embed).toBe('ok');
    expect(out.llm).toBe('down');
    // ok = embed && llm — one is down, so ok is false.
    expect(out.ok).toBe(false);
    // Latency must be reported and non-negative (we slept 5ms each).
    expect(out.embedLatencyMs).toBeGreaterThanOrEqual(0);
    expect(out.llmLatencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof out.embedLatencyMs).toBe('number');
    expect(typeof out.llmLatencyMs).toBe('number');
  });

  it('renders the api row and probe latency in text mode', async () => {
    await statusCommand().parseAsync(['node', 'cli']);
    const text = stdout.join('');
    expect(text).toContain('ClawMind status');
    expect(text).toContain('api       : http://127.0.0.1:7410');
    expect(text).toContain('workspace : /tmp/workspace');
    expect(text).toContain('documents : 12');
    // Probe rows carry an "(<n>ms)" suffix so the operator sees a number.
    expect(text).toMatch(/embed\s*:.*ok.*\(\d+ms\)/);
    expect(text).toMatch(/llm\s*:.*down.*\(\d+ms\)/);
  });
});
