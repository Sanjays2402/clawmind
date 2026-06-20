import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
