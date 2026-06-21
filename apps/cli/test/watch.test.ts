import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We mock buildRuntime so the test does not spin up MLX / LanceDB /
// OpenAI, and we mock startWatcher so the test does not actually
// touch the filesystem. The watch command ends with a
// `await new Promise(() => undefined)` that would hang the test
// indefinitely; our mock throws a sentinel after capturing the
// options so the action body unwinds cleanly while still exposing
// every argument the real watcher would have received.
class StopWatchSentinel extends Error {}
let lastWatcherOpts: Record<string, unknown> | null = null;

vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    env: { CLAWMIND_API_HOST: '127.0.0.1', CLAWMIND_API_PORT: 7410, CLAWMIND_EMBED_MODEL: 'test-model' },
    workspace: '/tmp/workspace',
    manifest: {},
    bm25: {},
    bm25File: '/tmp/bm25.json',
    lance: {},
    embed: {},
    llm: {},
  }),
}));

vi.mock('@clawmind/ingest', () => ({
  startWatcher: (opts: Record<string, unknown>) => {
    lastWatcherOpts = opts;
    // Stop the action body BEFORE it reaches the never-resolving
    // hang promise so the test does not deadlock. The watch command
    // does not catch this throw — it bubbles out of parseAsync and
    // we assert on it below. Critically the captured `opts` is the
    // exact object that would have been passed to the real
    // watcher, so a downstream `expect(lastWatcherOpts.debounceMs)`
    // is byte-for-byte equivalent to the production wire-up.
    throw new StopWatchSentinel('stop');
  },
}));

vi.mock('@clawmind/config', () => ({
  expand: (p: string) => p,
  loadEnv: () => ({ CLAWMIND_API_HOST: '127.0.0.1', CLAWMIND_API_PORT: 7410 }),
}));

import { watchCommand } from '../src/commands/watch.js';

describe('watch cli --debounce', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastWatcherOpts = null;
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
  });

  it('exposes --debounce on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--debounce');
  });

  it('forwards --debounce as debounceMs to startWatcher', async () => {
    // The action throws after captureing opts so we await the
    // sentinel through expect.rejects rather than swallowing it.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', '250']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    expect(lastWatcherOpts?.debounceMs).toBe(250);
    expect(lastWatcherOpts?.root).toBe('/tmp/r');
  });

  it('omits debounceMs (undefined) when --debounce is not set so the watcher uses its built-in default', async () => {
    // Critical: we must NOT pass debounceMs=0 or some other sentinel
    // when the flag is absent — the watcher's own default (800ms)
    // only kicks in when the field is undefined (`??` fallback).
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    expect(lastWatcherOpts).not.toBeNull();
    expect(lastWatcherOpts?.debounceMs).toBeUndefined();
  });

  it('rejects --debounce 0 (would melt CPU during a git checkout burst)', async () => {
    // A value of 0 would re-ingest on every chokidar event. Reject
    // up front rather than silently disabling the debounce —
    // the operator almost certainly typed it wrong.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', '0']);
    expect(process.exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('watch failed: --debounce value must be a positive integer');
    // startWatcher must NOT have been called (the validation
    // short-circuits before the runtime even spins up).
    expect(lastWatcherOpts).toBeNull();
  });

  it('rejects a negative --debounce value', async () => {
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', '-100']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('watch failed: --debounce value must be a positive integer');
    expect(lastWatcherOpts).toBeNull();
  });

  it('rejects a non-numeric --debounce value', async () => {
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('watch failed: --debounce value must be a positive integer');
    expect(lastWatcherOpts).toBeNull();
  });

  it('forwards a high --debounce value verbatim (e.g. 3000ms for burst-heavy workflows)', async () => {
    // A typical use: `--debounce 3000` while running `npm install`
    // to ride out the burst of file events without N pointless
    // re-ingests. We just confirm the number flows through
    // unchanged — the watcher itself owns the meaning of the field.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', '3000']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    expect(lastWatcherOpts?.debounceMs).toBe(3000);
  });
});
