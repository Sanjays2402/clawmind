import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock buildRuntime so the test does not spin up MLX / LanceDB / OpenAI.
// We control the latency reported by each probe by inserting a small
// synthetic delay; the assertion only checks the ordering (probe
// latencies > 0) so a slow CI box does not turn this test flaky.
// embedHealthy / llmHealthy are module-level switches so individual
// tests can drive the up/down state per scenario without re-mocking
// the whole module.
let embedHealthy = true;
let llmHealthy = false;
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
        return embedHealthy;
      },
    },
    llm: {
      async health() {
        await new Promise((r) => setTimeout(r, 5));
        return llmHealthy;
      },
    },
  }),
}));

import { statusCommand } from '../src/commands/status.js';

describe('status cli', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    embedHealthy = true;
    llmHealthy = false;
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
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

  it('--check is a no-op (exit 0) when every probe is up', async () => {
    embedHealthy = true;
    llmHealthy = true;
    await statusCommand().parseAsync(['node', 'cli', '--check']);
    // Body is still printed.
    expect(stdout.join('')).toContain('ClawMind status');
    // Exit code stays 0 / falsy.
    expect(process.exitCode).toBeFalsy();
    // Stderr stays quiet — no "down" line.
    expect(stderr.join('')).toBe('');
  });

  it('--check exits 2 when any probe is down (text mode prints the down probes to stderr)', async () => {
    embedHealthy = true;
    llmHealthy = false;
    await statusCommand().parseAsync(['node', 'cli', '--check']);
    // Body still prints to stdout so the operator sees the full table.
    expect(stdout.join('')).toContain('ClawMind status');
    expect(process.exitCode).toBe(2);
    // Stderr names the offending probe(s) so a script that redirected
    // stdout to /dev/null still has a useful log line.
    expect(stderr.join('')).toContain('status --check: llm down');
  });

  it('--check exits 2 and lists ALL down probes when multiple are down', async () => {
    embedHealthy = false;
    llmHealthy = false;
    await statusCommand().parseAsync(['node', 'cli', '--check']);
    expect(process.exitCode).toBe(2);
    // "embed + llm" — both named, in the order the runtime probes them.
    expect(stderr.join('')).toContain('status --check: embed + llm down');
  });

  it('--check --json exits 2 on a down probe but keeps the JSON payload parseable', async () => {
    embedHealthy = true;
    llmHealthy = false;
    await statusCommand().parseAsync(['node', 'cli', '--check', '--json']);
    expect(process.exitCode).toBe(2);
    const out = JSON.parse(stdout.join(''));
    // Body shape is unchanged from the non-check JSON mode so a
    // single command can both report and drive the exit code.
    expect(out.ok).toBe(false);
    expect(out.embed).toBe('ok');
    expect(out.llm).toBe('down');
    // The text-mode stderr hint does NOT fire in --json mode — the
    // structured payload already carries the per-probe state, and
    // adding a stray stderr line would muddy json-piped consumers.
    expect(stderr.join('')).toBe('');
  });

  it('without --check, a down probe still exits 0 (the flag is opt-in)', async () => {
    embedHealthy = false;
    llmHealthy = false;
    await statusCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBeFalsy();
  });
});
