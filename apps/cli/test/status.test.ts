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

  // ---------------------------------------------------------------
  // --watch polling loop. The flag turns the one-shot status into a
  // refreshing dashboard. We use --max-polls in every watch test to
  // bound the loop (otherwise vitest would hang forever). All tests
  // here use the minimum poll interval (100ms) so the suite stays
  // fast — anything lower would be rejected by the validation guard
  // up front (which we also test below).
  // ---------------------------------------------------------------

  it('--watch with --max-polls 3 --json emits exactly 3 NDJSON snapshots (one per line)', async () => {
    embedHealthy = true;
    llmHealthy = true;
    await statusCommand().parseAsync(['node', 'cli', '--watch', '100', '--max-polls', '3', '--json']);
    const lines = stdout.join('').split('\n').filter(Boolean);
    // Exactly 3 lines — one NDJSON document per polling cycle. The
    // contract is "snapshot stream", so a downstream `jq -c .`
    // sees three independent JSON documents, not one big array.
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const doc = JSON.parse(line);
      // Each line is a complete StatusSnapshot — same shape the
      // one-shot --json mode emits, so a dashboard does not have
      // to special-case the watch variant.
      expect(doc.workspace).toBe('/tmp/workspace');
      expect(doc.embed).toBe('ok');
      expect(doc.llm).toBe('ok');
      expect(doc.ok).toBe(true);
      expect(typeof doc.embedLatencyMs).toBe('number');
    }
    // No multi-line indent that would break NDJSON.
    expect(lines.every((l) => !l.startsWith(' '))).toBe(true);
  });

  it('--watch text mode prints the dashboard body on each cycle', async () => {
    embedHealthy = true;
    llmHealthy = true;
    await statusCommand().parseAsync(['node', 'cli', '--watch', '100', '--max-polls', '2']);
    const text = stdout.join('');
    // "ClawMind status" header appears once per cycle. With 2
    // cycles we expect 2 occurrences.
    const headerCount = text.split('ClawMind status').length - 1;
    expect(headerCount).toBe(2);
    // The api-base line shows up too on each cycle.
    expect(text).toContain('api       : http://127.0.0.1:7410');
  });

  it('--watch --max-polls --check sets exit code 2 when the FINAL snapshot is unhealthy', async () => {
    // Both probes down for the whole loop -> last snapshot is
    // unhealthy -> exit code 2 reflects that. We do not exit
    // early on the first bad probe because the watcher is a
    // monitoring tool, not a circuit breaker — but the final
    // state still drives the exit code under --check.
    embedHealthy = false;
    llmHealthy = false;
    await statusCommand().parseAsync(['node', 'cli', '--watch', '100', '--max-polls', '2', '--check', '--json']);
    expect(process.exitCode).toBe(2);
    const lines = stdout.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const doc = JSON.parse(line);
      expect(doc.ok).toBe(false);
    }
  });

  it('--watch --max-polls --check exits 0 when the FINAL snapshot is healthy (recovery cycle counts)', async () => {
    // First cycle is observed unhealthy, second cycle observed
    // healthy. The watcher's contract is "final state drives
    // --check exit code" so an operator can run
    //   clawmind status --watch 5000 --max-polls 5 --check
    // and use the result to know "is the index UP RIGHT NOW".
    let polls = 0;
    embedHealthy = false;
    llmHealthy = false;
    const realHealth = (await import('../src/runtime.js')).buildRuntime;
    void realHealth; // just to silence the import
    // Flip both healthy after the first cycle by overriding the
    // module-level switches mid-test. The mock reads them on
    // each call, so by the time the second polling cycle's
    // probes fire, both will report ok.
    const flip = setTimeout(() => {
      embedHealthy = true;
      llmHealthy = true;
      polls += 1;
    }, 80);
    flip.unref?.();
    await statusCommand().parseAsync(['node', 'cli', '--watch', '120', '--max-polls', '2', '--check', '--json']);
    clearTimeout(flip);
    // The last snapshot was healthy, so --check is satisfied.
    expect(process.exitCode).toBeFalsy();
    const lines = stdout.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    // The first snapshot is the unhealthy one; the second one
    // shows recovery.
    expect(JSON.parse(lines[0]!).ok).toBe(false);
    expect(JSON.parse(lines[1]!).ok).toBe(true);
  });

  it('--watch rejects sub-100ms intervals up front (no polling, exit 1)', async () => {
    // A typo'd --watch 0 would melt CPU on a probe loop; --watch 50
    // would hammer the providers faster than they can plausibly
    // respond. The 100ms floor protects both classes of mistake.
    await statusCommand().parseAsync(['node', 'cli', '--watch', '0']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('status failed: --watch interval must be >= 100ms');
    // No polling cycles fired (no body written to stdout).
    expect(stdout.join('')).toBe('');
  });

  it('--max-polls rejects non-positive values up front (exit 1)', async () => {
    // --max-polls 0 silently degrading to "no cap" would defeat
    // the entire purpose of the flag (which is to bound the
    // loop). Reject it cleanly.
    await statusCommand().parseAsync(['node', 'cli', '--watch', '100', '--max-polls', '0']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('status failed: --max-polls value must be a positive integer');
    expect(stdout.join('')).toBe('');
  });

  it('--max-polls without --watch is silently ignored (one-shot path runs once and exits)', async () => {
    // The flag's companion (--watch) is absent — silently ignore
    // and fall through to the one-shot path. Matches the precedent
    // set by `digest run --slim` without --json.
    embedHealthy = true;
    llmHealthy = true;
    await statusCommand().parseAsync(['node', 'cli', '--max-polls', '5', '--json']);
    // Single JSON document — the one-shot shape, not the
    // NDJSON-per-cycle shape.
    const text = stdout.join('').trim();
    const doc = JSON.parse(text);
    expect(doc.workspace).toBe('/tmp/workspace');
    // No trailing newlines suggesting multiple lines.
    expect(text.split('\n')).toHaveLength(1);
  });
});
