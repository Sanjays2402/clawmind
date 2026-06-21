import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tagsCommand } from '../src/commands/tags.js';

// `tags` is a sub-command suite over /v1/tags. Tests mirror the
// pins.test.ts / mutes.test.ts / aliases.test.ts shape so the
// `--paths` pipeline contract is verified the same way across every
// list-style command (one path per line, no ANSI, no headers, no
// hints, empty stream on zero matches).
function stubFetch(payload: unknown, init: ResponseInit = { status: 200 }) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })) as never;
}

describe('tags paths cli', () => {
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

  it('--paths emits one path per line with no styling and no headers', async () => {
    stubFetch({
      tag: 'work',
      paths: ['/a.md', '/b.md', '/c.md'],
      count: 3,
    });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--paths']);
    // Exact byte layout — `wc -l` and `xargs -n1` must keep working.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    // No ANSI styling — pipeline mode must be plain text.
    expect(stdout.join('')).not.toMatch(/\x1b\[/);
    // No hint banner / count summary.
    expect(stdout.join('')).not.toContain('tagged');
    expect(stdout.join('')).not.toContain('work');
  });

  it('--paths with zero matches yields a clean empty stream (no "no sources tagged" hint)', async () => {
    stubFetch({ tag: 'unused', paths: [], count: 0 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'unused', '--paths']);
    // Critically: an empty result must NOT emit the gray "no sources
    // tagged unused" hint that the default text mode prints. A
    // `clawmind tags paths unused --paths | xargs ls` consumer needs an
    // empty stream so xargs runs zero times instead of being fed a hint
    // string as its argument.
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--json still works when --paths is not set (no regression)', async () => {
    stubFetch({ tag: 'work', paths: ['/a.md'], count: 1 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'work', '--json']);
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.tag).toBe('work');
    expect(parsed.paths).toEqual(['/a.md']);
    expect(parsed.count).toBe(1);
  });

  it('default text mode is unaffected (still prints the "no sources tagged" hint on empty)', async () => {
    stubFetch({ tag: 'unused', paths: [], count: 0 });
    await tagsCommand().parseAsync(['node', 'cli', 'paths', 'unused']);
    // The hint string only fires in default text mode — --paths and
    // --json both suppress it. The hint itself goes to stdout (styled
    // gray) so we just assert the substring without ANSI escape
    // sensitivity.
    expect(stdout.join('')).toContain('no sources tagged unused');
  });
});
