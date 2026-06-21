import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { statsCommand } from '../src/commands/stats.js';

const sampleReport = {
  totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
  byNamespace: [
    {
      namespace: 'memory',
      files: 10,
      chunks: 100,
      bytes: 10_000,
      oldestIngestedAt: null,
      newestIngestedAt: null,
      // 6 extensions so we can exercise --top with values both below and
      // above the natural length.
      extensions: [
        { ext: 'md', count: 50 },
        { ext: 'txt', count: 20 },
        { ext: 'json', count: 15 },
        { ext: 'yaml', count: 8 },
        { ext: 'csv', count: 4 },
        { ext: 'log', count: 3 },
      ],
    },
    { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [{ ext: 'json', count: 5 }] },
    { namespace: 'projects', files: 15, chunks: 150, bytes: 15_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [{ ext: 'ts', count: 15 }] },
  ],
  generatedAt: 0,
};

describe('stats cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let captured: string[];
  let originalWrite: typeof process.stdout.write;
  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((c: string) => { captured.push(String(c)); return true; }) as never;
    globalThis.fetch = (async () => new Response(JSON.stringify(sampleReport), { status: 200 })) as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalWrite;
  });

  it('emits full report as json without filter', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json']);
    const out = JSON.parse(captured.join(''));
    expect(out.totals.namespaces).toBe(3);
    expect(out.byNamespace).toHaveLength(3);
  });

  it('-q substring filters namespaces and recomputes totals', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'sess']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace).toHaveLength(1);
    expect(out.byNamespace[0].namespace).toBe('sessions');
    expect(out.totals).toEqual({ files: 5, chunks: 50, bytes: 5_000, namespaces: 1 });
  });

  it('-q is case-insensitive', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'MEM']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual(['memory']);
  });

  it('-q with no matches yields empty list and zeroed totals', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'nope']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace).toHaveLength(0);
    expect(out.totals).toEqual({ files: 0, chunks: 0, bytes: 0, namespaces: 0 });
  });

  it('text mode renders only the filtered namespace', async () => {
    await statsCommand().parseAsync(['node', 'cli', '-q', 'proj']);
    const text = captured.join('');
    expect(text).toContain('projects');
    expect(text).not.toContain('memory ');
    expect(text).not.toContain('sessions ');
  });

  it('--top caps the extensions list to N entries in json mode', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--top', '2']);
    const out = JSON.parse(captured.join(''));
    const memory = out.byNamespace.find((n: { namespace: string }) => n.namespace === 'memory');
    expect(memory.extensions).toHaveLength(2);
    expect(memory.extensions.map((e: { ext: string }) => e.ext)).toEqual(['md', 'txt']);
    // Smaller namespaces unaffected when they have fewer entries than the cap.
    const projects = out.byNamespace.find((n: { namespace: string }) => n.namespace === 'projects');
    expect(projects.extensions).toHaveLength(1);
  });

  it('--top defaults to 4 when omitted', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json']);
    const out = JSON.parse(captured.join(''));
    const memory = out.byNamespace.find((n: { namespace: string }) => n.namespace === 'memory');
    expect(memory.extensions).toHaveLength(4);
  });

  it('--top with a value larger than the natural length yields all entries', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--top', '100']);
    const out = JSON.parse(captured.join(''));
    const memory = out.byNamespace.find((n: { namespace: string }) => n.namespace === 'memory');
    expect(memory.extensions).toHaveLength(6);
  });

  it('--top with garbage (0, negative, non-numeric) falls back to the default of 4', async () => {
    // A user typo like `--top 0` would silently zero out the breakdown if we
    // forwarded the value as-is. We clamp to the default instead so the
    // command remains useful.
    for (const bad of ['0', '-3', 'abc']) {
      captured.length = 0;
      await statsCommand().parseAsync(['node', 'cli', '--json', '--top', bad]);
      const out = JSON.parse(captured.join(''));
      const memory = out.byNamespace.find((n: { namespace: string }) => n.namespace === 'memory');
      expect(memory.extensions).toHaveLength(4);
    }
  });

  it('--top is reflected in the text-mode bracket summary', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--top', '2']);
    const text = captured.join('');
    // The bracket carries the two highest-count extensions only.
    expect(text).toContain('[md:50 txt:20]');
    expect(text).not.toContain('json:15');
  });

  it('--sort files orders namespaces by file count desc', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'files']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'projects', // 15 files
      'memory',   // 10 files
      'sessions', // 5 files
    ]);
  });

  it('--sort chunks orders namespaces by chunk count desc', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'chunks']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'projects', // 150 chunks
      'memory',   // 100 chunks
      'sessions', // 50 chunks
    ]);
  });

  it('--sort bytes orders namespaces by byte count desc', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'bytes']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'projects', // 15000
      'memory',   // 10000
      'sessions', // 5000
    ]);
  });

  it('--sort defaults to namespace (preserves API order)', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json']);
    const out = JSON.parse(captured.join(''));
    // Same order as the sampleReport.
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'memory', 'sessions', 'projects',
    ]);
  });

  it('--sort is case-insensitive', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'FILES']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace[0].namespace).toBe('projects');
  });

  it('--sort with an unknown key fails cleanly with a non-zero exit code', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('stats failed: unknown --sort key "banana"');
    expect(err).toContain('expected: files, chunks, bytes, namespace');
    process.exitCode = 0;
  });

  it('--tsv emits one tab-separated row per namespace in the API order', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--tsv']);
    const out = captured.join('');
    // Default sort is "namespace" => the API order is preserved
    // (memory, sessions, projects). newestIngestedAt is null in the
    // sample, so the last column is empty (but the tab before it stays
    // so column indices line up for `cut`/`awk`).
    expect(out).toBe(
      'memory\t10\t100\t10000\t\n' +
      'sessions\t5\t50\t5000\t\n' +
      'projects\t15\t150\t15000\t\n',
    );
    // tsv is meant to be machine-readable: no ANSI codes, no header row.
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).not.toMatch(/^namespace\t/);
  });

  it('--tsv emits the epoch ms when newestIngestedAt is set', async () => {
    // Override fetch for this single case with a payload that has a timestamp.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 2, chunks: 4, bytes: 1000, namespaces: 1 },
      byNamespace: [{
        namespace: 'memory', files: 2, chunks: 4, bytes: 1000,
        oldestIngestedAt: 1700000000000, newestIngestedAt: 1700000123456,
        extensions: [{ ext: 'md', count: 2 }],
      }],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--tsv']);
    expect(captured.join('')).toBe('memory\t2\t4\t1000\t1700000123456\n');
  });

  it('--tsv respects --sort by ranking rows by the chosen metric', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '--sort', 'files']);
    const rows = captured.join('').trim().split('\n').map((r) => r.split('\t')[0]);
    expect(rows).toEqual(['projects', 'memory', 'sessions']);
  });

  it('--tsv emits nothing (clean empty stream) when no namespaces match -q', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '-q', 'nope']);
    expect(captured.join('')).toBe('');
  });

  it('--json --compact emits a single-line JSON document (no indentation) with a trailing newline', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--compact']);
    const out = captured.join('');
    // Exactly one newline, at the very end. The body itself is a single
    // line — no indentation, no internal newlines anywhere in the
    // document. This is the property NDJSON snapshot scripts rely on.
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1)).not.toContain('\n');
    // Still valid JSON with the same content as the indented form.
    const parsed = JSON.parse(out);
    expect(parsed.totals.namespaces).toBe(3);
    expect(parsed.byNamespace).toHaveLength(3);
    // The indented version has indentation; the compact one must not.
    expect(out).not.toContain('  "');
  });

  it('--json (without --compact) keeps the indented shape (no regression)', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json']);
    const out = captured.join('');
    // The default indented JSON has multiple newlines (one per key).
    // We assert at least one indented `"namespace":` line as a cheap
    // proof the indent=2 shape is preserved.
    expect(out).toContain('\n  "totals":');
    expect(out).toContain('\n  "byNamespace":');
  });

  it('--compact alone (without --json) leaves text mode unchanged', async () => {
    // --compact only takes effect with --json. Used without it, the
    // text-mode renderer is untouched so an accidental `--compact` in a
    // script does not silently switch to JSON.
    await statsCommand().parseAsync(['node', 'cli', '--compact']);
    const text = captured.join('');
    // The text-mode banner is still present.
    expect(text).toContain('30 files, 300 chunks');
    // It is NOT JSON.
    expect(text.trim().startsWith('{')).toBe(false);
  });

  it('--json --compact preserves --top, --sort and -q filters', async () => {
    // The compact path is purely a stringify shape switch — every other
    // option must still apply to the report before it is emitted.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--compact', '--sort', 'files', '--top', '2', '-q', 'mem']);
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.byNamespace).toHaveLength(1);
    expect(parsed.byNamespace[0].namespace).toBe('memory');
    expect(parsed.byNamespace[0].extensions).toHaveLength(2);
  });

  it('--since keeps only namespaces whose newestIngestedAt predates the cutoff and recomputes totals', async () => {
    // Override the default fetch with a payload that has real
    // timestamps so we can exercise the filter. Two namespaces are
    // older than the cutoff (memory: 2025-01-01, projects:
    // 2025-06-15), one is newer (sessions: 2026-06-20). With
    // --since 2026-01-01 the filter keeps memory + projects and
    // drops sessions; totals recompute to reflect just those two.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'memory', files: 10, chunks: 100, bytes: 10_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2025-01-01T00:00:00Z'),
          extensions: [{ ext: 'md', count: 10 }] },
        { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-06-20T00:00:00Z'),
          extensions: [{ ext: 'json', count: 5 }] },
        { namespace: 'projects', files: 15, chunks: 150, bytes: 15_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2025-06-15T00:00:00Z'),
          extensions: [{ ext: 'ts', count: 15 }] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--since', '2026-01-01']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace).sort()).toEqual(['memory', 'projects']);
    // Totals must reflect the filtered subset (memory 10 + projects 15 = 25 files, etc.).
    expect(out.totals).toEqual({ files: 25, chunks: 250, bytes: 25_000, namespaces: 2 });
  });

  it('--since keeps namespaces with newestIngestedAt=null (never indexed are trivially stale)', async () => {
    // The whole point of --since is "find namespaces that have gone
    // stale". A namespace that was never ingested is the most extreme
    // case and must NOT be filtered out.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 2, chunks: 4, bytes: 1000, namespaces: 2 },
      byNamespace: [
        { namespace: 'fresh', files: 1, chunks: 2, bytes: 500,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-06-20T00:00:00Z'),
          extensions: [{ ext: 'md', count: 1 }] },
        { namespace: 'never', files: 1, chunks: 2, bytes: 500,
          oldestIngestedAt: null, newestIngestedAt: null,
          extensions: [{ ext: 'md', count: 1 }] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--since', '2026-01-01']);
    const out = JSON.parse(captured.join(''));
    // `never` (newestIngestedAt=null) stays in. `fresh` (post-cutoff)
    // is filtered out.
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual(['never']);
    expect(out.totals.namespaces).toBe(1);
  });

  it('--since with no matches yields empty list and zeroed totals (mirrors -q semantics)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 5, chunks: 50, bytes: 5_000, namespaces: 1 },
      byNamespace: [
        { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-06-20T00:00:00Z'),
          extensions: [{ ext: 'json', count: 5 }] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--since', '2020-01-01']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace).toHaveLength(0);
    expect(out.totals).toEqual({ files: 0, chunks: 0, bytes: 0, namespaces: 0 });
  });

  it('--since composes with -q (intersection of name match and stale cutoff)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'memory', files: 10, chunks: 100, bytes: 10_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2025-01-01T00:00:00Z'),
          extensions: [{ ext: 'md', count: 10 }] },
        { namespace: 'memos', files: 5, chunks: 50, bytes: 5_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-06-20T00:00:00Z'),
          extensions: [{ ext: 'md', count: 5 }] },
        { namespace: 'projects', files: 15, chunks: 150, bytes: 15_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2025-06-15T00:00:00Z'),
          extensions: [{ ext: 'ts', count: 15 }] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    // `-q mem` matches memory + memos; `--since 2026-01-01` keeps only
    // namespaces older than the cutoff. The intersection is just
    // memory (memos is too fresh).
    await statsCommand().parseAsync(['node', 'cli', '--json', '-q', 'mem', '--since', '2026-01-01']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual(['memory']);
    expect(out.totals).toEqual({ files: 10, chunks: 100, bytes: 10_000, namespaces: 1 });
  });

  it('--since with an invalid ISO date errors cleanly with a non-zero exit code', async () => {
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await statsCommand().parseAsync(['node', 'cli', '--json', '--since', 'banana']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(process.exitCode).toBe(1);
    const err = stderrBuf.join('');
    expect(err).toContain('stats failed: --since value "banana" is not a valid ISO date');
    process.exitCode = 0;
  });
});

describe('stats cli error handling', () => {
  let originalFetch: typeof globalThis.fetch;
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  beforeEach(() => {
    stdout = [];
    stderr = [];
    originalFetch = globalThis.fetch;
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
  });

  it('reports a clean message when the api is unreachable', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as never;
    await statsCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stats failed: cannot reach');
    expect(out).toContain('fetch failed');
    // No node stack frames should leak: the operator sees one styled line.
    expect(out).not.toContain('at ');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'storage corrupt' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await statsCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stats failed: (500');
    expect(out).toContain('storage corrupt');
  });

  it('falls back to raw text when the error body is not json', async () => {
    globalThis.fetch = (async () =>
      new Response('plain text error', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as never;
    await statsCommand().parseAsync(['node', 'cli']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('stats failed: (502');
    expect(out).toContain('plain text error');
  });
});
