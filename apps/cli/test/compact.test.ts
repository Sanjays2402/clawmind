import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `compact` calls compactStore() with the runtime. We mock buildRuntime
// to skip the LanceDB / BM25 / manifest warmup and stub compactStore
// to return a controlled report so we can pin the byte layout of every
// emit shape (text, --json, --json --slim) without touching real
// state. Mirrors the reindex / watch / ingest test mocking pattern.

let lastCompactArg: unknown = null;
let mockReport = {
  scanned: 0,
  removed: 0,
  kept: 0,
  removedPaths: [] as string[],
  dryRun: false,
};

vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    manifest: {}, bm25: {}, bm25File: '/tmp/bm25.json',
    lance: {}, env: {},
  }),
}));

vi.mock('@clawmind/ingest', () => ({
  compactStore: async (opts: unknown) => {
    lastCompactArg = opts;
    return mockReport;
  },
}));

import { compactCommand } from '../src/commands/compact.js';

describe('compact cli --json --slim', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    lastCompactArg = null;
    mockReport = {
      scanned: 12,
      removed: 3,
      kept: 9,
      removedPaths: ['/a.md', '/b.md', '/c.md'],
      dryRun: false,
    };
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
    const flags = compactCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
    // --json must still be there (compose contract).
    expect(flags).toContain('--json');
    // --dry-run too (the preview-the-compact path that pairs naturally with --slim).
    expect(flags).toContain('--dry-run');
  });

  it('--json --slim emits the 4-integer {scanned, removed, kept, dryRun} shape', async () => {
    // The headline contract: exactly four fields, all integers
    // (plus dryRun which is a bool, but the shape signature is
    // 4-key). The per-path removedPaths array is GONE — this is
    // the whole point of --slim, and a regression that leaked
    // the array back in would defeat the slim contract.
    await compactCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const out = stdout.join('');
    const doc = JSON.parse(out);
    expect(doc).toEqual({
      scanned: 12,
      removed: 3,
      kept: 9,
      dryRun: false,
    });
    // The legacy `removedPaths` MUST be absent so a downstream
    // dashboard parser does not have to handle the variant.
    expect('removedPaths' in doc).toBe(false);
  });

  it('--json --slim is single-line JSON with a trailing newline (NDJSON-friendly)', async () => {
    // The slim shape is the cron-snapshot contract — `while true;
    // do clawmind compact --dry-run --json --slim; sleep 60; done`
    // must produce clean NDJSON. We pin: no embedded newlines in
    // the body, exactly one trailing newline so each emission is
    // a complete line.
    await compactCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const out = stdout.join('');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1)).not.toContain('\n');
    // No indentation — single-line JSON.stringify (no indent).
    expect(out).not.toContain('  "');
  });

  it('--json --slim preserves the sum-equals-total invariant scanned === removed + kept', async () => {
    // The invariant is the math foundation a downstream `jq`
    // consumer can verify without re-reading the per-path array.
    // The slim shape MUST keep it intact across every fixture; a
    // regression that broke it would be observable from the slim
    // shape alone (which is the whole point of the cron-dashboard
    // probe). The fixture above is 12 === 3 + 9.
    await compactCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const doc = JSON.parse(stdout.join(''));
    expect(doc.scanned).toBe(doc.removed + doc.kept);
  });

  it('--dry-run --json --slim preserves dryRun=true (preview snapshot)', async () => {
    // The dryRun key is the family-wide preview/live disambiguation
    // — mirrors `forget --json --slim` byte-for-byte. A dashboard
    // polling BOTH `compact --dry-run --json --slim` AND `compact
    // --json --slim` into the same NDJSON stream uses this key to
    // distinguish which run is which.
    mockReport = {
      scanned: 5,
      removed: 2,
      kept: 3,
      removedPaths: ['/x.md', '/y.md'],
      dryRun: true,
    };
    await compactCommand().parseAsync(['node', 'cli', '--dry-run', '--json', '--slim']);
    const doc = JSON.parse(stdout.join(''));
    expect(doc.dryRun).toBe(true);
    // The compactStore call was made with dryRun:true so the
    // mutation path is skipped (we check the captured arg).
    const arg = lastCompactArg as { dryRun?: boolean };
    expect(arg.dryRun).toBe(true);
  });

  it('--json --slim with zero removals still emits the 4-integer shape (no special-case)', async () => {
    // A workspace with nothing to compact must still produce a
    // parseable slim payload. The dashboard must not have to
    // special-case the empty path.
    mockReport = {
      scanned: 100,
      removed: 0,
      kept: 100,
      removedPaths: [],
      dryRun: false,
    };
    await compactCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const doc = JSON.parse(stdout.join(''));
    expect(doc).toEqual({ scanned: 100, removed: 0, kept: 100, dryRun: false });
    // Still preserves the invariant on the zero-removal path.
    expect(doc.scanned).toBe(doc.removed + doc.kept);
  });

  it('--json --slim wins over the full --json payload when set (slim wins, no removedPaths leak)', async () => {
    // The precedence contract: --slim trumps the legacy full
    // --json payload. The operator who passes both gets the slim
    // shape (and nothing leaks the removedPaths array back).
    mockReport = {
      scanned: 50,
      removed: 5,
      kept: 45,
      removedPaths: ['/p1.md', '/p2.md', '/p3.md', '/p4.md', '/p5.md'],
      dryRun: false,
    };
    await compactCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const out = stdout.join('');
    expect(out).not.toContain('removedPaths');
    expect(out).not.toContain('/p1.md');
    expect(out).not.toContain('/p2.md');
  });

  it('--json (without --slim) keeps the indented full payload (no regression)', async () => {
    // The pre-existing --json path must stay byte-faithful — the
    // full report with the removedPaths array, indent=2, multi-
    // line. The slim shape is opt-in; without --slim the operator
    // gets exactly what they got before this commit.
    await compactCommand().parseAsync(['node', 'cli', '--json']);
    const out = stdout.join('');
    expect(out).toContain('"removedPaths"');
    expect(out).toContain('/a.md');
    expect(out).toContain('"scanned": 12');
    // The indented JSON has multiple newlines (indent=2 inserts
    // one per key).
    const newlineCount = (out.match(/\n/g) ?? []).length;
    expect(newlineCount).toBeGreaterThan(3);
  });

  it('--slim without --json is silently ignored (text mode unchanged)', async () => {
    // --slim is a JSON-only modifier. Used without --json the text
    // mode renderer is untouched — an accidental `--slim` in a
    // script does not silently switch to JSON. Mirrors `stats
    // --slim` and `stats --compact` byte-for-byte.
    await compactCommand().parseAsync(['node', 'cli', '--slim']);
    const out = stdout.join('');
    // The text-mode head ("compacted scanned=12 removed=3 kept=9")
    // is still there.
    expect(out).toContain('scanned=12');
    expect(out).toContain('removed=3');
    expect(out).toContain('kept=9');
    // It is NOT JSON.
    expect(out.trim().startsWith('{')).toBe(false);
  });
});
