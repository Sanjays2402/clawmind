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

describe('watch cli startup banner', () => {
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

  it('emits an NDJSON banner to stderr in text mode', async () => {
    // The text-mode startup line ("Watching /tmp/r") still goes to
    // stdout for the operator; the banner is the parallel
    // log-scrape signal on stderr.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    const errLines = stderr.join('').trim().split('\n');
    // One line on stderr — the banner — exactly one JSON document
    // with kind=banner.
    expect(errLines).toHaveLength(1);
    const parsed = JSON.parse(errLines[0]!);
    expect(parsed.kind).toBe('banner');
    expect(parsed.root).toBe('/tmp/r');
    expect(typeof parsed.ts).toBe('string');
    // Sanity: the ts is a parseable ISO date.
    expect(Number.isFinite(Date.parse(parsed.ts))).toBe(true);
    // The text-mode operator line stays on stdout — not stderr.
    expect(stdout.join('')).toContain('Watching /tmp/r');
  });

  it('emits the banner to stderr in --json mode too (so log scrapers see restarts regardless of stdout format)', async () => {
    // --json mode dumps the "watching" event to stdout as NDJSON.
    // The banner must STILL fire on stderr so a stderr-tailing
    // scraper detects restarts without having to parse the
    // (potentially noisy) stdout NDJSON stream.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--json']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    const errLines = stderr.join('').trim().split('\n');
    expect(errLines).toHaveLength(1);
    const banner = JSON.parse(errLines[0]!);
    expect(banner.kind).toBe('banner');
    expect(banner.root).toBe('/tmp/r');
    // Stdout still carries the existing "watching" event (separate
    // shape, kind=watching, NOT kind=banner).
    const stdoutLine = stdout.join('').trim();
    const stdoutParsed = JSON.parse(stdoutLine);
    expect(stdoutParsed.kind).toBe('watching');
  });

  it('banner is a single complete line (trailing newline, no internal newlines, parseable JSON)', async () => {
    // The line-oriented contract: exactly one '\n' at the end,
    // nothing else. A scraper splitting on '\n' must get one row
    // per banner — never a partial line.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    const err = stderr.join('');
    // Exactly one newline at the end.
    expect(err.endsWith('\n')).toBe(true);
    // Strip the trailing newline; nothing internal.
    expect(err.slice(0, -1)).not.toContain('\n');
    // The body parses cleanly.
    expect(() => JSON.parse(err.trim())).not.toThrow();
  });

  it('banner does NOT fire on the --debounce validation error path (no half-started process to mark)', async () => {
    // A misconfigured invocation should not pollute the journal
    // with a banner event — there is no actual process to
    // correlate the restart marker against, the command just
    // exits non-zero before the runtime even spins up.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', '0']);
    expect(process.exitCode).toBe(1);
    // The only stderr writes here are the validation error line —
    // no banner JSON document should be present.
    expect(stderr.join('')).not.toContain('"kind":"banner"');
  });

  it('banner respects an absolute root argument (uses the resolved target, not the raw argv)', async () => {
    // expand() is mocked to be identity, but the contract we test
    // here is that the banner carries the SAME resolved root that
    // was used to start the watcher — so a log correlator sees
    // the same path in both the banner and the per-file events.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/some/abs/path']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    const banner = JSON.parse(stderr.join('').trim());
    expect(banner.root).toBe('/some/abs/path');
    expect(lastWatcherOpts?.root).toBe('/some/abs/path');
  });
});

describe('watch cli --quiet', () => {
  // --quiet / -q suppresses the per-file event chatter (the gray
  // `add /foo.md` / `change /bar.ts` chatter in text mode, and the
  // per-event NDJSON documents in --json mode) while keeping the
  // startup banner on stderr AND the "Watching <root>" stdout line.
  // The natural cron use is a watcher restarted by cron whose
  // journal only needs the restart marker, not the 100/sec event
  // chatter from a tight `npm install` burst.
  //
  // We exercise the option by reaching into the onEvent callback
  // that startWatcher captured in lastWatcherOpts, invoking it
  // directly, and asserting the resulting stdout. This is the
  // cleanest way to test the suppression: the production code path
  // (chokidar -> debounce -> onEvent) is the same in test and in
  // production, and the only thing the cli owns is what onEvent
  // writes when called.
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

  it('exposes --quiet on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--quiet');
  });

  it('exposes -q as the short form (mirrors the substring-filter -q used elsewhere in the cli)', () => {
    const short = watchCommand().options.map((o) => o.short).filter(Boolean);
    expect(short).toContain('-q');
  });

  it('suppresses the text-mode per-file event line when --quiet is set', async () => {
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--quiet']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    // Reset stdout AFTER the parseAsync so the test only observes
    // what the simulated onEvent writes, not the startup line.
    stdout.length = 0;
    const onEvent = lastWatcherOpts?.onEvent as ((k: string, p: string) => void) | undefined;
    expect(typeof onEvent).toBe('function');
    onEvent!('change', '/tmp/r/foo.md');
    expect(stdout.join('')).toBe('');
  });

  it('suppresses the --json per-event NDJSON document when --quiet is set', async () => {
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--json', '--quiet']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    // Drop the startup "watching" line so the assertion below only
    // observes the per-event window.
    stdout.length = 0;
    const onEvent = lastWatcherOpts?.onEvent as ((k: string, p: string) => void) | undefined;
    expect(typeof onEvent).toBe('function');
    onEvent!('add', '/tmp/r/bar.ts');
    expect(stdout.join('')).toBe('');
  });

  it('still emits the startup banner on stderr when --quiet is set (restart marker stays)', async () => {
    // The whole point of --quiet is to suppress the chatter while
    // keeping the restart marker. We assert the stderr banner fired
    // exactly like the no-quiet path.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--quiet']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    const banner = JSON.parse(stderr.join('').trim());
    expect(banner.kind).toBe('banner');
    expect(banner.root).toBe('/tmp/r');
  });

  it('still prints the operator-facing "Watching <root>" stdout line when --quiet is set (text mode)', async () => {
    // The startup line is the visual confirmation an interactive
    // operator gets that the watcher came up. --quiet only kills
    // the per-file chatter — NOT the startup line.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--quiet']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    expect(stdout.join('')).toContain('Watching /tmp/r');
  });

  it('without --quiet, the per-file event line DOES fire (regression: --quiet must not be the default)', async () => {
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    stdout.length = 0;
    const onEvent = lastWatcherOpts?.onEvent as ((k: string, p: string) => void) | undefined;
    onEvent!('change', '/tmp/r/baz.md');
    // Default text mode writes "<kind> <path>\n" in gray (the
    // styling is mocked-away in this test environment but the
    // content is the assertion that matters).
    expect(stdout.join('')).toContain('change /tmp/r/baz.md');
  });

  it('-q is the short alias for --quiet (suppresses text-mode chatter)', async () => {
    // The -q short form is what an operator types in a shell
    // pipeline; we verify it carries the same suppression contract.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '-q']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    stdout.length = 0;
    const onEvent = lastWatcherOpts?.onEvent as ((k: string, p: string) => void) | undefined;
    onEvent!('change', '/tmp/r/foo.md');
    expect(stdout.join('')).toBe('');
  });

  it('--quiet composes with --debounce (forwards debounce verbatim, suppresses chatter)', async () => {
    // The two flags address orthogonal concerns: --debounce shapes
    // re-ingest cadence, --quiet shapes the operator-facing stream.
    // They should compose cleanly — verify debounceMs still arrives
    // at the watcher and that the chatter is still suppressed.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--debounce', '1500', '--quiet']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    expect(lastWatcherOpts?.debounceMs).toBe(1500);
    stdout.length = 0;
    const onEvent = lastWatcherOpts?.onEvent as ((k: string, p: string) => void) | undefined;
    onEvent!('change', '/tmp/r/baz.md');
    expect(stdout.join('')).toBe('');
  });
});
