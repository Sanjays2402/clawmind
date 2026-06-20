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
