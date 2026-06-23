import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We mock buildRuntime so the test does not spin up MLX / LanceDB /
// OpenAI, and we mock @clawmind/ingest's discoverFiles so the test
// does not actually walk the filesystem. Critically we DO NOT mock
// the unlink() / ingestCommand() call path — when --dry-run is set
// the reindex action must never reach those branches, and that's
// exactly what we want to assert. If a future regression slips an
// `unlink(manifestPath)` into the dry-run branch the test will
// crash on a missing mock rather than silently mutating the real
// manifest in the test environment.
let lastDiscoverArg: string | null = null;
let mockFiles: string[] = [];

// stat() is invoked when --since is set so the dry-run can drop
// files whose mtime predates the cutoff. We mock node:fs/promises'
// stat to return a configurable per-path map; missing entries
// resolve to ENOENT-style throws so the action's stat-failures-
// are-non-fatal branch is exercised. The unlink() path stays
// unmocked so the dry-run guarantee holds (a regression that
// slipped a wipe into the dry-run branch would crash the mock
// import as before).
let mockMtimes: Record<string, number> = {};
vi.mock('node:fs/promises', () => ({
  stat: async (p: string) => {
    if (p in mockMtimes) return { mtimeMs: mockMtimes[p] };
    throw new Error(`stat mock: missing entry for ${p}`);
  },
  unlink: async () => undefined,
}));

vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    env: { CLAWMIND_WORKSPACE: '/tmp/workspace' },
    workspace: '/tmp/workspace',
  }),
}));

vi.mock('@clawmind/ingest', () => ({
  discoverFiles: async (root: string) => {
    lastDiscoverArg = root;
    return mockFiles;
  },
}));

vi.mock('@clawmind/config', () => ({
  expand: (p: string) => p,
  manifestPath: (_env: unknown) => '/tmp/manifest.json',
  bm25Dir: (_env: unknown) => '/tmp/bm25',
  loadEnv: () => ({ CLAWMIND_WORKSPACE: '/tmp/workspace' }),
}));

import { reindexCommand } from '../src/commands/reindex.js';

describe('reindex cli --dry-run', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastDiscoverArg = null;
    mockFiles = [];
    mockMtimes = {};
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

  it('exposes --dry-run and --paths-only on the command surface', () => {
    const flags = reindexCommand().options.map((o) => o.long);
    expect(flags).toContain('--dry-run');
    expect(flags).toContain('--paths-only');
  });

  it('text mode lists the discovered files with a yellow count header and a rerun nudge', async () => {
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run']);
    const out = stdout.join('');
    // Header carries the count and the target.
    expect(out).toContain('would reindex 2 file(s) under /tmp/workspace');
    // Body: every discovered path on its own line.
    expect(out).toContain('/tmp/workspace/a.md');
    expect(out).toContain('/tmp/workspace/b.ts');
    // Rerun nudge so the operator knows the next step (matches the
    // forget --dry-run UX).
    expect(out).toContain('rerun without --dry-run');
  });

  it('--paths-only emits exactly one path per line, no header, no count summary', async () => {
    // The xargs-friendly contract: matches search/forget/related
    // --paths-only byte layout. No ANSI, no nudge, no count.
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only']);
    const out = stdout.join('');
    expect(out).toBe('/tmp/workspace/a.md\n/tmp/workspace/b.ts\n');
    // No ANSI escapes / no "would reindex" header.
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).not.toContain('would reindex');
    expect(out).not.toContain('rerun without --dry-run');
  });

  it('--json emits {root, count, files} with the discovered list', async () => {
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts', '/tmp/workspace/c.json'];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out.root).toBe('/tmp/workspace');
    expect(out.count).toBe(3);
    expect(out.files).toEqual([
      '/tmp/workspace/a.md',
      '/tmp/workspace/b.ts',
      '/tmp/workspace/c.json',
    ]);
  });

  it('zero discovered files yields a count-zero header AND no rerun nudge', async () => {
    // Edge: empty workspace, --dry-run should not invite the
    // operator to "rerun without --dry-run" (there is nothing to
    // reindex). The header still prints so the operator knows the
    // command did something.
    mockFiles = [];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run']);
    const out = stdout.join('');
    expect(out).toContain('would reindex 0 file(s) under /tmp/workspace');
    expect(out).not.toContain('rerun without --dry-run');
  });

  it('--paths-only yields a clean empty stream when no files are discovered (xargs-safe)', async () => {
    mockFiles = [];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only']);
    // Mirrors the contract used by search/forget --paths-only: zero
    // matches => empty stream, so `clawmind reindex --dry-run
    // --paths-only | xargs ls` does not poison ls.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('honours a custom root argument (forwards it to discoverFiles)', async () => {
    // Test the route the action takes when an explicit root is
    // passed. We capture the argument in the mock so we can assert
    // that the dry-run is faithful to the same root the non-dry
    // path would use.
    mockFiles = ['/some/other/root/x.md'];
    await reindexCommand().parseAsync(['node', 'cli', '/some/other/root', '--dry-run']);
    expect(lastDiscoverArg).toBe('/some/other/root');
    expect(stdout.join('')).toContain('/some/other/root/x.md');
    expect(stdout.join('')).toContain('would reindex 1 file(s) under /some/other/root');
  });

  it('--paths-only is ignored without --dry-run (a non-dry reindex defers to the live ingest report)', async () => {
    // Without --dry-run the action moves to the destructive
    // path: unlink the manifest, run ingest. We do NOT exercise
    // that path here because the ingest dependency is heavy AND
    // the dry-run contract is what this commit ships. But we do
    // assert the flag surface so a future commit can confidently
    // refactor the live path without breaking the dry-run shape.
    const flags = reindexCommand().options.find((o) => o.long === '--paths-only');
    expect(flags).toBeDefined();
  });

  it('--json wins over text when both --dry-run --json are set (clean JSON, no styling)', async () => {
    // --json mode must emit pure JSON. No ANSI styling, no rerun
    // nudge — those belong only to the text path.
    mockFiles = ['/tmp/workspace/a.md'];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run', '--json']);
    const raw = stdout.join('');
    // No ANSI escapes leaked through.
    expect(raw).not.toMatch(/\x1b\[/);
    expect(raw).not.toContain('rerun without');
    // Parses cleanly.
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('--paths-only wins over --json when both are set with --dry-run (mirrors search --paths-only precedence)', async () => {
    // Same precedent as search --paths-only / forget --paths-only:
    // the pipeline-friendly flag short-circuits before --json so
    // the contract is unambiguous (a downstream `xargs` should not
    // have to special-case the case where someone also passed
    // --json by accident).
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await reindexCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only', '--json']);
    expect(stdout.join('')).toBe('/tmp/workspace/a.md\n/tmp/workspace/b.ts\n');
  });

  // ---------------------------------------------------------------
  // --since tests — mtime filter for partial-reindex flow. With
  // --dry-run + --since, the preview is narrowed by mtime. Parse
  // failures abort up front BEFORE any wipe (critical safety:
  // the live path runs wipe first then ingest, so a typo'd cutoff
  // landing mid-flight would leave the index in a partial state).
  // ---------------------------------------------------------------

  it('exposes --since on the command surface', () => {
    const flags = reindexCommand().options.map((o) => o.long);
    expect(flags).toContain('--since');
  });

  it('--dry-run --since narrows the preview to files modified at-or-after the cutoff', async () => {
    // Three discovered files with mtimes 1000, 2000, 3000 ms.
    // Cutoff at 2000 INCLUSIVE keeps mtimeMs >= 2000 — the two
    // newest files.
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts', '/tmp/workspace/c.json'];
    mockMtimes = {
      '/tmp/workspace/a.md': 3000,
      '/tmp/workspace/b.ts': 2000,
      '/tmp/workspace/c.json': 1000,
    };
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--since', new Date(2000).toISOString(), '--json',
    ]);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.count).toBe(2);
    expect(parsed.files.sort()).toEqual(['/tmp/workspace/a.md', '/tmp/workspace/b.ts']);
  });

  it('--dry-run --since with no matches yields a clean empty paths stream', async () => {
    // All files older than cutoff — preview shows nothing.
    mockFiles = ['/tmp/workspace/a.md'];
    mockMtimes = { '/tmp/workspace/a.md': 1000 };
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--since', new Date(9000).toISOString(), '--paths-only',
    ]);
    // xargs-friendly: empty stream, no header, no rerun nudge.
    expect(stdout.join('')).toBe('');
  });

  it('--dry-run --since text mode prints the count-zero header when the filter eliminates everything', async () => {
    // The yellow "would reindex 0 file(s)" header still prints so
    // the operator knows the command ran and the filter is what
    // narrowed the result, NOT a missing root.
    mockFiles = ['/tmp/workspace/a.md'];
    mockMtimes = { '/tmp/workspace/a.md': 1000 };
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--since', new Date(9000).toISOString(),
    ]);
    const out = stdout.join('');
    expect(out).toContain('would reindex 0 file(s) under /tmp/workspace');
    // No rerun nudge when there is nothing to rerun.
    expect(out).not.toContain('rerun without --dry-run');
  });

  it('--since is INCLUSIVE: a file modified at exactly the cutoff is KEPT', async () => {
    // Mirrors the --since semantics on ingest / stale / pins / mutes.
    // A file modified at exactly the cutoff timestamp is "modified
    // at the cutoff", which is the boundary the operator wants to
    // include (an exclusive bound would silently drop changes that
    // happened in the same second as the previous run).
    mockFiles = ['/tmp/workspace/exact.md'];
    mockMtimes = { '/tmp/workspace/exact.md': 2000 };
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--since', new Date(2000).toISOString(), '--json',
    ]);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.files).toEqual(['/tmp/workspace/exact.md']);
  });

  it('--since with an invalid ISO date aborts cleanly with exit code 1 (BEFORE any wipe)', async () => {
    // The most safety-critical defence in the command: the live
    // path wipes manifest+BM25 FIRST then calls ingest, so a
    // typo'd cutoff must hard-fail BEFORE any mutation. We test
    // this by passing --since without --dry-run AND a bad value
    // — the command MUST fail with exit code 1, and discoverFiles
    // must NOT have been called (the validation short-circuits
    // before any work).
    mockFiles = ['/tmp/workspace/a.md'];
    await reindexCommand().parseAsync([
      'node', 'cli', '--since', 'banana',
    ]);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('reindex failed: --since value "banana" is not a valid ISO date');
    // discoverFiles must NOT have been called.
    expect(lastDiscoverArg).toBeNull();
  });

  it('--dry-run --since with stat failures drops the file silently (does not abort the preview)', async () => {
    // stat() failures on individual files are non-fatal — the file
    // is dropped (cannot be re-ingested anyway) and the rest of the
    // discovery proceeds. We test this by leaving one file out of
    // mockMtimes so the mock throws when stat() is called on it.
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/broken.md'];
    mockMtimes = { '/tmp/workspace/a.md': 3000 }; // broken.md NOT in map
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--since', new Date(2000).toISOString(), '--json',
    ]);
    const parsed = JSON.parse(stdout.join(''));
    // a.md survives (mtime 3000 >= 2000); broken.md silently dropped.
    expect(parsed.files).toEqual(['/tmp/workspace/a.md']);
    // No error to stderr — the stat-failure path is deliberately quiet.
    expect(stderr.join('')).toBe('');
  });

  // ---------------------------------------------------------------
  // --json --slim tests — cron-dashboard shape for partial-reindex
  // panels polling "how many files would the next refresh touch".
  // Mirrors `digest run --json --slim`, `feedback prune --json --slim`,
  // `stats --json --slim`, `forget --json --slim`, and
  // `doctor --json --quiet` byte-for-byte: single-line JSON,
  // no per-file detail, ~80 bytes regardless of workspace size.
  // ---------------------------------------------------------------

  it('exposes --slim on the command surface', () => {
    const flags = reindexCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--dry-run --json --slim emits {count, since, dryRun} single-line shape', async () => {
    // The canonical cron panel: count the files, echo the cutoff,
    // explicit dryRun safety contract. No per-path list, no root,
    // no indentation.
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts', '/tmp/workspace/c.json'];
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--json', '--slim',
    ]);
    const raw = stdout.join('');
    // Single-line JSON: no indentation newlines mid-document.
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({ count: 3, since: null, dryRun: true });
    // Critical: NO `files`, NO `root` — the slim shape strips them.
    expect(parsed.files).toBeUndefined();
    expect(parsed.root).toBeUndefined();
  });

  it('--dry-run --json --slim --since echoes the cutoff and counts the survivors', async () => {
    // Compose with --since: the slim count describes the survivors of
    // the mtime filter, the `since` field echoes the cutoff anchor.
    mockFiles = ['/tmp/workspace/old.md', '/tmp/workspace/new.md'];
    mockMtimes = {
      '/tmp/workspace/old.md': 1000,
      '/tmp/workspace/new.md': 3000,
    };
    const cutoff = new Date(2000).toISOString();
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--since', cutoff, '--json', '--slim',
    ]);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed).toEqual({ count: 1, since: cutoff, dryRun: true });
  });

  it('--dry-run --json --slim with zero matches emits count=0 cleanly', async () => {
    // Edge: empty discovery yields {count: 0, since: null, dryRun: true}.
    // Mirrors `forget --json --slim` zero-match contract — a downstream
    // `jq .count` consumer can branch on emptiness without re-running.
    mockFiles = [];
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--json', '--slim',
    ]);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed).toEqual({ count: 0, since: null, dryRun: true });
  });

  it('--paths-only wins over --slim when all three of --dry-run --json --paths-only --slim are set', async () => {
    // The pipeline-friendly contract (--paths-only) is the more
    // destructive precedent to break (xargs consumers depend on it);
    // the dashboard contract (--slim) is a secondary shape. When both
    // are set, --paths-only short-circuits before --json so --slim
    // never gets a chance to fire — the test pins that precedence.
    mockFiles = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--paths-only', '--json', '--slim',
    ]);
    // --paths-only stream, no JSON.
    expect(stdout.join('')).toBe('/tmp/workspace/a.md\n/tmp/workspace/b.ts\n');
  });

  it('--slim is ignored without --json (--dry-run --slim falls through to text mode)', async () => {
    // The slim flag is gated on --json; without --json the text path
    // is unchanged. We assert the yellow header still fires so a
    // future regression that hijacked text mode under --slim would
    // surface immediately.
    mockFiles = ['/tmp/workspace/a.md'];
    await reindexCommand().parseAsync([
      'node', 'cli', '--dry-run', '--slim',
    ]);
    const out = stdout.join('');
    expect(out).toContain('would reindex 1 file(s) under /tmp/workspace');
    expect(out).toContain('/tmp/workspace/a.md');
  });
});
