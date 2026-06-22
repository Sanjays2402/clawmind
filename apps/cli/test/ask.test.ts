import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runtime is mocked away — the ask command needs the same shape but
// nothing it depends on actually runs.
vi.mock('../src/runtime.js', () => ({
  buildRuntime: async () => ({
    bm25: {}, lance: {}, embed: {}, llm: {},
    env: { CLAWMIND_EMBED_MODEL: 'test-model' },
  }),
}));

// askStream is the source of all the events the command processes:
// 'sources' (the buildSources output), 'token' (streamed model
// output), and 'done' (latency/model summary). We swap in a per-test
// fake generator so each scenario can shape its own event sequence.
type AskEvent =
  | { type: 'sources'; value: { path: string; startLine: number; endLine: number; score: number }[] }
  | { type: 'token'; value: string }
  | { type: 'done'; value: { latencyMs: number; model: string } }
  | { type: 'error'; value: { message: string } };

const eventsToStream = (events: AskEvent[]) => (async function* () {
  for (const e of events) yield e;
})();

let nextEvents: AskEvent[] = [];
let askStreamCalls = 0;
vi.mock('@clawmind/rag', () => ({
  askStream: () => {
    askStreamCalls++;
    return eventsToStream(nextEvents);
  },
}));

// QuerySchema is used by the command. We don't mock @clawmind/types —
// the real schema is fine, the test just feeds positional args.

import { askCommand } from '../src/commands/ask.js';

describe('ask --no-citations', () => {
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
    askStreamCalls = 0;
    nextEvents = [
      { type: 'sources', value: [
        { path: '/a.md', startLine: 1, endLine: 5, score: 0.91 },
        { path: '/b.md', startLine: 10, endLine: 20, score: 0.62 },
      ] },
      { type: 'token', value: 'hello ' },
      { type: 'token', value: 'world' },
      { type: 'done', value: { latencyMs: 42, model: 'fake-model' } },
    ];
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('default text mode renders the citations footer (no regression)', async () => {
    await askCommand().parseAsync(['node', 'cli', 'what', 'is', 'x']);
    const out = stdout.join('');
    expect(out).toContain('hello world');
    // Citations footer present by default.
    expect(out).toContain('citations:');
    expect(out).toContain('[^1] /a.md:1-5');
    expect(out).toContain('[^2] /b.md:10-20');
  });

  it('--no-citations suppresses the text-mode citations footer entirely', async () => {
    await askCommand().parseAsync(['node', 'cli', '--no-citations', 'what', 'is', 'x']);
    const out = stdout.join('');
    // The answer body still streams.
    expect(out).toContain('hello world');
    // Footer (header label, formatted source rows) is gone.
    expect(out).not.toContain('citations:');
    expect(out).not.toContain('[^1]');
    expect(out).not.toContain('/a.md:1-5');
  });

  it('--no-citations leaves the latency line untouched', async () => {
    await askCommand().parseAsync(['node', 'cli', '--no-citations', 'what', 'is', 'x']);
    // The `(42ms via fake-model)` footer is part of the answer summary,
    // NOT the citations footer — it must still render.
    expect(stdout.join('')).toContain('(42ms via fake-model)');
  });

  it('--json default emits citations[] and count', async () => {
    await askCommand().parseAsync(['node', 'cli', '--json', 'what', 'is', 'x']);
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(parsed.answer).toBe('hello world');
    expect(parsed.citations).toEqual([
      { index: 1, path: '/a.md', startLine: 1, endLine: 5 },
      { index: 2, path: '/b.md', startLine: 10, endLine: 20 },
    ]);
    expect(parsed.count).toBe(2);
    expect(parsed.latencyMs).toBe(42);
    expect(parsed.model).toBe('fake-model');
  });

  it('--json --no-citations drops citations[] AND count from the payload', async () => {
    await askCommand().parseAsync(['node', 'cli', '--json', '--no-citations', 'what', 'is', 'x']);
    const out = stdout.join('');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    // The prose answer + identity metadata stay so a chat-log consumer
    // still has everything it needs.
    expect(parsed.answer).toBe('hello world');
    expect(parsed.question).toBe('what is x');
    expect(parsed.latencyMs).toBe(42);
    expect(parsed.model).toBe('fake-model');
    // citations[] and count are both gone — we omit the count along
    // with the array so the payload does not lie about a length it no
    // longer carries.
    expect('citations' in parsed).toBe(false);
    expect('count' in parsed).toBe(false);
    // The raw bytes must not even mention the field names, otherwise
    // a downstream `grep citations` would still match.
    expect(out).not.toContain('citations');
    expect(out).not.toContain('count');
  });
});

describe('ask --threshold', () => {
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
    askStreamCalls = 0;
    // Two sources, best score 0.91. Tokens are tagged 'UNIQUE_TOKEN_'
    // so we can assert they did NOT reach stdout in the skip path —
    // a stronger check than `not.toContain('hello')` would be.
    nextEvents = [
      { type: 'sources', value: [
        { path: '/a.md', startLine: 1, endLine: 5, score: 0.91 },
        { path: '/b.md', startLine: 10, endLine: 20, score: 0.62 },
      ] },
      { type: 'token', value: 'UNIQUE_TOKEN_one ' },
      { type: 'token', value: 'UNIQUE_TOKEN_two' },
      { type: 'done', value: { latencyMs: 42, model: 'fake-model' } },
    ];
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('--threshold below the best score lets the LLM run normally (no regression)', async () => {
    // Best score is 0.91; a threshold of 0.5 clears trivially.
    await askCommand().parseAsync(['node', 'cli', '--threshold', '0.5', 'q']);
    const out = stdout.join('');
    expect(out).toContain('UNIQUE_TOKEN_one');
    expect(out).toContain('UNIQUE_TOKEN_two');
    expect(out).toContain('(42ms via fake-model)');
    expect(out).toContain('citations:');
    expect(process.exitCode).toBeFalsy();
  });

  it('--threshold above the best score skips the LLM and exits 1', async () => {
    // Best score is 0.91; a threshold of 0.99 fails. The LLM stream
    // (token events) must NOT be consumed — assert the unique token
    // payload never reaches stdout.
    await askCommand().parseAsync(['node', 'cli', '--threshold', '0.99', 'q']);
    expect(process.exitCode).toBe(1);
    expect(stdout.join('')).not.toContain('UNIQUE_TOKEN_');
    // Clean text-mode hint on stderr — operators expect failures
    // there, NOT in the answer stream.
    const err = stderr.join('');
    expect(err).toContain('no citation cleared --threshold 0.99');
    expect(err).toContain('best 0.910');
    expect(err).toContain('across 2 sources');
    expect(err).toContain('LLM was not called');
  });

  it('--json --threshold above the best score emits a structured skip payload', async () => {
    await askCommand().parseAsync(['node', 'cli', '--json', '--threshold', '0.99', 'q']);
    expect(process.exitCode).toBe(1);
    const out = stdout.join('');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.skipped).toBe(true);
    expect(parsed.reason).toBe('no citation cleared --threshold');
    expect(parsed.threshold).toBe(0.99);
    expect(parsed.bestScore).toBe(0.91);
    expect(parsed.count).toBe(2);
    expect(parsed.question).toBe('q');
    // No answer body since the LLM did not run. Critically, no
    // unique token leaks through either.
    expect(parsed.answer).toBeUndefined();
    expect(out).not.toContain('UNIQUE_TOKEN_');
  });

  it('--threshold with a non-numeric value silently degrades to "no threshold"', async () => {
    // `--threshold $MAYBE` in a shell script where the variable is
    // empty must NOT throw. We treat unparseable values as "no
    // threshold" so the script keeps working.
    await askCommand().parseAsync(['node', 'cli', '--threshold', 'banana', 'q']);
    const out = stdout.join('');
    expect(out).toContain('UNIQUE_TOKEN_one');
    expect(process.exitCode).toBeFalsy();
  });

  it('--threshold exactly equal to the best score still clears (>= comparison)', async () => {
    // Boundary: a threshold equal to the best score is a pass, not
    // a fail. We use `>=` so an exact match is "good enough".
    await askCommand().parseAsync(['node', 'cli', '--threshold', '0.91', 'q']);
    const out = stdout.join('');
    expect(out).toContain('UNIQUE_TOKEN_one');
    expect(process.exitCode).toBeFalsy();
  });

  it('--threshold composes with --no-citations (skip path takes precedence)', async () => {
    // Even with --no-citations set, the skip path on threshold-failure
    // emits its own structured message — --no-citations only governs
    // the post-LLM citations block, which never runs in the skip path.
    await askCommand().parseAsync(['node', 'cli', '--no-citations', '--threshold', '0.99', 'q']);
    expect(process.exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('no citation cleared --threshold 0.99');
    // The skip path still does not call the LLM.
    expect(stdout.join('')).not.toContain('UNIQUE_TOKEN_');
  });
});

describe('ask --out writes answer to a file', () => {
  let stdout: string[];
  let stderr: string[];
  let origOut: typeof process.stdout.write;
  let origErr: typeof process.stderr.write;
  let dir: string;
  beforeEach(async () => {
    stdout = [];
    stderr = [];
    origOut = process.stdout.write.bind(process.stdout);
    origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdout.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderr.push(String(c)); return true; }) as never;
    askStreamCalls = 0;
    nextEvents = [
      { type: 'sources', value: [
        { path: '/a.md', startLine: 1, endLine: 5, score: 0.91 },
        { path: '/b.md', startLine: 10, endLine: 20, score: 0.62 },
      ] },
      { type: 'token', value: 'hello ' },
      { type: 'token', value: 'world' },
      { type: 'done', value: { latencyMs: 42, model: 'fake-model' } },
    ];
    dir = await mkdtemp(path.join(tmpdir(), 'clawmind-ask-out-'));
  });
  afterEach(async () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('text mode --out writes the assembled answer (sources/body/latency/citations) to the file', async () => {
    const out = path.join(dir, 'answer.txt');
    await askCommand().parseAsync(['node', 'cli', '-o', out, 'what', 'is', 'x']);
    // Stdout must be empty — the file is the canonical output sink.
    expect(stdout.join('')).toBe('');
    // Stderr carries the green confirmation line so a watching shell
    // still sees the command finished.
    expect(stderr.join('')).toContain('wrote answer');
    expect(stderr.join('')).toContain(out);
    const body = await readFile(out, 'utf8');
    expect(body).toContain('sources: 2');
    expect(body).toContain('hello world');
    expect(body).toContain('(42ms via fake-model)');
    // Citations footer present by default.
    expect(body).toContain('citations:');
    expect(body).toContain('[^1] /a.md:1-5');
    expect(body).toContain('[^2] /b.md:10-20');
    // The saved file must be ANSI-clean so grep/editor stay readable.
    expect(body).not.toMatch(/\x1b\[/);
  });

  it('text mode --out with --no-citations omits the citations footer in the saved file', async () => {
    const out = path.join(dir, 'no-cite.txt');
    await askCommand().parseAsync(['node', 'cli', '--no-citations', '-o', out, 'q']);
    const body = await readFile(out, 'utf8');
    expect(body).toContain('hello world');
    expect(body).toContain('(42ms via fake-model)');
    // The post-answer footer is gone.
    expect(body).not.toContain('citations:');
    expect(body).not.toContain('[^1]');
  });

  it('--json --out writes the JSON payload to the file (not stdout)', async () => {
    const out = path.join(dir, 'answer.json');
    await askCommand().parseAsync(['node', 'cli', '--json', '-o', out, 'q']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('wrote answer');
    const parsed = JSON.parse(await readFile(out, 'utf8')) as Record<string, unknown>;
    expect(parsed.answer).toBe('hello world');
    expect(parsed.latencyMs).toBe(42);
    expect(parsed.model).toBe('fake-model');
    expect(parsed.count).toBe(2);
  });

  it('--out short-circuits the token-by-token stdout stream', async () => {
    // Critical regression guard: the answer must NOT also reach stdout
    // when the operator chose a file. Otherwise `ask ... --out a.txt`
    // would dump the full answer twice (once to screen, once to file),
    // which is exactly the failure mode --out is meant to avoid.
    const out = path.join(dir, 'silence.txt');
    await askCommand().parseAsync(['node', 'cli', '-o', out, 'q']);
    expect(stdout.join('')).not.toContain('hello');
    expect(stdout.join('')).not.toContain('world');
    expect(stdout.join('')).not.toContain('42ms');
    // ...and the file still has the answer.
    const body = await readFile(out, 'utf8');
    expect(body).toContain('hello world');
  });
});

// ----------------------------------------------------------------
// --stream-json: live NDJSON event stream. One JSON document per
// line, in the order: sources, token, token, ..., done. A UI can
// render the citation set up front and paint the answer
// token-by-token as it arrives.
// ----------------------------------------------------------------

describe('ask --stream-json', () => {
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
    askStreamCalls = 0;
    nextEvents = [
      { type: 'sources', value: [
        { path: '/a.md', startLine: 1, endLine: 5, score: 0.91 },
        { path: '/b.md', startLine: 10, endLine: 20, score: 0.62 },
      ] },
      { type: 'token', value: 'hello ' },
      { type: 'token', value: 'world' },
      { type: 'done', value: { latencyMs: 42, model: 'fake-model' } },
    ];
  });
  afterEach(() => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('exposes --stream-json on the command surface', () => {
    const flags = askCommand().options.map((o) => o.long);
    expect(flags).toContain('--stream-json');
  });

  it('emits one NDJSON event per source / token / done (single-line JSON, exact order)', async () => {
    await askCommand().parseAsync(['node', 'cli', '--stream-json', 'q']);
    const lines = stdout.join('').split('\n').filter(Boolean);
    // 1 sources doc + 2 token docs + 1 done doc = 4 lines.
    expect(lines).toHaveLength(4);
    // Each line is a single-line JSON document (NDJSON shape).
    for (const line of lines) {
      expect(line.startsWith('{')).toBe(true);
      // Single line — no embedded newlines from JSON.stringify(_, _, 2).
      expect(line).not.toMatch(/\n/);
    }
    const docs = lines.map((l) => JSON.parse(l));
    // Order is fixed: sources first, then tokens in arrival order, then done.
    expect(docs[0]).toEqual({
      kind: 'sources',
      count: 2,
      items: [
        { index: 1, path: '/a.md', startLine: 1, endLine: 5, score: 0.91 },
        { index: 2, path: '/b.md', startLine: 10, endLine: 20, score: 0.62 },
      ],
    });
    expect(docs[1]).toEqual({ kind: 'token', value: 'hello ' });
    expect(docs[2]).toEqual({ kind: 'token', value: 'world' });
    expect(docs[3]).toEqual({ kind: 'done', latencyMs: 42, model: 'fake-model' });
  });

  it('--stream-json --no-citations drops items[] from the sources doc but keeps the marker', async () => {
    // The UI may still want to know "how many sources did retrieval
    // find" for the sidebar count even when the operator asked to
    // suppress the per-citation details. The marker stays, items
    // goes — same precedent as --json --no-citations.
    await askCommand().parseAsync(['node', 'cli', '--stream-json', '--no-citations', 'q']);
    const lines = stdout.join('').split('\n').filter(Boolean);
    const sourcesDoc = JSON.parse(lines[0]!);
    expect(sourcesDoc.kind).toBe('sources');
    expect(sourcesDoc.count).toBe(2);
    expect(sourcesDoc.items).toBeUndefined();
    // The token + done events still fire.
    expect(JSON.parse(lines[1]!).kind).toBe('token');
    expect(JSON.parse(lines[lines.length - 1]!).kind).toBe('done');
  });

  it('--stream-json --threshold below the bar emits {kind:"sources"} + {kind:"skipped"} and skips tokens / done', async () => {
    // The skip path SHORT-CIRCUITS before any token is pulled — the
    // LLM never runs. The UI sees the citation set + a skipped
    // marker and renders a "threshold not met" toast with the
    // best score for context. No token events, no done event.
    await askCommand().parseAsync(['node', 'cli', '--stream-json', '--threshold', '0.99', 'q']);
    const lines = stdout.join('').split('\n').filter(Boolean);
    // 1 sources doc + 1 skipped doc = 2 lines exactly. No tokens, no done.
    expect(lines).toHaveLength(2);
    const sourcesDoc = JSON.parse(lines[0]!);
    expect(sourcesDoc.kind).toBe('sources');
    const skippedDoc = JSON.parse(lines[1]!);
    expect(skippedDoc).toMatchObject({
      kind: 'skipped',
      reason: 'no citation cleared --threshold',
      threshold: 0.99,
      bestScore: 0.91,
      count: 2,
    });
    // Exit code is 1 so a wrapper script can branch on the skip.
    expect(process.exitCode).toBe(1);
  });

  it('--stream-json + --json: --stream-json wins (no assembled payload at the end)', async () => {
    // When both are passed the streaming contract takes precedence
    // because the UI consumer is more time-sensitive than the
    // final-payload consumer. The assembled --json document is
    // NOT emitted (it would corrupt the NDJSON stream by adding a
    // multi-line indented doc at the end).
    await askCommand().parseAsync(['node', 'cli', '--stream-json', '--json', 'q']);
    const lines = stdout.join('').split('\n').filter(Boolean);
    // Same 4 NDJSON docs as the plain --stream-json case.
    expect(lines).toHaveLength(4);
    const docs = lines.map((l) => JSON.parse(l));
    expect(docs.map((d) => d.kind)).toEqual(['sources', 'token', 'token', 'done']);
    // No trailing "question/answer/citations" assembled payload.
    const joined = stdout.join('');
    expect(joined).not.toContain('"question"');
    expect(joined).not.toContain('"answer"');
  });

  it('--stream-json ignored with --out (file capture wins; no NDJSON to stdout)', async () => {
    // --stream-json is the live-emit shape; --out is the file-capture
    // shape. They are incompatible — an operator wanting both should
    // shell-redirect (`clawmind ask ... --stream-json > stream.ndjson`).
    // When --out is set, --stream-json is silently ignored and the
    // command falls through to the regular --out path (text-mode
    // file write). This matches the precedent of silently ignored
    // flag combos elsewhere in the cli.
    const dir = await mkdtemp(path.join(tmpdir(), 'ask-stream-out-'));
    try {
      const outFile = path.join(dir, 'a.txt');
      await askCommand().parseAsync(['node', 'cli', '--stream-json', '-o', outFile, 'q']);
      // No NDJSON to stdout — the regular --out path takes over.
      expect(stdout.join('')).toBe('');
      // File got the regular text-mode body.
      const body = await readFile(outFile, 'utf8');
      expect(body).toContain('hello world');
      expect(body).toContain('42ms');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
