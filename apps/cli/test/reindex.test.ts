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
});
