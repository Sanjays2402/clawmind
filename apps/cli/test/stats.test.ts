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

  it('--paths emits per-namespace extensions one per line in API order with no styling or header', async () => {
    // sampleReport: memory has 6 exts (but --top defaults to 4 so we
    // see md, txt, json, yaml), sessions has 1 (json), projects has
    // 1 (ts). The walk is namespace order (memory, sessions,
    // projects), then ext order per namespace.
    await statsCommand().parseAsync(['node', 'cli', '--paths']);
    const out = captured.join('');
    expect(out).toBe('md\ntxt\njson\nyaml\njson\nts\n');
    // No ANSI, no banner ("30 files, 300 chunks ..."), no namespace
    // labels — just the bare extensions.
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).not.toContain('30 files');
    expect(out).not.toContain('memory');
  });

  it('--paths composes with -q (filter by namespace name first, then walk extensions)', async () => {
    // -q "mem" matches only the memory namespace, which has 4 ext
    // rows after the default --top=4 cap.
    await statsCommand().parseAsync(['node', 'cli', '--paths', '-q', 'mem']);
    expect(captured.join('')).toBe('md\ntxt\njson\nyaml\n');
  });

  it('--paths composes with --top (cap each namespace contribution before emit)', async () => {
    // --top 1 keeps the single dominant ext per namespace; the
    // composite stream becomes md / json / ts (the highest count in
    // each of memory, sessions, projects respectively).
    await statsCommand().parseAsync(['node', 'cli', '--paths', '--top', '1']);
    expect(captured.join('')).toBe('md\njson\nts\n');
  });

  it('--paths surfaces duplicate extensions across namespaces (no implicit dedupe)', async () => {
    // Both `memory` and `sessions` have a json extension in the
    // sample. --paths must emit `json` twice so a downstream
    // `grep -c json` counts the namespaces that contain that type.
    // (`sort -u` is left to the consumer if they want the unique
    // set.)
    await statsCommand().parseAsync(['node', 'cli', '--paths']);
    const lines = captured.join('').trim().split('\n');
    const jsonCount = lines.filter((l) => l === 'json').length;
    expect(jsonCount).toBe(2);
  });

  it('--paths with -q matching nothing yields a clean empty stream (no header, no ANSI)', async () => {
    // The contract mirrors --paths-only on the other commands: zero
    // matches means an empty stdout AND an empty stderr so `xargs`,
    // `wc -l`, etc. work without conditional skips.
    const stderrBuf: string[] = [];
    const origErr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((c: string) => { stderrBuf.push(String(c)); return true; }) as never;
    try {
      await statsCommand().parseAsync(['node', 'cli', '--paths', '-q', 'nope']);
    } finally {
      process.stderr.write = origErr;
    }
    expect(captured.join('')).toBe('');
    expect(stderrBuf.join('')).toBe('');
  });

  it('--paths short-circuits --json and --tsv (the pipeline-friendly contract wins when set)', async () => {
    // --paths takes precedence so an accidental combination still
    // yields the bare extension stream, not a JSON document or a
    // TSV table.
    await statsCommand().parseAsync(['node', 'cli', '--paths', '--json']);
    const out = captured.join('');
    expect(out).toBe('md\ntxt\njson\nyaml\njson\nts\n');
    expect(out.trim().startsWith('{')).toBe(false);
    expect(out.trim().startsWith('[')).toBe(false);
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

describe('stats cli --slim', () => {
  // --slim is a JSON-only shape switch: instead of the full
  // per-namespace metric blocks, emit a tight
  // `{stale: [<namespace>], total: N}` payload. The classic cron
  // use is `clawmind stats --json --slim --since <iso>` to answer
  // "which namespaces have gone stale at the namespace level"
  // without piping the full report through `jq` for the names.
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

  it('emits {stale, total} carrying just the namespace names from byNamespace', async () => {
    // The sample report has three namespaces: memory, sessions,
    // projects. --slim should pluck just the names and report the
    // length as total.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const out = JSON.parse(captured.join(''));
    expect(out.stale).toEqual(['memory', 'sessions', 'projects']);
    expect(out.total).toBe(3);
    // Critically the slim payload does NOT carry the per-namespace
    // metric blocks — that is the entire point of the flag.
    expect(out.byNamespace).toBeUndefined();
    expect(out.totals).toBeUndefined();
    expect(out.generatedAt).toBeUndefined();
  });

  it('emits a single-line JSON document (no indentation) so cron snapshots diff cleanly', async () => {
    // Cron pipelines append slim snapshots over time; each row must
    // be a single line so `diff`/`comm`/line-oriented tools work.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const raw = captured.join('');
    expect(raw.endsWith('\n')).toBe(true);
    // Exactly one newline at the very end — no internal newlines.
    expect(raw.slice(0, -1)).not.toContain('\n');
  });

  it('total === stale.length (invariant the slim contract pins)', async () => {
    // A downstream consumer must never have to reconcile the two —
    // total is the length of stale, end of story. We exercise it
    // both with the default report and with a -q-narrowed report.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '-q', 'mem']);
    const out = JSON.parse(captured.join(''));
    expect(out.stale).toEqual(['memory']);
    expect(out.total).toBe(out.stale.length);
    expect(out.total).toBe(1);
  });

  it('emits a clean {stale: [], total: 0} payload when no namespaces survive (jq .total branches on emptiness)', async () => {
    // The branching contract a cron pipeline relies on:
    //   `clawmind stats --json --slim --since X | jq -e '.total > 0'`
    // must produce a clean zero-total payload when nothing is
    // stale, not an empty array with the rest of the report shape
    // still attached. Pair with -q nope so we know the filter is
    // what eliminated everything (the underlying sample has 3).
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '-q', 'nope']);
    const out = JSON.parse(captured.join(''));
    expect(out.stale).toEqual([]);
    expect(out.total).toBe(0);
  });

  it('composes with --since (intersection: -q + --since narrow first, then slim emits the survivors)', async () => {
    // The natural cron pair. We supply a sample where some
    // namespaces have a real newestIngestedAt and some are null,
    // and assert the slim output reflects the post-filter survivors
    // (memory: null kept; sessions: 2025-12-31 kept; projects:
    // 2026-02-01 dropped).
    const payload = {
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'memory', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: Date.parse('2025-12-31T00:00:00Z'), extensions: [] },
        { namespace: 'projects', files: 15, chunks: 150, bytes: 15_000, oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-02-01T00:00:00Z'), extensions: [] },
      ],
      generatedAt: 0,
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--since', '2026-01-01']);
    const out = JSON.parse(captured.join(''));
    // memory (null) and sessions (Dec 2025) kept; projects (Feb 2026) dropped.
    expect(out.stale).toEqual(['memory', 'sessions']);
    expect(out.total).toBe(2);
  });

  it('--slim wins when both --slim and --compact are passed (slim already implies single-line output)', async () => {
    // Both flags ask for the JSON-on-one-line shape; --slim is the
    // stricter contract (it also reshapes the payload), so the slim
    // path wins. The output must be the slim shape, not the
    // compact-full-report shape.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--compact']);
    const out = JSON.parse(captured.join(''));
    expect(out.stale).toEqual(['memory', 'sessions', 'projects']);
    // No byNamespace block leaked through from the --compact path.
    expect(out.byNamespace).toBeUndefined();
  });

  it('--slim without --json is ignored (text mode still renders the table)', async () => {
    // --slim is a JSON-only contract. Used without --json it must
    // not break anything — text mode still emits the table.
    await statsCommand().parseAsync(['node', 'cli', '--slim']);
    const text = captured.join('');
    // Header line still emitted; --slim was a no-op in text mode.
    expect(text).toContain('files,');
    expect(text).toContain('namespaces');
  });

  // ---------------------------------------------------------------
  // --json --slim --tsv tests — awk-pipeline shape on the slim path.
  //
  // Mirrors the --tsv contract on the full stats but emits the
  // narrower 2-column `<namespace>\t<files>` shape: one row per
  // surviving namespace, no header, no totals row, no ANSI. The
  // natural cron use is `clawmind stats --json --slim --tsv
  // --since X | awk -F'\t' '$2 > 100'` — two filters in one
  // pipeline (staleness via --since, size via awk) without `jq`
  // needing to flatten the slim shape.
  // ---------------------------------------------------------------

  it('--json --slim --tsv emits one `<namespace>\\t<files>` row per surviving namespace', async () => {
    // sampleReport has three namespaces with files=10/5/15. The
    // slim-tsv shape must emit exactly those three rows, no header,
    // no totals line, no ANSI styling.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--tsv']);
    const out = captured.join('');
    expect(out).toBe('memory\t10\nsessions\t5\nprojects\t15\n');
    // No ANSI styling — slim-tsv must be cut/awk safe.
    expect(out).not.toMatch(/\x1b\[/);
    // No JSON braces leak through (this is NOT a JSON payload).
    expect(out).not.toContain('{');
    expect(out).not.toContain('"');
  });

  it('--json --slim --tsv composes with -q (substring filter narrows first, then tsv emits the survivors)', async () => {
    // The 2-filter pipeline pattern: -q narrows by namespace name
    // first (mirrors the full stats -q semantics), then the slim-tsv
    // shape emits the remaining rows. Pin the row order against the
    // input order (the API ordering carries through unchanged).
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--tsv', '-q', 'ess']);
    // Only 'sessions' contains the substring 'ess'.
    expect(captured.join('')).toBe('sessions\t5\n');
  });

  it('--json --slim --tsv with no survivors yields a clean empty stream (xargs/wc -l keep working)', async () => {
    // Zero matches must yield an empty stdout — NO trailing newline,
    // NO empty array marker, NO "no namespaces" hint. A downstream
    // `wc -l` must report 0 (not 1). Mirrors the pipeline-friendly
    // contract on every other --paths-only / --tsv variant.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--tsv', '-q', 'nope']);
    expect(captured.join('')).toBe('');
  });

  it('--json --slim --tsv composes with --since (cron canonical: namespace-level staleness + size filter in one pipeline)', async () => {
    // The most useful combo: --since narrows to stale namespaces
    // at the namespace level; the slim-tsv shape gives a downstream
    // awk a 2-column stream so the operator can ALSO filter by
    // file count without re-running stats. Reuses the composes-
    // with-since fixture above so the assertion mirrors the
    // existing slim+since test.
    const payload = {
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'memory', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: Date.parse('2025-12-31T00:00:00Z'), extensions: [] },
        { namespace: 'projects', files: 15, chunks: 150, bytes: 15_000, oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-02-01T00:00:00Z'), extensions: [] },
      ],
      generatedAt: 0,
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--tsv', '--since', '2026-01-01']);
    // memory (null kept), sessions (Dec 2025 kept), projects (Feb 2026 dropped).
    expect(captured.join('')).toBe('memory\t10\nsessions\t5\n');
  });

  it('--json --tsv without --slim still emits the JSON payload (regression: slim-tsv is gated on --slim being set)', async () => {
    // Existing behaviour: when --json is set without --slim, the
    // --tsv flag is currently SHADOWED by --json (the existing
    // --tsv text-mode emission is gated on `!opts.json`). The
    // slim-tsv variant is GATED on --slim, so this combination
    // (json+tsv with no slim) preserves the existing JSON-wins
    // contract for every existing caller. Without this regression
    // test, the slim-tsv path could accidentally swallow the
    // unrestricted json+tsv case too.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--tsv']);
    const out = captured.join('');
    // Output is valid JSON, NOT tab-separated rows.
    const parsed = JSON.parse(out) as { byNamespace: unknown[] };
    expect(Array.isArray(parsed.byNamespace)).toBe(true);
    expect(parsed.byNamespace).toHaveLength(3);
  });

  it('--tsv without --json emits the full 5-col per-namespace TSV (regression: text-mode --tsv unchanged)', async () => {
    // The existing 5-col TSV path: namespace, files, chunks, bytes,
    // newestIngestedAt. The slim-tsv contract MUST NOT regress this
    // — any existing pipeline `clawmind stats --tsv | cut -f2`
    // expecting `files` in column 2 keeps working.
    await statsCommand().parseAsync(['node', 'cli', '--tsv']);
    const out = captured.join('');
    expect(out.split('\n')[0]?.split('\t').length).toBe(5);
    // Three data rows (one per namespace).
    expect(out.trimEnd().split('\n').length).toBe(3);
  });

  it('--slim --tsv without --json is silently ignored (text-mode table still renders)', async () => {
    // Mirrors --slim's own contract: a JSON-shape modifier is a no-op
    // outside --json. A future operator who forgets --json must not
    // suddenly see a different output shape.
    await statsCommand().parseAsync(['node', 'cli', '--slim', '--tsv']);
    const out = captured.join('');
    // Without --json, the regular --tsv path fires — that emits the
    // full 5-col rows. The slim-tsv path is gated on --json.
    expect(out.split('\n')[0]?.split('\t').length).toBe(5);
  });

  // -----------------------------------------------------------------
  // --sort family-contract alignment: the family-wide canonical name
  // for the alphabetical sort is `name` (mirrors aliases list --sort
  // name / digest list --sort title etc.). Stats predates the family
  // contract and exposed `namespace`; this adds `name` as a TRUE
  // alias so the muscle memory carries. Both flags behave identically.
  //
  // Plus: the secondary-by-original-index sort on the numeric keys
  // (files / chunks / bytes) so cross-snapshot ties are deterministic
  // even on a hypothetical non-stable Array#sort implementation.
  // -----------------------------------------------------------------

  it('--sort name is a true alias for --sort namespace (both produce byte-identical output)', async () => {
    // `name` and `namespace` are the same operation: preserve API
    // order. Two consecutive runs over identical input must produce
    // byte-identical output regardless of which spelling the
    // operator chose.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'namespace']);
    const namespaceOut = captured.join('');
    captured.length = 0;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'name']);
    expect(captured.join('')).toBe(namespaceOut);
  });

  it('--sort name is case-insensitive (NAME / Name / name all accepted)', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'NAME']);
    const out = JSON.parse(captured.join(''));
    // Preserves the sampleReport's API order — same as --sort namespace.
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'memory', 'sessions', 'projects',
    ]);
  });

  it('--sort error message enumerates `name` as a valid key (alongside the existing four)', async () => {
    // The error path must now list `name` in the accepted set so an
    // operator who typo'd `--sort title` sees the full vocabulary
    // and can pick the canonical spelling.
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
    expect(err).toContain('expected: files, chunks, bytes, namespace, name');
    process.exitCode = 0;
  });

  it('--sort files ties preserve API order via secondary-by-original-index sort (cross-snapshot determinism)', async () => {
    // Two namespaces with identical files counts; the primary
    // --sort files comparator returns 0 on the tie, so the
    // secondary-by-original-index sort takes over and preserves
    // the API order. Without the secondary sort, V8's Array#sort
    // is stable in practice but the contract would be unenforced
    // — a future engine change or polyfill could in principle
    // de-tie equal-files namespaces in either order, and the
    // cron snapshot would drift between runs over identical input.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'first-tied', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'big', files: 15, chunks: 150, bytes: 15_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'second-tied', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'files']);
    const out = JSON.parse(captured.join(''));
    // big (15) leads; the two files===10 rows tie; secondary index
    // sort keeps API order: first-tied before second-tied.
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'big', 'first-tied', 'second-tied',
    ]);
  });

  it('--sort bytes determinism: two consecutive runs over identical-ties input produce byte-identical output', async () => {
    // Direct snapshot-diff property: a cron NDJSON snapshot stream
    // diffs cleanly only if identical input produces byte-identical
    // output. Pin this end-to-end so a regression in the sort
    // determinism surfaces as a hard test failure.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 20, chunks: 200, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'alpha', files: 5, chunks: 50, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'bravo', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'charlie', files: 5, chunks: 50, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'bytes']);
    const tick1 = captured.join('');
    captured.length = 0;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'bytes']);
    const tick2 = captured.join('');
    // Byte-identical output across runs — the snapshot-diff contract.
    expect(tick1).toBe(tick2);
    // And the tied trio's order matches API order (alpha, bravo,
    // charlie) — all three have bytes===10_000.
    const out = JSON.parse(tick1);
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'alpha', 'bravo', 'charlie',
    ]);
  });

  // --reverse: mirrors `stale --reverse` / `search --reverse` /
  // `related --reverse` / `feedback list --reverse` / `digest list
  // --reverse` / `aliases list --reverse` byte-for-byte. The 7th
  // command in the family-wide reverse-modifier sweep.
  //
  // Stats is the family-contract DEVIATION: --sort has a default
  // value of "namespace", so --reverse is ALWAYS active (it flips
  // against the default namespace order even with no --sort flag
  // passed). Every other --sort-bearing command treats --reverse
  // without --sort as a no-op because --sort is undefined by
  // default; stats predates the family-wide contract and has a
  // commander default it cannot easily shed. Pin both behaviours
  // explicitly so the deviation is documented in the tests.
  // -----------------------------------------------------------------

  it('exposes --reverse on the command surface', () => {
    const flags = statsCommand().options.map((o) => o.long);
    expect(flags).toContain('--reverse');
  });

  it('--sort files --reverse orders smallest-namespace first (flips the default biggest-first)', async () => {
    // Default --sort files is desc (biggest namespace first); --reverse
    // gives asc — "audit underutilized namespaces".
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'files', '--reverse']);
    const out = JSON.parse(captured.join(''));
    // sampleReport: memory=10, sessions=5, projects=15. Asc by files:
    // sessions (5), memory (10), projects (15).
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'sessions', 'memory', 'projects',
    ]);
  });

  it('--sort bytes --reverse orders smallest-bytes first', async () => {
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'bytes', '--reverse']);
    const out = JSON.parse(captured.join(''));
    // sessions (5_000), memory (10_000), projects (15_000).
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'sessions', 'memory', 'projects',
    ]);
  });

  it('--sort namespace --reverse orders desc alphabetical (flips the default API asc)', async () => {
    // sampleReport's API order is memory, sessions, projects (NOT
    // alphabetical — preserves whatever the server gave us). But
    // we have a sample where the API order IS alphabetical-friendly
    // enough to pin the reverse: just confirm the reverse flips the
    // input order byte-for-byte.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'aaa', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'mmm', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'zzz', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'namespace', '--reverse']);
    const out = JSON.parse(captured.join(''));
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual(['zzz', 'mmm', 'aaa']);
  });

  it('--sort name --reverse behaves identically to --sort namespace --reverse (true alias)', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 20, chunks: 200, bytes: 20_000, namespaces: 2 },
      byNamespace: [
        { namespace: 'a', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'b', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'name', '--reverse']);
    const fromName = captured.join('');
    captured.length = 0;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'namespace', '--reverse']);
    const fromNamespace = captured.join('');
    expect(fromName).toBe(fromNamespace);
  });

  it('--sort files --reverse preserves cross-snapshot determinism on ties (secondary index also reversed)', async () => {
    // Two namespaces tied at files=10. Under --reverse the secondary
    // index sort is ALSO reversed so the snapshot is byte-stable in
    // either direction.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 25, chunks: 250, bytes: 25_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'first-tied',  files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'loner',       files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'second-tied', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--sort', 'files', '--reverse']);
    const out = JSON.parse(captured.join(''));
    // Ascending: loner (5) first, then the two tied entries in
    // REVERSED original-index order (second-tied at idx 2 before
    // first-tied at idx 0).
    expect(out.byNamespace.map((n: { namespace: string }) => n.namespace)).toEqual([
      'loner', 'second-tied', 'first-tied',
    ]);
  });

  // ---------------------------------------------------------------
  // --json --slim --top tests — under --slim, --top re-targets from
  // the per-namespace extensions list (dropped in the slim shape)
  // to the `stale` namespace array. Mirrors `feedback list --top`,
  // `search --top`, and `digest list --top` family contracts where
  // --top caps the primary collection AFTER --sort ordering.
  // ---------------------------------------------------------------

  it('--json --slim --top N caps the `stale` array at the top N namespaces (after --sort)', async () => {
    // Five namespaces sorted by files desc; --top 3 keeps the
    // first 3 in the sorted order.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 150, chunks: 1500, bytes: 150_000, namespaces: 5 },
      byNamespace: [
        { namespace: 'tiny',   files: 5,   chunks: 50,   bytes: 5_000,   oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'medium', files: 20,  chunks: 200,  bytes: 20_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'big',    files: 50,  chunks: 500,  bytes: 50_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'small',  files: 10,  chunks: 100,  bytes: 10_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'huge',   files: 65,  chunks: 650,  bytes: 65_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--sort', 'files', '--top', '3']);
    const parsed = JSON.parse(captured.join(''));
    // Sorted by files desc: huge(65), big(50), medium(20), small(10), tiny(5).
    // Top 3: huge, big, medium.
    expect(parsed.stale).toEqual(['huge', 'big', 'medium']);
    expect(parsed.total).toBe(3);
  });

  it('--json --slim without explicit --top leaves the slim list unbounded (no implicit top-4 cap)', async () => {
    // Critical contract: the family-wide default `--top 4` from
    // commander is intentionally NOT enforced under --slim. The
    // operator polling a stats-slim dashboard typically wants the
    // FULL namespace count, not the top-4 default. Without an
    // explicit --top the slim list carries every surviving namespace.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 5 },
      byNamespace: [
        { namespace: 'a', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'b', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'c', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'd', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'e', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const parsed = JSON.parse(captured.join(''));
    // All 5 namespaces present — the top-4 default does NOT apply.
    expect(parsed.stale).toHaveLength(5);
    expect(parsed.total).toBe(5);
  });

  it('--json --slim --top composes with --since (cap applies to the post-filter survivors)', async () => {
    // --since narrows the namespace set first; --top caps the
    // post-filter list. The slim count reflects the capped subset.
    const now = Date.now();
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 100, chunks: 1000, bytes: 100_000, namespaces: 4 },
      byNamespace: [
        // Two stale (newestIngestedAt before cutoff)
        { namespace: 'stale-1', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: now - 1_000_000, extensions: [] },
        { namespace: 'stale-2', files: 20, chunks: 200, bytes: 20_000, oldestIngestedAt: null, newestIngestedAt: now - 2_000_000, extensions: [] },
        { namespace: 'stale-3', files: 30, chunks: 300, bytes: 30_000, oldestIngestedAt: null, newestIngestedAt: now - 3_000_000, extensions: [] },
        // One fresh (after cutoff) — should be filtered out
        { namespace: 'fresh',   files: 40, chunks: 400, bytes: 40_000, oldestIngestedAt: null, newestIngestedAt: now, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    const cutoff = new Date(now - 500_000).toISOString();
    await statsCommand().parseAsync([
      'node', 'cli', '--json', '--slim', '--since', cutoff, '--sort', 'files', '--top', '2',
    ]);
    const parsed = JSON.parse(captured.join(''));
    // After --since: 3 stale survive. Sorted by files desc:
    // stale-3 (30), stale-2 (20), stale-1 (10). --top 2 keeps the
    // first two: stale-3, stale-2.
    expect(parsed.stale).toEqual(['stale-3', 'stale-2']);
    expect(parsed.total).toBe(2);
  });

  it('--json --slim --top N where N >= length is a no-op (does not pad or wrap)', async () => {
    // Edge: --top 10 against 3 namespaces yields all 3, NOT 10
    // copies, NOT an error. Mirrors the family-wide --top
    // contract.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 15, chunks: 150, bytes: 15_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'a', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'b', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'c', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--top', '10']);
    const parsed = JSON.parse(captured.join(''));
    expect(parsed.stale).toHaveLength(3);
    expect(parsed.total).toBe(3);
  });

  it('--top WITHOUT --json --slim keeps its legacy per-namespace-extensions meaning (back-compat)', async () => {
    // Critical regression check: without --slim, --top still caps
    // each namespace's `extensions` array. The legacy contract is
    // preserved byte-for-byte; the --slim re-targeting is opt-in.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 1, chunks: 5, bytes: 1_000, namespaces: 1 },
      byNamespace: [
        {
          namespace: 'memory', files: 1, chunks: 5, bytes: 1_000,
          oldestIngestedAt: null, newestIngestedAt: null,
          extensions: [
            { ext: 'md', count: 10 },
            { ext: 'ts', count: 5 },
            { ext: 'json', count: 2 },
            { ext: 'yaml', count: 1 },
          ],
        },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--top', '2']);
    const parsed = JSON.parse(captured.join(''));
    // Legacy contract: extensions trimmed to top 2.
    expect(parsed.byNamespace[0].extensions).toEqual([
      { ext: 'md', count: 10 },
      { ext: 'ts', count: 5 },
    ]);
  });

  // ---------------------------------------------------------------
  // --json --slim --paths tests — re-target the flat stream from
  // per-namespace extensions to the FLAT NAMESPACE-NAME stream
  // (one namespace name per line, xargs-safe). The natural
  // pipeline-friendly twin of the slim JSON shape `{stale, total}`.
  // The re-target is GATED on --json --slim being active so existing
  // scripts using just `--paths` (without --slim) continue to get
  // the legacy extension-stream byte-for-byte — no regression.
  // ---------------------------------------------------------------

  it('--json --slim --paths emits one namespace name per line (xargs-safe)', async () => {
    // Default fixture from the outer describe has 3 namespaces in
    // API order: memory, sessions, projects. The slim-paths stream
    // emits them one per line in the post-sort/--top order. Without
    // --since the default --sort namespace is a no-op (API order
    // preserved) — mirrors the slim JSON `{stale}` array contract.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--paths']);
    const out = captured.join('');
    // One namespace per line, no styling, no header, trailing newline.
    const lines = out.split('\n').filter(Boolean);
    expect(lines).toEqual(['memory', 'sessions', 'projects']);
    // No ANSI styling — pipeline mode must be plain text.
    expect(out).not.toMatch(/\x1b\[/);
    // Not JSON — the slim-paths stream is path-style.
    expect(() => JSON.parse(out)).toThrow();
  });

  it('--json --slim --paths emits the EXACT same namespace set as --json --slim (the two shapes are observationally consistent)', async () => {
    // The slim JSON shape and the slim-paths stream must surface
    // the SAME survivor set in the SAME order — they answer the
    // same question, just framed differently. Pin the invariant:
    // a consumer reading `parsed.stale` from the JSON shape and
    // a consumer reading `.split('\n')` from the paths shape get
    // the byte-identical namespace list.
    captured.length = 0;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const parsedJson = JSON.parse(captured.join(''));
    captured.length = 0;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--paths']);
    const pathsList = captured.join('').split('\n').filter(Boolean);
    expect(pathsList).toEqual(parsedJson.stale);
  });

  it('--json --slim --paths composes with --since (post-cutoff survivors only)', async () => {
    // Override fixture to exercise the staleness filter against
    // the path stream. Two namespaces older than the cutoff, one
    // newer — only the older two should land in the path stream.
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
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--since', '2026-01-01', '--paths']);
    const lines = captured.join('').split('\n').filter(Boolean);
    // Two stale (memory, projects) survive — sessions filtered out.
    // API order preserved (default --sort namespace is a no-op).
    expect(lines).toEqual(['memory', 'projects']);
  });

  it('--json --slim --paths composes with --sort files --top (pinned canonical cron pipe)', async () => {
    // The pinned canonical cron pipe:
    //   clawmind stats --json --slim --since X --sort files --top 2 --paths | xargs ...
    // For the 5-namespace fixture, --sort files desc puts e (10)
    // first, then a/b/c/d (5 each, secondary by original index).
    // --top 2 keeps the head: e, a.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 30, chunks: 300, bytes: 30_000, namespaces: 5 },
      byNamespace: [
        { namespace: 'a', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'b', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'c', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'd', files: 5,  chunks: 50,  bytes: 5_000,  oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'e', files: 10, chunks: 100, bytes: 10_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--sort', 'files', '--top', '2', '--paths']);
    const lines = captured.join('').split('\n').filter(Boolean);
    expect(lines).toEqual(['e', 'a']);
  });

  it('--json --slim --paths with zero survivors yields a clean empty stream (xargs/wc-safe)', async () => {
    // --since cutoff that filters out every namespace must yield
    // an empty stream — NOT a JSON `[]` document, NOT a header,
    // NOT a "no namespaces" hint. Critical for `... --paths |
    // xargs ls`: leaking any text would feed xargs a literal
    // string instead of a path list.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 5, chunks: 50, bytes: 5_000, namespaces: 1 },
      byNamespace: [
        { namespace: 'sessions', files: 5, chunks: 50, bytes: 5_000,
          oldestIngestedAt: null, newestIngestedAt: Date.parse('2026-06-20T00:00:00Z'),
          extensions: [{ ext: 'json', count: 5 }] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--since', '2020-01-01', '--paths']);
    expect(captured.join('')).toBe('');
  });

  it('--json --slim --paths preserves the explicit --top cap (matches the slim JSON --top contract)', async () => {
    // Explicit --top under --slim wins (the default '4' is NOT
    // enforced). The slim-paths stream must apply the same cap so
    // the two shapes stay observationally consistent.
    globalThis.fetch = (async () => new Response(JSON.stringify({
      totals: { files: 15, chunks: 150, bytes: 15_000, namespaces: 3 },
      byNamespace: [
        { namespace: 'a', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'b', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
        { namespace: 'c', files: 5, chunks: 50, bytes: 5_000, oldestIngestedAt: null, newestIngestedAt: null, extensions: [] },
      ],
      generatedAt: 0,
    }), { status: 200 })) as never;
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--top', '2', '--paths']);
    const lines = captured.join('').split('\n').filter(Boolean);
    // Default --sort namespace (no-op): a, b, c (API order).
    // --top 2 keeps head: a, b.
    expect(lines).toEqual(['a', 'b']);
  });

  it('--paths WITHOUT --json keeps its legacy per-namespace-extensions meaning (back-compat regression)', async () => {
    // Critical: the slim-paths re-target is GATED on BOTH --json
    // AND --slim. Without --json, the bare --paths emits the
    // legacy extension stream from the default fixture (md/txt/
    // json/yaml from memory's top-4, json from sessions, ts from
    // projects). A regression that re-targeted under bare --paths
    // would silently change the contract for every existing
    // pipeline using `stats --paths` (and there are some, in the
    // CHANGELOG dating back to the 2026-06-20 16:05 PDT tick).
    await statsCommand().parseAsync(['node', 'cli', '--paths']);
    const out = captured.join('');
    // Byte-identical to the existing --paths test at line 397.
    expect(out).toBe('md\ntxt\njson\nyaml\njson\nts\n');
  });

  it('--paths --json WITHOUT --slim keeps its legacy extension-stream meaning (slim is the trigger)', async () => {
    // Pin: the re-target is BOTH --json AND --slim. With --json
    // alone (no --slim), --paths still emits the legacy extension
    // stream byte-for-byte. The slim flag is the canonical signal
    // that the operator wants the slim-paths re-target.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--paths']);
    const out = captured.join('');
    // Byte-identical to the existing --paths --json test at line 454.
    expect(out).toBe('md\ntxt\njson\nyaml\njson\nts\n');
  });

  it('--json --slim --paths is plain-text (NOT JSON) — pipeline contract wins over the slim JSON shape', async () => {
    // The precedence contract: --paths is the pipeline-friendly
    // contract; --json --slim is the dashboard shape. When all
    // three combine, --paths wins (the namespace names land as
    // path-per-line). A regression that emitted the JSON shape
    // here would break the canonical `... --paths | xargs` flow.
    await statsCommand().parseAsync(['node', 'cli', '--json', '--slim', '--paths']);
    const out = captured.join('');
    // Not JSON.
    expect(() => JSON.parse(out)).toThrow();
    // Each line is a bare namespace name, no `{`, `[`, `"` framing.
    for (const line of out.split('\n').filter(Boolean)) {
      expect(line).not.toContain('{');
      expect(line).not.toContain('[');
      expect(line).not.toContain('"');
    }
  });

  // -----------------------------------------------------------------
  // --tsv --header: prepend a single tab-separated schema row so the
  // stream is friendly to `column -t` / pandas.read_csv / spreadsheet
  // imports without a separate echo. Mirrors `stale --tsv --header`
  // byte-for-byte. Composes with --slim (slim emits the 2-col schema
  // `namespace\tfiles`); without --slim the full 5-col schema fires.
  // -----------------------------------------------------------------

  it('exposes --header on the command surface', () => {
    const flags = statsCommand().options.map((o) => o.long);
    expect(flags).toContain('--header');
  });

  it('--tsv --header prepends the full 5-column schema row', async () => {
    // Schema row: namespace<TAB>files<TAB>chunks<TAB>bytes<TAB>newestIngestedAt
    // followed by the existing tab-separated data rows.
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '--header']);
    const out = captured.join('');
    expect(out).toBe(
      'namespace\tfiles\tchunks\tbytes\tnewestIngestedAt\n' +
      'memory\t10\t100\t10000\t\n' +
      'sessions\t5\t50\t5000\t\n' +
      'projects\t15\t150\t15000\t\n',
    );
    // No ANSI styling — typed-table parsers must see plain text.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('--tsv WITHOUT --header keeps the legacy header-less shape byte-for-byte (regression)', async () => {
    // Critical back-compat contract: every existing pipeline using
    // `stats --tsv | awk` MUST keep seeing the legacy shape. The
    // existing test at line 190 already pins this; we re-assert here
    // alongside the --header pin to make the precedence explicit.
    await statsCommand().parseAsync(['node', 'cli', '--tsv']);
    const out = captured.join('');
    // No header row.
    expect(out).not.toMatch(/^namespace\t/);
    // Same data rows as the legacy test.
    expect(out).toBe(
      'memory\t10\t100\t10000\t\n' +
      'sessions\t5\t50\t5000\t\n' +
      'projects\t15\t150\t15000\t\n',
    );
  });

  it('--tsv --header fires the schema row even on a zero-row body (typed-parser contract)', async () => {
    // The schema row is the CONTRACT, not the data rows. A downstream
    // consumer parsing the stream into a typed table never has to
    // special-case an empty body — the header always anchors the
    // schema. Mirrors `stale --tsv --header` zero-row behaviour.
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '--header', '-q', 'nope']);
    expect(captured.join('')).toBe('namespace\tfiles\tchunks\tbytes\tnewestIngestedAt\n');
  });

  it('--tsv --header composes with --sort (header first, then sorted rows)', async () => {
    // The header is emitted ONCE at the top regardless of sort order;
    // the per-namespace rows are then sorted by the chosen key.
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '--header', '--sort', 'files']);
    const lines = captured.join('').split('\n').filter(Boolean);
    expect(lines[0]).toBe('namespace\tfiles\tchunks\tbytes\tnewestIngestedAt');
    // After the header, rows sorted desc by files: projects (15), memory (10), sessions (5).
    expect(lines.slice(1).map((l) => l.split('\t')[0])).toEqual(['projects', 'memory', 'sessions']);
  });

  it('--json --slim --tsv --header prepends the slim 2-column schema row (namespace\\tfiles)', async () => {
    // Under --slim the --tsv shape is 2-col (namespace, files). The
    // --header schema row matches that — `namespace\tfiles` — NOT
    // the full 5-col schema. Documented in the --header help text.
    await statsCommand().parseAsync([
      'node', 'cli', '--json', '--slim', '--tsv', '--header',
    ]);
    const out = captured.join('');
    expect(out.startsWith('namespace\tfiles\n')).toBe(true);
    // The 2-col data rows follow.
    const lines = out.split('\n').filter(Boolean);
    expect(lines[0]).toBe('namespace\tfiles');
    // Every data row has exactly one tab.
    for (const line of lines.slice(1)) {
      expect(line.split('\t')).toHaveLength(2);
    }
  });

  it('--header WITHOUT --tsv is silently ignored (no header injected into JSON / text / --paths)', async () => {
    // The --header flag is meaningful only inside --tsv. Other output
    // modes have their own well-defined shapes that the header would
    // corrupt (a JSON document with a TSV header line in front is
    // unparseable). We pin the no-op silently — same precedent as
    // --slim ignored without --json.
    await statsCommand().parseAsync(['node', 'cli', '--header']);
    const out = captured.join('');
    // Text mode totals line still fires; no header row leak.
    expect(out).toContain('files');
    expect(out).not.toMatch(/^namespace\tfiles\tchunks/);
  });

  it('--tsv --header determinism: two consecutive runs produce byte-identical output', async () => {
    // End-to-end pin of the cron snapshot diff property — the
    // header row alongside the data rows must be byte-stable across
    // runs over identical input.
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '--header']);
    const tick1 = captured.join('');
    captured.length = 0;
    await statsCommand().parseAsync(['node', 'cli', '--tsv', '--header']);
    const tick2 = captured.join('');
    expect(tick1).toBe(tick2);
  });
});
