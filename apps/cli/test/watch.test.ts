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
let discoverFilesCalls: string[] = [];
let ingestPathsCalls: Array<{ files: string[]; opts: Record<string, unknown> }> = [];
// Default fixture: every call to discoverFiles returns these two
// paths and every ingest reports processed=2, chunks=10, skipped=0.
// Individual tests can override either by reassigning before calling
// parseAsync.
let discoverFilesFiles: string[] = ['/tmp/r/a.md', '/tmp/r/b.md'];
let ingestPathsResult: { processed: number; chunks: number; skipped: number } = {
  processed: 2, chunks: 10, skipped: 0,
};
let ingestPathsImpl: ((files: string[], opts: Record<string, unknown>) => Promise<{ processed: number; chunks: number; skipped: number }>) | null = null;
// stat() shim for the --since path. Returns the configured mtime for
// any path that has an entry in `statMtimeMs`; throws ENOENT (which
// the production --since path swallows silently) for any path that
// does not.
let statMtimeMs: Record<string, number> = {};

vi.mock('node:fs/promises', async (importActual) => {
  const actual = await importActual<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: async (p: string) => {
      if (Object.prototype.hasOwnProperty.call(statMtimeMs, p)) {
        return { mtimeMs: statMtimeMs[p] } as never;
      }
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    },
  };
});

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
  discoverFiles: async (root: string) => {
    discoverFilesCalls.push(root);
    return discoverFilesFiles;
  },
  ingestPaths: async (files: string[], opts: Record<string, unknown>) => {
    ingestPathsCalls.push({ files, opts });
    if (ingestPathsImpl) return ingestPathsImpl(files, opts);
    return ingestPathsResult;
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

describe('watch cli --once', () => {
  // --once runs a single discoverFiles + ingestPaths pass under the
  // SAME discovery rules the chokidar watcher uses, then exits
  // cleanly. Lets cron use ONE code path for both scheduled
  // refreshes and live watching. Critically the chokidar watcher
  // is NOT installed — `lastWatcherOpts` must stay null because
  // startWatcher is never called. The startup banner DOES fire on
  // stderr so a log scraper sees the restart marker even on a
  // one-shot pass.
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastWatcherOpts = null;
    discoverFilesCalls = [];
    ingestPathsCalls = [];
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    ingestPathsResult = { processed: 2, chunks: 10, skipped: 0 };
    ingestPathsImpl = null;
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

  it('exposes --once on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--once');
  });

  it('--once runs discoverFiles + ingestPaths and exits cleanly (chokidar NEVER installed)', async () => {
    // This is the headline contract: --once must NOT call
    // startWatcher. The whole point of the flag is to share the
    // initial-scan code path with cron without the long-running
    // tail. We assert lastWatcherOpts stays null AND that the
    // discovery + ingest mocks were called exactly once each.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once']);
    expect(lastWatcherOpts).toBeNull();
    expect(discoverFilesCalls).toEqual(['/tmp/r']);
    expect(ingestPathsCalls).toHaveLength(1);
    expect(ingestPathsCalls[0]?.files).toEqual(['/tmp/r/a.md', '/tmp/r/b.md']);
  });

  it('--once --json emits the NDJSON ingest report shape (mirrors `ingest --json`)', async () => {
    discoverFilesFiles = ['/tmp/r/file1.md', '/tmp/r/file2.md', '/tmp/r/file3.md'];
    ingestPathsResult = { processed: 3, chunks: 12, skipped: 1 };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--json']);
    const parsed = JSON.parse(stdout.join('').trim()) as Record<string, unknown>;
    expect(parsed).toEqual({
      root: '/tmp/r',
      processed: 3,
      chunks: 12,
      skipped: 1,
    });
    // Single-line shape — no indent so cron can append to NDJSON logs.
    expect(stdout.join('').endsWith('\n')).toBe(true);
    expect(stdout.join('').trim()).not.toContain('\n');
  });

  it('--once text mode prints the cyan scan header and the green Indexed summary', async () => {
    // The text shape is meant for humans running the command
    // interactively. We assert the structural pieces — the cyan
    // "one-shot scan of <root>" header and the green "Indexed
    // <n> files, <n> chunks, skipped <n>" summary — rather than
    // pinning ANSI byte sequences which a future kleur upgrade
    // could shift around.
    ingestPathsResult = { processed: 5, chunks: 27, skipped: 2 };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once']);
    const out = stdout.join('');
    expect(out).toContain('one-shot scan of /tmp/r');
    expect(out).toContain('Indexed 5 files, 27 chunks, skipped 2');
  });

  it('--once still fires the startup banner on stderr (log scraper sees the restart marker)', async () => {
    // Critical contract: the banner is the journal-scrape signal
    // and MUST work in --once mode too. A cron that scrubs the
    // journal for `kind=banner` to detect "the periodic refresh
    // tick ran" relies on this exact behaviour.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once']);
    const banner = JSON.parse(stderr.join('').trim());
    expect(banner.kind).toBe('banner');
    expect(banner.root).toBe('/tmp/r');
    expect(typeof banner.ts).toBe('string');
  });

  it('--once does NOT print the "Watching <root>" stdout line (there is no long-running process to mark)', async () => {
    // The "Watching" line is the operator-facing "the watcher is
    // up" confirmation. It is misleading on a one-shot pass: the
    // process exits as soon as ingest finishes, so "Watching"
    // would be a lie. Assert it does not appear.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once']);
    expect(stdout.join('')).not.toContain('Watching');
  });

  it('--once forwards the ingest deps (lance/bm25/manifest/embed/embedModel)', async () => {
    // The ingest opts must carry every dependency the real
    // pipeline needs. We assert the keys are present rather than
    // pinning exact mock identities (which would be brittle).
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once']);
    const opts = ingestPathsCalls[0]?.opts ?? {};
    expect(opts).toHaveProperty('store');
    expect(opts).toHaveProperty('bm25');
    expect(opts).toHaveProperty('bm25File');
    expect(opts).toHaveProperty('manifest');
    expect(opts).toHaveProperty('embed');
    expect(opts).toHaveProperty('embedModel', 'test-model');
  });

  it('--once with zero discovered files still emits a clean report (processed=0)', async () => {
    discoverFilesFiles = [];
    ingestPathsResult = { processed: 0, chunks: 0, skipped: 0 };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--json']);
    const parsed = JSON.parse(stdout.join('').trim()) as { processed: number; chunks: number; skipped: number };
    expect(parsed.processed).toBe(0);
    expect(parsed.chunks).toBe(0);
    expect(parsed.skipped).toBe(0);
    // The discovery + ingest still ran (with an empty file set),
    // which is the right contract — the cron operator wants the
    // same "I checked and there was nothing" signal as a real
    // empty-workspace tick.
    expect(discoverFilesCalls).toEqual(['/tmp/r']);
    expect(ingestPathsCalls).toHaveLength(1);
    expect(ingestPathsCalls[0]?.files).toEqual([]);
  });

  it('--once composes with --debounce / --quiet silently (no rejection, no behavioural change)', async () => {
    // Accepting these flags silently lets a cron operator use a
    // single argv shape (`watch --once --quiet --debounce 500`)
    // for both modes without conditional plumbing. We confirm the
    // command exits cleanly and the report is still emitted —
    // proves --once short-circuits before the chokidar wiring
    // that would have parsed those flags.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--quiet', '--debounce', '500', '--json']);
    expect(lastWatcherOpts).toBeNull(); // never started chokidar
    const parsed = JSON.parse(stdout.join('').trim()) as { processed: number };
    expect(parsed.processed).toBe(2);
  });

  it('--once still validates --debounce up front (typo cannot sneak through the one-shot path)', async () => {
    // The --debounce validation fires BEFORE the --once branch
    // because we want the error message to be crisp on a typo.
    // An operator using `watch --once --debounce 0` may be moving
    // to the live path next; rejecting the typo on the one-shot
    // run lets them catch the bug immediately.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--debounce', '0']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('watch failed: --debounce value must be a positive integer');
    // Neither discovery nor ingest fired.
    expect(discoverFilesCalls).toEqual([]);
    expect(ingestPathsCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------
// --once --since: one-shot incremental refresh.
//
// The canonical cron flow:
//   clawmind watch --once --since "$(date -u -d '1 hour ago' +%FT%TZ)"
//
// Pairs the --once one-shot pass with the `ingest --since` mtime
// filter so a cron tick can ride out a quiet workspace without
// re-walking every file. The filter is applied AFTER discoverFiles()
// (same .clawmindignore + globs walked) but BEFORE the per-file
// ingest decision — exactly one stat() per discovered file, then
// the kept survivors are forwarded to ingestPaths().
// ---------------------------------------------------------------

describe('watch cli --once --since', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastWatcherOpts = null;
    discoverFilesCalls = [];
    ingestPathsCalls = [];
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    ingestPathsResult = { processed: 2, chunks: 10, skipped: 0 };
    ingestPathsImpl = null;
    statMtimeMs = {};
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

  it('exposes --since on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--since');
  });

  it('--once --since keeps only files whose mtime is at-or-after the cutoff (the rest are silently dropped before ingestPaths)', async () => {
    // /tmp/r/a.md modified 2026-06-15 (after cutoff -> kept).
    // /tmp/r/b.md modified 2026-04-01 (before cutoff -> dropped).
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2026-04-01T00:00:00Z'),
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01']);
    // discoverFiles still walked the full set (the cutoff is
    // applied client-side after the discovery walk, NOT inside
    // discoverFiles), so the operator's .clawmindignore + globs
    // logic is unchanged.
    expect(discoverFilesCalls).toEqual(['/tmp/r']);
    // ingestPaths received ONLY the kept survivor.
    expect(ingestPathsCalls).toHaveLength(1);
    expect(ingestPathsCalls[0]?.files).toEqual(['/tmp/r/a.md']);
  });

  it('--once --since cutoff is INCLUSIVE (mtime === cutoff is KEPT)', async () => {
    // A file modified exactly at the cutoff was "modified at the
    // cutoff" — the boundary an operator passing the previous
    // tick's wall-clock cares about. Exclusive bounds would
    // silently drop changes that happened in the same second as
    // the previous tick — anti-goal of the flag.
    const cutoff = Date.parse('2026-06-15T00:00:00Z');
    discoverFilesFiles = ['/tmp/r/exact.md', '/tmp/r/just-before.md'];
    statMtimeMs = {
      '/tmp/r/exact.md': cutoff,           // ON the bar
      '/tmp/r/just-before.md': cutoff - 1, // 1ms before -> dropped
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-15']);
    // /tmp/r/exact.md is kept; the >= comparison includes it.
    expect(ingestPathsCalls[0]?.files).toEqual(['/tmp/r/exact.md']);
  });

  it('--once --since with an invalid ISO date aborts cleanly BEFORE buildRuntime / discoverFiles fire', async () => {
    // The validation runs up front so a typo (`--since 2026-13-01`)
    // never wastes a runtime warmup, never walks the workspace,
    // never reaches ingest. Same precedent as `ingest --since` and
    // `reindex --since`.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('watch failed: --since value "banana" is not a valid ISO date');
    expect(discoverFilesCalls).toEqual([]);
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--once --since with stat() failures silently drops the failing files (cron log stays clean)', async () => {
    // stat() failures on individual files are non-fatal — the file
    // is dropped (it cannot be re-ingested anyway) and the rest
    // of the batch proceeds. Matches `ingest --since` byte-for-byte.
    discoverFilesFiles = ['/tmp/r/keep.md', '/tmp/r/missing.md'];
    statMtimeMs = {
      '/tmp/r/keep.md': Date.parse('2026-06-15T00:00:00Z'),
      // /tmp/r/missing.md has NO entry -> stat() throws ENOENT,
      // which the production --since path silently swallows.
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--json']);
    // Only the surviving keep.md is forwarded.
    expect(ingestPathsCalls[0]?.files).toEqual(['/tmp/r/keep.md']);
    // Clean exit — the stat() failure did NOT bubble up.
    expect(process.exitCode).toBeFalsy();
    // No stderr noise about the missing file (the cron log stays clean).
    expect(stderr.join('')).not.toContain('missing.md');
  });

  it('--once --since with the cutoff dropping every file still calls ingestPaths with an empty list (clean "I checked, nothing changed" tick)', async () => {
    // Empty workspace tick — a cron operator polling --since wants
    // the same "nothing to do" signal whether discoverFiles found
    // nothing OR every discovered file pre-dated the cutoff. The
    // pipeline still runs (ingestPaths([])) so the metric counters
    // increment normally.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2024-01-01T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2024-01-01T00:00:00Z'),
    };
    ingestPathsResult = { processed: 0, chunks: 0, skipped: 0 };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--json']);
    expect(ingestPathsCalls).toHaveLength(1);
    expect(ingestPathsCalls[0]?.files).toEqual([]);
    const parsed = JSON.parse(stdout.join('').trim()) as { processed: number };
    expect(parsed.processed).toBe(0);
  });

  it('--once --since validates BEFORE --debounce (both validations fire up front; --since wins when both are typo\'d)', async () => {
    // Both validations are up-front guards. We assert --since fires
    // first by mixing a valid --debounce with an invalid --since —
    // the error message should be the --since one. This pins the
    // validation order so a future re-ordering doesn't silently
    // change which error the operator sees.
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--debounce', '500', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('--since value "banana" is not a valid ISO date');
    // Debounce was valid so its message must NOT appear.
    expect(stderr.join('')).not.toContain('--debounce value must be');
  });
});

// ---------------------------------------------------------------
// --once --paths-only: pure preview. Emit the deduplicated list of
// files that WOULD be ingested (one path per line, no styling, no
// header) WITHOUT touching the lance/bm25/manifest. Mirrors
// `ingest --dry-run --paths-only` and `reindex --dry-run --paths-only`
// byte-for-byte. The natural cron use is
//   clawmind watch --once --since X --paths-only
// for a "what would the next scheduled refresh tick touch?" probe
// without spending any read/embed/upsert work.
// ---------------------------------------------------------------

describe('watch cli --once --paths-only', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastWatcherOpts = null;
    discoverFilesCalls = [];
    ingestPathsCalls = [];
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    ingestPathsResult = { processed: 2, chunks: 10, skipped: 0 };
    ingestPathsImpl = null;
    statMtimeMs = {};
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

  it('exposes --paths-only on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--paths-only');
  });

  it('--once --paths-only emits one path per line and SKIPS ingestPaths entirely', async () => {
    // The headline contract: --paths-only is a PURE preview. The
    // lance/bm25/manifest must not be touched. We assert
    // ingestPathsCalls stays empty (no metric counter increments,
    // no upserts) AND the path-per-line stream is on stdout.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only']);
    expect(ingestPathsCalls).toHaveLength(0);
    // discoverFiles STILL fired — the preview is "what would be
    // ingested" so the discovery walk has to happen.
    expect(discoverFilesCalls).toEqual(['/tmp/r']);
    const lines = stdout.join('').split('\n');
    // Three paths + trailing empty (from the final \n).
    expect(lines).toEqual(['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md', '']);
  });

  it('--once --paths-only composes with --since (only post-cutoff survivors are listed)', async () => {
    // /tmp/r/a.md modified 2026-06-15 (after cutoff -> kept).
    // /tmp/r/b.md modified 2026-04-01 (before cutoff -> dropped).
    // /tmp/r/c.md modified 2026-06-20 (after cutoff -> kept).
    // The preview list mirrors what `--once --since` (without
    // --paths-only) would have ingested — pin that the preview is
    // byte-faithful to the real refresh.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2026-04-01T00:00:00Z'),
      '/tmp/r/c.md': Date.parse('2026-06-20T00:00:00Z'),
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--paths-only']);
    expect(ingestPathsCalls).toHaveLength(0);
    const lines = stdout.join('').split('\n').filter(Boolean);
    expect(lines).toEqual(['/tmp/r/a.md', '/tmp/r/c.md']);
  });

  it('--once --paths-only with zero discovered files emits a clean empty stream (no header, no hint)', async () => {
    // Empty discovery is the most stress-tested case for an
    // xargs-safe contract: a downstream `xargs ls` on the empty
    // stream must do NOTHING (not produce "no such file or
    // directory" because we leaked a header / hint). We assert
    // stdout is exactly empty and stderr stays free of poisonous
    // "nothing to do" lines too.
    discoverFilesFiles = [];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only']);
    expect(stdout.join('')).toBe('');
    // Stderr only carries the banner (kind=banner), nothing else.
    const errLines = stderr.join('').trim().split('\n').filter(Boolean);
    expect(errLines).toHaveLength(1);
    expect(JSON.parse(errLines[0]!).kind).toBe('banner');
    // ingestPaths still skipped.
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--once --paths-only with cutoff dropping every file yields an empty stream (matches the empty-discovery contract)', async () => {
    // Every discovered file pre-dates the cutoff -> no survivors ->
    // empty stream. Same contract as the empty-discovery case so
    // the operator does not have to special-case the two empty
    // shapes in an xargs pipeline.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2024-01-01T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2024-01-01T00:00:00Z'),
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--paths-only']);
    expect(stdout.join('')).toBe('');
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--once --paths-only deduplicates the discovered set in arrival order (Set-backed)', async () => {
    // Pin the dedupe contract: the production discoverFiles()
    // returns a flat list, but if a future implementation leaks
    // duplicates (e.g. through symlinks or alternate path
    // resolution) the --paths-only output must still be unique
    // per path so an xargs consumer doesn't double-process. Order
    // matches first occurrence, NOT alphabetical, so the operator
    // can correlate the preview with the actual ingest sequence.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/a.md', '/tmp/r/c.md', '/tmp/r/b.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only']);
    const lines = stdout.join('').split('\n').filter(Boolean);
    expect(lines).toEqual(['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md']);
  });

  it('--once --paths-only wins over --json (paths-per-line beats JSON document with paths array)', async () => {
    // Same precedent as forget/search/related --paths-only short-
    // circuiting --json: a downstream `xargs` consumer wants
    // path-per-line, NOT a JSON wrapper. Mixing the flags
    // explicitly resolves to --paths-only winning.
    discoverFilesFiles = ['/tmp/r/x.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only', '--json']);
    const body = stdout.join('');
    // Path-per-line, no JSON wrapper.
    expect(body).toBe('/tmp/r/x.md\n');
    expect(() => JSON.parse(body)).toThrow();
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--paths-only without --once is silently ignored (live watcher emits per-event NDJSON, NOT a preview)', async () => {
    // Without --once, the live watcher path runs unchanged — chokidar
    // is installed (lastWatcherOpts captured) and the --paths-only
    // flag has no effect. The cli accepts it silently rather than
    // rejecting so a cron operator using a unified argv shape
    // across the two modes doesn't need conditional plumbing.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--paths-only']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    // The live watcher started (sentinel thrown from inside
    // startWatcher) — proves we did NOT short-circuit the
    // --paths-only branch in the live path.
    expect(lastWatcherOpts).not.toBeNull();
    expect(lastWatcherOpts?.root).toBe('/tmp/r');
  });

  it('--once --paths-only with an invalid --since aborts cleanly BEFORE the discovery walk', async () => {
    // The --since validation fires UP FRONT regardless of whether
    // --paths-only is set — a typo cannot silently degrade to
    // "preview the whole workspace" (which is the worst possible
    // failure mode for a flag whose purpose is to do less work).
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('--since value "banana" is not a valid ISO date');
    // Neither discovery nor ingest fired.
    expect(discoverFilesCalls).toEqual([]);
    expect(ingestPathsCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------
// --once --preview-json: structured JSON wrapper of the same
// preview set. The dashboard-friendly twin of --paths-only: where
// --paths-only short-circuits for xargs callers, --preview-json is
// the explicit "I want the JSON shape" path for dashboard / web-UI
// callers who want the structured `{root, count, files}` envelope.
// Same byte layout as `ingest --dry-run --json` and `reindex
// --dry-run --json` so a multi-command dashboard uses ONE parser
// across all three preview surfaces.
// ---------------------------------------------------------------

describe('watch cli --once --preview-json', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastWatcherOpts = null;
    discoverFilesCalls = [];
    ingestPathsCalls = [];
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    ingestPathsResult = { processed: 2, chunks: 10, skipped: 0 };
    ingestPathsImpl = null;
    statMtimeMs = {};
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

  it('exposes --preview-json on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--preview-json');
  });

  it('--once --preview-json emits the {root, count, files} envelope and SKIPS ingestPaths entirely', async () => {
    // The headline contract: --preview-json is a PURE preview. The
    // lance/bm25/manifest must not be touched (ingestPathsCalls
    // stays empty). The shape mirrors `ingest --dry-run --json`
    // exactly so a dashboard can use one parser across surfaces.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json']);
    expect(ingestPathsCalls).toHaveLength(0);
    // discoverFiles STILL fired — the preview is "what would be
    // ingested" so the discovery walk has to happen.
    expect(discoverFilesCalls).toEqual(['/tmp/r']);
    // Exactly one NDJSON line on stdout.
    const lines = stdout.join('').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]!);
    expect(doc).toEqual({
      root: '/tmp/r',
      count: 3,
      files: ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'],
    });
  });

  it('--once --preview-json composes with --since (only post-cutoff survivors land in files[])', async () => {
    // The files[] array is byte-faithful to what `--once --since`
    // (without --preview-json) would have ingested — same survivor
    // set, just wrapped in a JSON envelope.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2026-04-01T00:00:00Z'),
      '/tmp/r/c.md': Date.parse('2026-06-20T00:00:00Z'),
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--preview-json']);
    expect(ingestPathsCalls).toHaveLength(0);
    const doc = JSON.parse(stdout.join('').trim());
    expect(doc.root).toBe('/tmp/r');
    expect(doc.count).toBe(2);
    expect(doc.files).toEqual(['/tmp/r/a.md', '/tmp/r/c.md']);
  });

  it('--once --preview-json with zero survivors yields {root, count: 0, files: []} (parseable even when empty)', async () => {
    // Critical contract: the JSON shape is PRESERVED on the empty
    // case so `jq .count` always gets an integer. Unlike
    // --paths-only (which yields an empty stream), the JSON
    // consumer's parser never has to special-case the empty case.
    discoverFilesFiles = [];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json']);
    const body = stdout.join('').trim();
    // The line parses cleanly.
    const doc = JSON.parse(body);
    expect(doc).toEqual({ root: '/tmp/r', count: 0, files: [] });
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--once --preview-json deduplicates the discovered set in arrival order', async () => {
    // Same Set-backed dedupe as --paths-only — files[] must be
    // unique per path so a dashboard counter does not double-count
    // a symlink target. Order matches first occurrence (insertion
    // order, NOT alphabetical) so the dashboard can correlate the
    // preview with the actual ingest sequence.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/a.md', '/tmp/r/c.md', '/tmp/r/b.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json']);
    const doc = JSON.parse(stdout.join('').trim());
    expect(doc.count).toBe(3);
    expect(doc.files).toEqual(['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md']);
  });

  it('--once --paths-only WINS over --once --preview-json when both are passed', async () => {
    // Precedence is intentional: --paths-only is the older, simpler
    // contract for xargs callers — a script that grew --paths-only
    // first and then later added --preview-json (perhaps copy-
    // pasted from a different command) should keep getting the
    // path-per-line stream the script was built around. Same
    // precedent as `forget --paths-only` winning over `forget --json`.
    discoverFilesFiles = ['/tmp/r/x.md', '/tmp/r/y.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only', '--preview-json']);
    const body = stdout.join('');
    // Path-per-line, NOT JSON.
    expect(body).toBe('/tmp/r/x.md\n/tmp/r/y.md\n');
    expect(() => JSON.parse(body)).toThrow();
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--preview-json without --once is silently ignored (live watcher path is unchanged)', async () => {
    // The preview shape is meaningful only on the --once path.
    // Without --once, the live watcher runs unchanged: chokidar
    // installed (sentinel thrown), --preview-json has no effect.
    await expect(
      watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--preview-json']),
    ).rejects.toBeInstanceOf(StopWatchSentinel);
    expect(lastWatcherOpts).not.toBeNull();
    expect(lastWatcherOpts?.root).toBe('/tmp/r');
  });

  it('--once --preview-json with an invalid --since aborts cleanly BEFORE the discovery walk', async () => {
    // Same up-front validation as --paths-only: a --since typo
    // cannot silently degrade to "preview the whole workspace".
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('--since value "banana" is not a valid ISO date');
    expect(discoverFilesCalls).toEqual([]);
    expect(ingestPathsCalls).toHaveLength(0);
    // Stdout stays free of a half-emitted JSON document.
    expect(stdout.join('')).toBe('');
  });

  it('--once --preview-json emits single-line JSON (NDJSON-friendly: no embedded newlines)', async () => {
    // The envelope must be a single line so an NDJSON consumer
    // tailing the dashboard's preview log can split on '\n' and
    // get one document per line — same precedent as digest run
    // --slim and status --watch --json snapshots.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json']);
    const body = stdout.join('');
    // Exactly one trailing newline, none embedded.
    expect(body.endsWith('\n')).toBe(true);
    expect(body.slice(0, -1)).not.toContain('\n');
  });
});

// ---------------------------------------------------------------
// --once --preview-json --slim: dashboard probe shape `{count,
// since}` that drops `root` AND `files[]` entirely. The classic
// cron use is `clawmind watch --once --since <iso> --preview-json
// --slim` polled every minute as a "is the watcher seeing
// anything" probe without paying the per-file path list. On a
// workspace with thousands of files matching the cutoff, the full
// --preview-json payload can be hundreds of kilobytes; the slim
// shape is ~40 bytes regardless.
// ---------------------------------------------------------------

describe('watch cli --once --preview-json --slim', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastWatcherOpts = null;
    discoverFilesCalls = [];
    ingestPathsCalls = [];
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    ingestPathsResult = { processed: 2, chunks: 10, skipped: 0 };
    ingestPathsImpl = null;
    statMtimeMs = {};
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

  it('exposes --slim on the command surface', () => {
    const flags = watchCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--once --preview-json --slim emits the {count, since} 2-key shape and SKIPS ingestPaths entirely', async () => {
    // Headline contract: 2 keys exactly, count = post-dedupe length,
    // since = null when not passed. lance/bm25/manifest untouched
    // (ingestPathsCalls stays empty — same pure-preview semantics
    // as the regular --preview-json path).
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json', '--slim']);
    expect(ingestPathsCalls).toHaveLength(0);
    // discoverFiles STILL fired — we still walked the workspace.
    expect(discoverFilesCalls).toEqual(['/tmp/r']);
    const doc = JSON.parse(stdout.join('').trim());
    expect(doc).toEqual({ count: 3, since: null });
    // The legacy `root` and `files` MUST be absent so a downstream
    // dashboard parser does not have to handle the variant.
    expect('root' in doc).toBe(false);
    expect('files' in doc).toBe(false);
  });

  it('--once --preview-json --slim composes with --since (post-cutoff survivors count, cutoff echoed)', async () => {
    // The slim count is the SURVIVORS of the mtime filter. The
    // since echo lets a multi-cutoff dashboard identify the row.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/c.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2026-04-01T00:00:00Z'),
      '/tmp/r/c.md': Date.parse('2026-06-20T00:00:00Z'),
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--preview-json', '--slim']);
    expect(ingestPathsCalls).toHaveLength(0);
    const doc = JSON.parse(stdout.join('').trim());
    expect(doc).toEqual({ count: 2, since: '2026-06-01' });
  });

  it('--once --preview-json --slim with zero survivors emits {count: 0, since}', async () => {
    // An empty discovery is the cron-probe sweet spot: a watcher
    // polled at 1Hz wants the "0 to do" signal as a parseable
    // single line, not a special-case empty stream (which is the
    // --paths-only contract).
    discoverFilesFiles = [];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json', '--slim']);
    const doc = JSON.parse(stdout.join('').trim());
    expect(doc).toEqual({ count: 0, since: null });
  });

  it('--once --preview-json --slim with cutoff dropping every file yields {count: 0, since}', async () => {
    // Same shape as the empty-discovery case: the dashboard parser
    // does NOT need to distinguish "no files at all" from "all
    // files pre-date the cutoff" — both report count=0.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    statMtimeMs = {
      '/tmp/r/a.md': Date.parse('2024-01-01T00:00:00Z'),
      '/tmp/r/b.md': Date.parse('2024-01-01T00:00:00Z'),
    };
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--since', '2026-06-01', '--preview-json', '--slim']);
    const doc = JSON.parse(stdout.join('').trim());
    expect(doc).toEqual({ count: 0, since: '2026-06-01' });
  });

  it('--once --preview-json --slim dedupes the discovered set (count matches the deduped length)', async () => {
    // Same Set-backed dedupe as --paths-only / --preview-json:
    // the slim count must report the UNIQUE path count, not the
    // raw discovery list length. A dashboard counter wired off
    // `count > N` would be lied to if we leaked duplicates.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md', '/tmp/r/a.md', '/tmp/r/c.md', '/tmp/r/b.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json', '--slim']);
    const doc = JSON.parse(stdout.join('').trim());
    // 5 discovered, 3 unique.
    expect(doc.count).toBe(3);
  });

  it('--once --preview-json --slim is single-line JSON with a trailing newline (NDJSON-friendly)', async () => {
    // The slim shape is the cron-snapshot contract. `while true;
    // do clawmind watch --once --since X --preview-json --slim;
    // sleep 60; done` must produce clean NDJSON. We pin: no
    // embedded newlines in the body, exactly one trailing newline.
    discoverFilesFiles = ['/tmp/r/a.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json', '--slim']);
    const out = stdout.join('');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1)).not.toContain('\n');
    // No indentation — single-line JSON.stringify.
    expect(out).not.toContain('  "');
  });

  it('--once --paths-only WINS over --once --preview-json --slim (pipeline trumps dashboard)', async () => {
    // The precedence contract: --paths-only stays the pipeline-
    // friendly older contract for xargs callers. A script that
    // grew --paths-only first and later added --preview-json
    // --slim (perhaps copy-pasted from a different command) must
    // keep getting the path-per-line stream the script was built
    // around. Same precedent as --paths-only winning over
    // --preview-json without --slim.
    discoverFilesFiles = ['/tmp/r/x.md', '/tmp/r/y.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--paths-only', '--preview-json', '--slim']);
    const body = stdout.join('');
    // Path-per-line, NOT JSON.
    expect(body).toBe('/tmp/r/x.md\n/tmp/r/y.md\n');
    expect(() => JSON.parse(body)).toThrow();
    expect(ingestPathsCalls).toHaveLength(0);
  });

  it('--slim without --preview-json is silently ignored (regular --once ingest report still emits)', async () => {
    // --slim is a --preview-json modifier. Used without it on the
    // --once path, the regular ingest report (text or --json) is
    // emitted unchanged. We assert ingestPaths DID fire (no pure-
    // preview short-circuit) and the slim shape is NOT on stdout.
    discoverFilesFiles = ['/tmp/r/a.md', '/tmp/r/b.md'];
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--slim']);
    // ingestPaths fired (slim alone is a no-op without --preview-json).
    expect(ingestPathsCalls).toHaveLength(1);
    // Stdout has the text-mode ingest report, NOT the slim JSON.
    const out = stdout.join('');
    expect(out).not.toMatch(/^\{/);
    expect(out).toContain('Indexed');
  });

  it('--once --preview-json --slim with an invalid --since aborts cleanly BEFORE the discovery walk', async () => {
    // Same up-front validation as --paths-only / --preview-json:
    // a --since typo cannot silently degrade to "probe the whole
    // workspace" (which is the worst possible failure mode for a
    // flag whose purpose is to do less work).
    await watchCommand().parseAsync(['node', 'cli', '/tmp/r', '--once', '--preview-json', '--slim', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('--since value "banana" is not a valid ISO date');
    expect(discoverFilesCalls).toEqual([]);
    expect(ingestPathsCalls).toHaveLength(0);
    // Stdout stays free of a half-emitted JSON document.
    expect(stdout.join('')).toBe('');
  });
});
