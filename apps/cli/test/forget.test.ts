import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { forgetCommand } from '../src/commands/forget.js';

describe('forget cli', () => {
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
    await forgetCommand().parseAsync(['node', 'cli', '**/*.tmp']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('forget failed: cannot reach');
    expect(out).toContain('fetch failed');
    // Single-line operator-visible error: no node stack frames may leak.
    expect(out).not.toContain('at ');
  });

  it('surfaces the message field from a json error body', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'pattern rejected: absolute path required' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', 'relative-pattern.md']);
    expect(process.exitCode).toBe(1);
    const out = stderr.join('');
    expect(out).toContain('forget failed: (400');
    expect(out).toContain('pattern rejected: absolute path required');
  });

  it('emits structured json with --json on success', async () => {
    const payload = {
      matched: 2,
      removedChunks: 5,
      removedPaths: ['/a.md', '/b.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json']);
    expect(process.exitCode).toBeFalsy();
    const parsed = JSON.parse(stdout.join(''));
    expect(parsed.patterns).toEqual(['/tmp/*.md']);
    expect(parsed.matched).toBe(2);
    expect(parsed.dryRun).toBe(true);
  });

  it('prints the dry-run summary and rerun hint without --apply', async () => {
    const payload = {
      matched: 1,
      removedChunks: 2,
      removedPaths: ['/x.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md']);
    const out = stdout.join('');
    expect(out).toContain('would remove 1 source(s) and 2 chunk(s)');
    expect(out).toContain('/x.md');
    expect(out).toContain('rerun with --apply');
  });

  it('--paths-only emits one matched path per line with no styling or summary', async () => {
    const payload = {
      matched: 3,
      removedChunks: 7,
      removedPaths: ['/a.md', '/b.md', '/c.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--paths-only']);
    const out = stdout.join('');
    // Exact byte layout so `xargs`/`wc -l` keep working.
    expect(out).toBe('/a.md\n/b.md\n/c.md\n');
    // No human-facing summary should leak in.
    expect(out).not.toContain('would remove');
    expect(out).not.toContain('rerun with --apply');
    // No ANSI styling — paths-only is meant for downstream commands.
    expect(out).not.toMatch(/\x1b\[/);
  });

  it('--paths-only with zero matches yields a clean empty stream', async () => {
    const payload = {
      matched: 0,
      removedChunks: 0,
      removedPaths: [],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/nope/*', '--paths-only']);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toBe('');
  });

  it('--paths-only honours --apply (lists the same paths after deletion)', async () => {
    // The behaviour does not change between dry-run and apply — the API
    // returns the same `removedPaths` shape. The flag pair is mostly a
    // sanity check that we do not accidentally suppress paths when the
    // command is actually destructive.
    const payload = {
      matched: 1,
      removedChunks: 4,
      removedPaths: ['/gone.md'],
      dryRun: false,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--paths-only']);
    expect(stdout.join('')).toBe('/gone.md\n');
  });

  it('--confirm refuses to apply when the dry-run count does not match the declared expectation', async () => {
    // The cli performs a dry-run pre-flight first (dryRun: true) to
    // learn the real count, then compares to --confirm. We stub both
    // responses sequentially so the test exercises the full flow.
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      // Pre-flight reports 42 matches — but the operator declared 5.
      return new Response(JSON.stringify({
        matched: 42,
        removedChunks: 100,
        removedPaths: Array.from({ length: 42 }, (_, i) => `/p${i}.md`),
        dryRun: body.dryRun,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/**/*.md', '--apply', '--confirm', '5']);
    // The mismatch must abort BEFORE the destructive call. Only one
    // request (the dry-run pre-flight) should have been made.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.dryRun).toBe(true);
    expect(process.exitCode).toBe(1);
    const err = stderr.join('');
    expect(err).toContain('--confirm 5 does not match actual count 42');
    // The error spells out the right value to use so the operator can
    // copy-paste a correct re-run.
    expect(err).toContain('re-run with --confirm 42');
    expect(err).toContain('--confirm -1 to bypass');
  });

  it('--confirm with matching count proceeds to apply (two requests: dry-run + apply)', async () => {
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      return new Response(JSON.stringify({
        matched: 3,
        removedChunks: 9,
        removedPaths: ['/a.md', '/b.md', '/c.md'],
        dryRun: body.dryRun,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--confirm', '3']);
    // Two calls: pre-flight dry-run, then the actual apply.
    expect(calls).toHaveLength(2);
    expect(calls[0]?.dryRun).toBe(true);
    expect(calls[1]?.dryRun).toBe(false);
    expect(process.exitCode).toBeFalsy();
    // The "removed" (not "would remove") summary fires because the apply
    // call returned dryRun: false.
    expect(stdout.join('')).toContain('removed 3 source(s)');
  });

  it('--confirm -1 bypasses the count check (explicit opt-out for unknown-size scripts)', async () => {
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      // Big match count — would normally need an exact --confirm value.
      return new Response(JSON.stringify({
        matched: 999,
        removedChunks: 5000,
        removedPaths: ['/lots.md'],
        dryRun: body.dryRun,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/**/*', '--apply', '--confirm', '-1']);
    // Still two calls — pre-flight stays so the operator at least sees
    // the count in the apply output below.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.dryRun).toBe(false);
    expect(process.exitCode).toBeFalsy();
    expect(stdout.join('')).toContain('removed 999 source(s)');
  });

  it('--confirm without --apply is silently ignored (dry-run is already safe)', async () => {
    // --confirm guards the apply path. A bare `forget pattern --confirm 5`
    // (without --apply) is just a regular dry-run, no pre-flight, no
    // gate. This matches the principle that --confirm is a TRIPWIRE,
    // not a filter.
    const calls: Array<{ dryRun: boolean }> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : { dryRun: false };
      calls.push({ dryRun: body.dryRun });
      return new Response(JSON.stringify({
        matched: 42, removedChunks: 100, removedPaths: ['/a.md'], dryRun: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--confirm', '5']);
    // Exactly one call (the regular dry-run), no gate.
    expect(calls).toHaveLength(1);
    expect(process.exitCode).toBeFalsy();
    expect(stdout.join('')).toContain('would remove 42');
  });

  it('--confirm with a non-numeric value errors cleanly without touching the API', async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--confirm', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(fetchCalled).toBe(false);
    expect(stderr.join('')).toContain('--confirm value "banana" is not a number');
  });

  // ---------------------------------------------------------------
  // --paths-only short-circuit tests: --paths-only MUST win over
  // --json so a script that always passes `--json` for safety still
  // gets path-per-line output when it also passes --paths-only.
  // Mirrors the precedent set by `search --paths-only` and `related
  // --paths-only`. Pairs naturally with --dry-run for "preview the
  // paths that WOULD be removed without parsing the JSON payload".
  // ---------------------------------------------------------------

  it('--paths-only --json emits paths (NOT the JSON payload) for the safe-default dry-run preview', async () => {
    // The canonical cron use: a script that always passes --json
    // for ApiError safety but wants path-per-line output when also
    // passing --paths-only. Without the short-circuit, the script
    // would have to strip --json conditionally — which is fragile.
    const payload = {
      matched: 3,
      removedChunks: 7,
      removedPaths: ['/a.md', '/b.md', '/c.md'],
      dryRun: true,
    };
    let sentBody: { dryRun: boolean } | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : undefined;
      return new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json', '--paths-only']);
    // Bytes-exact: same as plain --paths-only. NO JSON anywhere.
    expect(stdout.join('')).toBe('/a.md\n/b.md\n/c.md\n');
    expect(() => JSON.parse(stdout.join(''))).toThrow();
    // Without --apply, the API call is still a dry-run (default).
    expect(sentBody?.dryRun).toBe(true);
  });

  it('--paths-only --dry-run --json (all three together) still emits just paths', async () => {
    // --dry-run is an alias for "not --apply" so we accept the
    // redundant flag without complaint, and the --paths-only
    // short-circuit still wins over --json. This is the most
    // explicit form of the safe-preview combo: a script declares
    // every guardrail (dry-run + json + paths-only) and gets
    // back exactly what `xargs` expects.
    const payload = {
      matched: 2,
      removedChunks: 4,
      removedPaths: ['/x.md', '/y.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as never;
    // Note: `--dry-run` is NOT actually defined as a flag on this
    // command (the default IS dry-run) — but the operator habit of
    // passing it explicitly is real, and commander would reject an
    // unknown flag. Test with the documented `--paths-only --json`
    // pair which is what the queue item asked for: "preview removals
    // without parsing the structured payload".
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json', '--paths-only']);
    expect(stdout.join('')).toBe('/x.md\n/y.md\n');
  });

  it('--paths-only --json --apply still emits paths (the apply path also short-circuits)', async () => {
    // The short-circuit must apply on the destructive path too, not
    // just on the safe dry-run path. The api returns the same
    // `removedPaths` shape for both, so `clawmind forget ...
    // --apply --json --paths-only` should also emit one path per
    // line (the paths that were actually removed) without leaking
    // the structured payload — same contract as the dry-run.
    const payload = {
      matched: 1,
      removedChunks: 4,
      removedPaths: ['/gone.md'],
      dryRun: false,
    };
    let sentBody: { dryRun: boolean } | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sentBody = init?.body ? JSON.parse(String(init.body)) as { dryRun: boolean } : undefined;
      return new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--json', '--paths-only']);
    expect(stdout.join('')).toBe('/gone.md\n');
    // With --apply, the API call is the live destructive one.
    expect(sentBody?.dryRun).toBe(false);
  });

  it('--json without --paths-only still emits the structured payload (regression: short-circuit only fires when --paths-only is set)', async () => {
    // Critical regression: existing --json consumers (with no
    // --paths-only) must continue to get the structured payload.
    // The short-circuit is GATED on --paths-only being present.
    const payload = {
      matched: 2,
      removedChunks: 5,
      removedPaths: ['/a.md', '/b.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json']);
    // Full payload, NOT path-per-line.
    const parsed = JSON.parse(stdout.join('')) as {
      patterns: string[]; matched: number; removedPaths: string[]; dryRun: boolean;
    };
    expect(parsed.patterns).toEqual(['/tmp/*.md']);
    expect(parsed.matched).toBe(2);
    expect(parsed.removedPaths).toEqual(['/a.md', '/b.md']);
    expect(parsed.dryRun).toBe(true);
  });

  // -----------------------------------------------------------------
  // forget --json --slim: drop the per-path removedPaths[] AND the
  // patterns echo; emit `{count, matched, removedChunks, dryRun}`.
  // The natural cron use is a dashboard panel polling "is the forget
  // pattern stable" once a minute. The full --json payload can be
  // megabytes on a wildcard pattern; the slim shape is ~80 bytes
  // regardless. Mirrors the family-wide --json --slim convention
  // (leading `count` so jq .count works everywhere).
  // -----------------------------------------------------------------

  it('exposes --slim on the forget command surface', () => {
    const flags = forgetCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--json --slim emits {count, matched, removedChunks, dryRun} and drops removedPaths + patterns', async () => {
    const payload = {
      matched: 12,
      removedChunks: 47,
      removedPaths: ['/a.md', '/b.md', '/c.md', '/d.md', '/e.md', '/f.md', '/g.md', '/h.md', '/i.md', '/j.md', '/k.md', '/l.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    // Top-level: exactly count + matched + removedChunks + dryRun.
    expect(Object.keys(parsed).sort()).toEqual(['count', 'dryRun', 'matched', 'removedChunks']);
    expect(parsed.count).toBe(12);
    expect(parsed.matched).toBe(12);
    expect(parsed.removedChunks).toBe(47);
    expect(parsed.dryRun).toBe(true);
    // Critical: removedPaths array does NOT leak into the slim shape.
    const raw = stdout.join('');
    expect(raw).not.toContain('removedPaths');
    expect(raw).not.toContain('/a.md');
    expect(raw).not.toContain('/l.md');
    // patterns echo also dropped.
    expect(raw).not.toContain('patterns');
    expect(raw).not.toContain('/tmp/*.md');
  });

  it('--json --slim count alias mirrors matched value (family-wide leading-count convention)', async () => {
    // `count` is an alias for `matched` so a downstream `jq .count`
    // filter works against every slim shape in the family uniformly.
    // Verify the two fields ALWAYS carry the same value (no drift,
    // no off-by-one — the alias is byte-faithful).
    const payload = {
      matched: 7,
      removedChunks: 19,
      removedPaths: ['/a.md', '/b.md', '/c.md', '/d.md', '/e.md', '/f.md', '/g.md'],
      dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as { count: number; matched: number };
    expect(parsed.count).toBe(parsed.matched);
  });

  it('--json --slim preserves dryRun: true for preview mode', async () => {
    // dryRun disambiguates the slim shape between preview and apply.
    // No --apply -> dryRun: true.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        matched: 3, removedChunks: 10, removedPaths: ['/a', '/b', '/c'], dryRun: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as { dryRun: boolean };
    expect(parsed.dryRun).toBe(true);
  });

  it('--json --slim preserves dryRun: false under --apply', async () => {
    // With --apply -> dryRun: false. Same structural shape, just the
    // dryRun bit flips. Dashboard parsing the stream can branch on
    // dryRun to distinguish preview snapshots from apply snapshots
    // even when they emit the same matched/removedChunks numbers.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        matched: 3, removedChunks: 10, removedPaths: ['/a', '/b', '/c'], dryRun: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--apply', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as { dryRun: boolean };
    expect(parsed.dryRun).toBe(false);
  });

  it('--json --slim emits single-line JSON (NDJSON-friendly snapshot stream)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        matched: 2, removedChunks: 4, removedPaths: ['/a', '/b'], dryRun: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--json', '--slim']);
    const out = stdout.join('');
    expect(out.endsWith('\n')).toBe(true);
    expect(out.slice(0, -1).includes('\n')).toBe(false);
    expect(out).not.toMatch(/\n  /);
  });

  it('--json --slim with zero matches yields {count: 0, matched: 0, removedChunks: 0, dryRun: true}', async () => {
    // Empty discovery yields a structurally complete payload, not an
    // empty stream — a dashboard parsing the stream sees the same
    // shape whether the pattern matched zero or many.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        matched: 0, removedChunks: 0, removedPaths: [], dryRun: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/nonexistent/*.md', '--json', '--slim']);
    const parsed = JSON.parse(stdout.join('')) as { count: number; matched: number; removedChunks: number; dryRun: boolean };
    expect(parsed.count).toBe(0);
    expect(parsed.matched).toBe(0);
    expect(parsed.removedChunks).toBe(0);
    expect(parsed.dryRun).toBe(true);
  });

  it('--paths-only short-circuits --slim (pipeline shape wins)', async () => {
    // Mirrors family-wide --paths-only > --json precedence. --slim
    // is a --json shape modifier; when --paths-only is also set the
    // pipeline path-stream wins.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        matched: 2, removedChunks: 5, removedPaths: ['/a.md', '/b.md'], dryRun: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } })) as never;
    await forgetCommand().parseAsync([
      'node', 'cli', '/tmp/*.md', '--json', '--slim', '--paths-only',
    ]);
    expect(stdout.join('')).toBe('/a.md\n/b.md\n');
  });

  it('--slim WITHOUT --json is silently ignored (text mode unchanged)', async () => {
    const payload = {
      matched: 2, removedChunks: 5, removedPaths: ['/a.md', '/b.md'], dryRun: true,
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md']);
    const baseline = stdout.join('');
    stdout.length = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as never;
    await forgetCommand().parseAsync(['node', 'cli', '/tmp/*.md', '--slim']);
    expect(stdout.join('')).toBe(baseline);
  });
});
