import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We mock the deps the ingest command pulls in so the test does not
// spin up MLX / LanceDB / OpenAI and does not actually walk the
// filesystem. Critically we capture the `files` array that ingestPaths
// receives so we can assert exactly which paths survived the --since
// filter — that's the contract this commit ships and the regression
// surface a future change has to honour.
let lastDiscoverArg: string | null = null;
let lastIngestPathsArg: string[] | null = null;
let lastIngestRootArg: string | null = null;
let mockDiscovered: string[] = [];
let mockMtimes: Record<string, number> = {};

vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    env: { CLAWMIND_WORKSPACE: '/tmp/workspace', CLAWMIND_EMBED_MODEL: 'test-model' },
    workspace: '/tmp/workspace',
    manifest: {}, bm25: {}, bm25File: '/tmp/bm25.json',
    lance: {}, embed: {}, llm: {},
  }),
}));

vi.mock('@clawmind/ingest', () => ({
  discoverFiles: async (root: string) => {
    lastDiscoverArg = root;
    return mockDiscovered;
  },
  ingestPaths: async (files: string[]) => {
    lastIngestPathsArg = files;
    return { processed: files.length, skipped: 0, chunks: files.length * 10 };
  },
  ingestRoot: async (root: string) => {
    lastIngestRootArg = root;
    return { processed: mockDiscovered.length, skipped: 0, chunks: mockDiscovered.length * 10 };
  },
}));

vi.mock('@clawmind/config', () => ({
  expand: (p: string) => p,
  loadEnv: () => ({ CLAWMIND_WORKSPACE: '/tmp/workspace' }),
}));

// node:fs/promises.stat must reflect our controlled mtimes so the
// --since filter is deterministic across test runs.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    stat: async (p: string) => {
      const m = mockMtimes[p];
      if (m === undefined) {
        // Files with no mtime fixture: treat as "stat failed" so we
        // exercise the silent-skip branch.
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return { mtimeMs: m } as unknown as Awaited<ReturnType<typeof actual.stat>>;
    },
  };
});

// ora returns a spinner-like object; the action calls .start() / .succeed()
// / .text =. We stub it so no actual terminal escapes are emitted during
// the test, which keeps the captured stdout clean.
vi.mock('ora', () => ({
  default: () => ({
    start() { return this; },
    succeed(_msg?: string) { return this; },
    set text(_v: string) { /* noop */ },
  }),
}));

import { ingestCommand } from '../src/commands/ingest.js';

describe('ingest cli --since', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastDiscoverArg = null;
    lastIngestPathsArg = null;
    lastIngestRootArg = null;
    mockDiscovered = [];
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

  it('exposes --since on the command surface', () => {
    const flags = ingestCommand().options.map((o) => o.long);
    expect(flags).toContain('--since');
  });

  it('filters discovered files by mtime cutoff (kept set is mtime >= cutoff)', async () => {
    // Anchor the cutoff at 2026-06-01T00:00:00Z. Three files:
    //  - new.md   mtime 2026-06-15  (kept)
    //  - old.md   mtime 2026-05-01  (dropped)
    //  - edge.md  mtime 2026-06-01  (kept, inclusive >= boundary)
    mockDiscovered = ['/tmp/workspace/new.md', '/tmp/workspace/old.md', '/tmp/workspace/edge.md'];
    mockMtimes = {
      '/tmp/workspace/new.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/workspace/old.md': Date.parse('2026-05-01T00:00:00Z'),
      '/tmp/workspace/edge.md': Date.parse('2026-06-01T00:00:00Z'),
    };
    await ingestCommand().parseAsync(['node', 'cli', '--since', '2026-06-01T00:00:00Z']);
    // ingestRoot must NOT have been called — the --since path uses
    // ingestPaths with the filtered list.
    expect(lastIngestRootArg).toBeNull();
    expect(lastIngestPathsArg).not.toBeNull();
    // Promise.all preserves discovery order through indexed parallel
    // resolution but the kept-array order depends on which stat
    // resolves first; assert by Set so the test does not depend on
    // micro-task scheduling.
    expect(new Set(lastIngestPathsArg!)).toEqual(new Set([
      '/tmp/workspace/new.md',
      '/tmp/workspace/edge.md',
    ]));
  });

  it('cutoff is INCLUSIVE (mtime === cutoff is kept, not dropped)', async () => {
    // The boundary semantic an operator passing --since cares about:
    // a file modified exactly at the cutoff must be INCLUDED. The
    // common cron use is "files since the previous run's wall-clock"
    // and exclusive-bounds would silently miss changes that happened
    // in the same second as the previous tick — exactly the
    // anti-goal of --since.
    mockDiscovered = ['/tmp/workspace/exact.md'];
    mockMtimes = {
      '/tmp/workspace/exact.md': Date.parse('2026-06-01T00:00:00Z'),
    };
    await ingestCommand().parseAsync(['node', 'cli', '--since', '2026-06-01T00:00:00Z']);
    expect(lastIngestPathsArg).toEqual(['/tmp/workspace/exact.md']);
  });

  it('skips files whose stat() fails (silently drops, does not crash the batch)', async () => {
    // The pipeline already swallows per-file load failures; --since
    // does the same for stat failures. The kept list excludes the
    // failing file but everything else proceeds.
    mockDiscovered = ['/tmp/workspace/good.md', '/tmp/workspace/missing.md'];
    mockMtimes = {
      '/tmp/workspace/good.md': Date.parse('2026-06-15T00:00:00Z'),
      // 'missing.md' has no mtime fixture; the mocked stat() throws ENOENT
    };
    await ingestCommand().parseAsync(['node', 'cli', '--since', '2026-06-01T00:00:00Z']);
    expect(lastIngestPathsArg).toEqual(['/tmp/workspace/good.md']);
    expect(process.exitCode).toBeFalsy();
  });

  it('--since with no files newer than the cutoff yields an empty kept set (still safe to call ingestPaths)', async () => {
    // The edge case: nothing changed since the cutoff. The action
    // must still complete cleanly — exit zero, ingestPaths called
    // with [] (so the manifest is loaded, the spinner ticks
    // through 0 of 0, and the success line emits "Indexed 0").
    // A cron job calling --since every minute will hit this case
    // hundreds of times an hour; if it crashed, the cron log
    // would fill with stack traces.
    mockDiscovered = ['/tmp/workspace/old.md'];
    mockMtimes = {
      '/tmp/workspace/old.md': Date.parse('2026-01-01T00:00:00Z'),
    };
    await ingestCommand().parseAsync(['node', 'cli', '--since', '2026-06-01T00:00:00Z', '--json']);
    expect(lastIngestPathsArg).toEqual([]);
    const out = JSON.parse(stdout.join(''));
    expect(out.processed).toBe(0);
    expect(process.exitCode).toBeFalsy();
  });

  it('rejects a non-ISO --since value cleanly (exit 1, no ingest call)', async () => {
    // A typo like --since 2026-13-01 must NOT silently degrade to
    // "no filter" (which would re-ingest the whole workspace —
    // exactly the anti-goal of --since). Abort with a clean error
    // and exit 1.
    mockDiscovered = ['/tmp/workspace/a.md'];
    await ingestCommand().parseAsync(['node', 'cli', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('ingest failed: --since value "banana" is not a valid ISO date');
    // Neither code path should have run.
    expect(lastIngestPathsArg).toBeNull();
    expect(lastIngestRootArg).toBeNull();
  });

  it('without --since, ingestRoot is used (no stat() walk happens)', async () => {
    // Regression: the legacy path must keep working byte-for-byte.
    // ingestRoot is the lighter-weight call (no per-file stat
    // pre-filter), so a non-cron user typing `clawmind ingest`
    // gets the same behaviour they had before --since shipped.
    mockDiscovered = ['/tmp/workspace/a.md', '/tmp/workspace/b.md'];
    await ingestCommand().parseAsync(['node', 'cli', '--json']);
    expect(lastIngestRootArg).toBe('/tmp/workspace');
    expect(lastIngestPathsArg).toBeNull();
    const out = JSON.parse(stdout.join(''));
    expect(out.processed).toBe(2);
  });

  it('--json emits {root, processed, chunks, skipped} with the post-filter counts', async () => {
    // The JSON payload reflects the filtered work, not the
    // pre-filter discovered set.
    mockDiscovered = ['/tmp/workspace/new.md', '/tmp/workspace/old.md'];
    mockMtimes = {
      '/tmp/workspace/new.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/workspace/old.md': Date.parse('2026-05-01T00:00:00Z'),
    };
    await ingestCommand().parseAsync(['node', 'cli', '--json', '--since', '2026-06-01T00:00:00Z']);
    const out = JSON.parse(stdout.join(''));
    expect(out.root).toBe('/tmp/workspace');
    expect(out.processed).toBe(1);
    // Mock ingestPaths multiplies count by 10 for chunks; the contract
    // we test is that the count reflects the filtered set, not the
    // pre-filter discovery.
    expect(out.chunks).toBe(10);
  });
});

describe('ingest cli --dry-run', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastDiscoverArg = null;
    lastIngestPathsArg = null;
    lastIngestRootArg = null;
    mockDiscovered = [];
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
    const flags = ingestCommand().options.map((o) => o.long);
    expect(flags).toContain('--dry-run');
    expect(flags).toContain('--paths-only');
  });

  it('--dry-run text mode emits the count header and gray path list (matches reindex --dry-run UX)', async () => {
    mockDiscovered = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run']);
    const out = stdout.join('');
    expect(out).toContain('would ingest 2 file(s) under /tmp/workspace');
    expect(out).toContain('/tmp/workspace/a.md');
    expect(out).toContain('/tmp/workspace/b.ts');
    // Rerun nudge so the operator knows the next step.
    expect(out).toContain('rerun without --dry-run');
    // Critically: neither ingest helper was called — the dry-run
    // path short-circuits before any I/O.
    expect(lastIngestPathsArg).toBeNull();
    expect(lastIngestRootArg).toBeNull();
  });

  it('--dry-run --paths-only emits exactly one path per line (xargs-safe, no header, no ANSI)', async () => {
    mockDiscovered = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only']);
    const out = stdout.join('');
    expect(out).toBe('/tmp/workspace/a.md\n/tmp/workspace/b.ts\n');
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).not.toContain('would ingest');
    expect(out).not.toContain('rerun without --dry-run');
  });

  it('--dry-run --json emits {root, count, files} with the discovered list', async () => {
    mockDiscovered = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts', '/tmp/workspace/c.json'];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run', '--json']);
    const out = JSON.parse(stdout.join(''));
    expect(out.root).toBe('/tmp/workspace');
    expect(out.count).toBe(3);
    expect(out.files).toEqual([
      '/tmp/workspace/a.md',
      '/tmp/workspace/b.ts',
      '/tmp/workspace/c.json',
    ]);
  });

  it('--dry-run composes with --since (preview the same set the live --since refresh would touch)', async () => {
    // This is the critical cron contract: a preview of an
    // incremental refresh has to show the incremental file set,
    // not the full discovery walk. We anchor the cutoff so old.md
    // gets dropped client-side and the dry-run prints only the
    // surviving file.
    mockDiscovered = ['/tmp/workspace/new.md', '/tmp/workspace/old.md'];
    mockMtimes = {
      '/tmp/workspace/new.md': Date.parse('2026-06-15T00:00:00Z'),
      '/tmp/workspace/old.md': Date.parse('2026-05-01T00:00:00Z'),
    };
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only', '--since', '2026-06-01T00:00:00Z']);
    expect(stdout.join('')).toBe('/tmp/workspace/new.md\n');
    // The live ingest helpers must NOT have been called — dry-run
    // is read-only.
    expect(lastIngestPathsArg).toBeNull();
    expect(lastIngestRootArg).toBeNull();
  });

  it('--dry-run with zero discovered files yields the count-zero header AND no rerun nudge', async () => {
    mockDiscovered = [];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run']);
    const out = stdout.join('');
    expect(out).toContain('would ingest 0 file(s) under /tmp/workspace');
    // No rerun nudge — there is nothing to rerun, and offering one
    // would imply the empty set was a problem the operator can fix.
    expect(out).not.toContain('rerun without --dry-run');
  });

  it('--dry-run --paths-only with zero files yields a clean empty stream (xargs-safe)', async () => {
    mockDiscovered = [];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only']);
    // Mirrors the reindex --dry-run --paths-only contract: empty
    // stream so `clawmind ingest --dry-run --paths-only | xargs ls`
    // does not poison ls.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--dry-run --paths-only wins over --json when both are set (mirrors reindex precedence)', async () => {
    // Same precedent as search --paths-only / reindex --paths-only:
    // pipeline-friendly trumps pretty output.
    mockDiscovered = ['/tmp/workspace/a.md', '/tmp/workspace/b.ts'];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run', '--paths-only', '--json']);
    expect(stdout.join('')).toBe('/tmp/workspace/a.md\n/tmp/workspace/b.ts\n');
  });

  it('--dry-run honours --since invalid date (aborts with the standard --since error, no dry-run output)', async () => {
    // The --since validation fires BEFORE the dry-run branch so a
    // typo still kills the run cleanly. This means the dry-run
    // path inherits the same "no silent degrade" property the
    // live --since path has — if the cutoff is wrong, the preview
    // never runs at all.
    mockDiscovered = ['/tmp/workspace/a.md'];
    await ingestCommand().parseAsync(['node', 'cli', '--dry-run', '--since', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderr.join('')).toContain('ingest failed: --since value "banana" is not a valid ISO date');
    // Critically: the dry-run header should NOT have printed. The
    // error is the only thing the operator sees.
    expect(stdout.join('')).toBe('');
  });

  it('without --dry-run, --paths-only is ignored (live ingest runs as normal)', async () => {
    // The --paths-only flag only makes sense paired with --dry-run.
    // Without --dry-run the live ingest helpers run and the regular
    // report is emitted. We assert ingestRoot got called (the
    // no-flag path) and that --paths-only did NOT silently
    // short-circuit the run.
    mockDiscovered = ['/tmp/workspace/a.md'];
    await ingestCommand().parseAsync(['node', 'cli', '--paths-only', '--json']);
    expect(lastIngestRootArg).toBe('/tmp/workspace');
    const out = JSON.parse(stdout.join(''));
    expect(out.processed).toBe(1);
  });
});
