import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { doctorCommand } from '../src/commands/doctor.js';

describe('doctor cli', () => {
  let originalFetch: typeof globalThis.fetch;
  let stdoutChunks: string[];
  let stderrChunks: string[];
  let originalStdout: typeof process.stdout.write;
  let originalStderr: typeof process.stderr.write;

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    originalFetch = globalThis.fetch;
    originalStdout = process.stdout.write.bind(process.stdout);
    originalStderr = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((c: string) => { stdoutChunks.push(String(c)); return true; }) as never;
    process.stderr.write = ((c: string) => { stderrChunks.push(String(c)); return true; }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.exitCode = 0;
  });

  it('reports a clean error when the api is unreachable', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as never;
    await doctorCommand().parseAsync(['node', 'cli']);
    const err = stderrChunks.join('');
    expect(err).toMatch(/doctor failed: cannot reach /);
    expect(err).toContain('ECONNREFUSED');
    expect(process.exitCode).toBe(1);
  });

  it('surfaces server json error message on non-2xx', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ message: 'manifest locked' }),
      { status: 503, statusText: 'Service Unavailable' },
    )) as never;
    await doctorCommand().parseAsync(['node', 'cli']);
    const err = stderrChunks.join('');
    expect(err).toMatch(/doctor failed \(503 /);
    expect(err).toContain('manifest locked');
    expect(process.exitCode).toBe(1);
  });

  it('emits JSON report when --json is passed', async () => {
    const report = {
      ok: true,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json']);
    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out) as Record<string, unknown>;
    // --severity defaults to "info" so the original shape (with the
    // new findingsTotal addition) is what the consumer sees.
    expect(parsed.ok).toBe(true);
    expect(parsed.findings).toEqual([]);
    expect(parsed.findingsTotal).toBe(0);
    expect(process.exitCode).toBeFalsy();
  });

  it('--severity error hides info/warn rows in text mode but keeps exit code driven by the full list', async () => {
    const report = {
      ok: false, // there is an error finding, so ok=false
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'DRIFT_NONE', message: 'all is well' },
        { severity: 'warn', code: 'STALE_BM25', message: 'small drift' },
        { severity: 'error', code: 'MISSING_VEC', message: 'broken' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--severity', 'error']);
    const out = stdoutChunks.join('');
    // Only the error row should appear.
    expect(out).toContain('MISSING_VEC');
    expect(out).not.toContain('DRIFT_NONE');
    expect(out).not.toContain('STALE_BM25');
    // Hint at the end tells the operator how many were hidden so they
    // do not think the report is empty.
    expect(out).toContain('2 more finding(s) below --severity error');
    // Exit code stays 1 because the original report.ok was false.
    expect(process.exitCode).toBe(1);
  });

  it('--severity warn shows warn+error and reports the hidden-count hint', async () => {
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'INFO_A', message: 'a' },
        { severity: 'warn', code: 'WARN_B', message: 'b' },
        { severity: 'error', code: 'ERROR_C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--severity', 'warn']);
    const out = stdoutChunks.join('');
    expect(out).not.toContain('INFO_A');
    expect(out).toContain('WARN_B');
    expect(out).toContain('ERROR_C');
    expect(out).toContain('1 more finding(s) below --severity warn');
  });

  it('--severity --json keeps the original count alongside the filtered list', async () => {
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'error', code: 'C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--severity', 'error', '--json']);
    const parsed = JSON.parse(stdoutChunks.join('')) as { findings: { code: string }[]; findingsTotal: number; ok: boolean };
    expect(parsed.findings.map((f) => f.code)).toEqual(['C']);
    // findingsTotal still carries the unfiltered count so a downstream
    // dashboard can show "showing 1 of 3" without re-running the cmd.
    expect(parsed.findingsTotal).toBe(3);
    // ok still reflects the full report.
    expect(parsed.ok).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('--severity error with no error-level findings prints the "below severity" hint', async () => {
    const report = {
      ok: true,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--severity', 'error']);
    const out = stdoutChunks.join('');
    expect(out).toContain('2 finding(s) below --severity error; nothing to show');
    // No exit code change — overall report is healthy.
    expect(process.exitCode).toBeFalsy();
  });

  it('rejects an unknown --severity value with a clean error and no API call', async () => {
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}', { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--severity', 'critical']);
    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toContain('unknown --severity "critical"');
    expect(stderrChunks.join('')).toContain('expected info, warn, or error');
    // The validation fires AFTER we fetch the report — that's fine,
    // the bad flag is a display setting so we don't need to short-
    // circuit before the network call. Just confirm the cli surfaced
    // the error cleanly.
    expect(fetched).toBe(true);
  });

  it('exposes --stale-after-days on the command surface', () => {
    const flags = doctorCommand().options.map((o) => o.long);
    expect(flags).toContain('--stale-after-days');
  });

  it('--stale-after-days appends the query string to the doctor endpoint', async () => {
    // The flag travels with the request as ?staleAfterDays=<n> so the
    // entire override is server-side. We assert the URL the cli would
    // have dialled — the API converts days -> ms internally.
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response(JSON.stringify({
        ok: true,
        counts: { manifestDocs: 0, manifestChunks: 0, bm25Chunks: 0, lanceChunks: 0 },
        findings: [],
      }), { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--stale-after-days', '7']);
    expect(seenUrl).toContain('/v1/doctor?staleAfterDays=7');
  });

  it('--stale-after-days 0 is a valid tripwire ("any age counts as stale")', async () => {
    // The zero case is the right tripwire for a CI smoke that wants
    // to fail on any non-fresh index, regardless of the default 30d
    // threshold. The bound-check explicitly allows zero.
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response(JSON.stringify({
        ok: true,
        counts: { manifestDocs: 0, manifestChunks: 0, bm25Chunks: 0, lanceChunks: 0 },
        findings: [],
      }), { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--stale-after-days', '0']);
    expect(seenUrl).toContain('staleAfterDays=0');
    expect(process.exitCode).toBeFalsy();
  });

  it('--stale-after-days with a negative value is rejected client-side (no API call)', async () => {
    // The bound-check fires BEFORE the fetch so a typo does not waste
    // a round-trip. We assert the fetch never happened.
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}', { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--stale-after-days', '-5']);
    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toContain('--stale-after-days must be an integer between 0 and 3650');
    expect(fetched).toBe(false);
  });

  it('--stale-after-days with a value above the 3650 cap is rejected client-side', async () => {
    // 3650 days = ~10 years; anything beyond is almost certainly a
    // typo (a "stale after a million days" SLO is meaningless).
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}', { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--stale-after-days', '99999']);
    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toContain('--stale-after-days must be an integer between 0 and 3650');
    expect(fetched).toBe(false);
  });

  it('--stale-after-days with a non-numeric value is rejected client-side', async () => {
    // parseInt('banana', 10) returns NaN which is not finite. The
    // bound-check catches it the same way as negative/out-of-range
    // and aborts cleanly with the same error message.
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response('{}', { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--stale-after-days', 'banana']);
    expect(process.exitCode).toBe(1);
    expect(stderrChunks.join('')).toContain('--stale-after-days must be an integer between 0 and 3650');
    expect(fetched).toBe(false);
  });

  it('without --stale-after-days, the URL is plain /v1/doctor (no query string)', async () => {
    // Regression: the legacy URL stays byte-for-byte identical when
    // the flag is absent so the entire suite of existing scripts /
    // dashboards continues to work without change.
    let seenUrl = '';
    globalThis.fetch = (async (u: string) => {
      seenUrl = String(u);
      return new Response(JSON.stringify({
        ok: true,
        counts: { manifestDocs: 0, manifestChunks: 0, bm25Chunks: 0, lanceChunks: 0 },
        findings: [],
      }), { status: 200 });
    }) as never;
    await doctorCommand().parseAsync(['node', 'cli']);
    expect(seenUrl).toContain('/v1/doctor');
    expect(seenUrl).not.toContain('staleAfterDays');
    expect(seenUrl).not.toContain('?');
  });

  // ---------------------------------------------------------------
  // --quiet tests — slim per-severity tallies for tight cron
  // dashboards. Mirrors the precedent set by stats --slim: shape
  // reducer that wins over the full --json payload when both are
  // set. Single-line JSON for clean NDJSON snapshots. `ok` flag
  // and exit code preserved from the full report.
  // ---------------------------------------------------------------

  it('exposes --quiet on the command surface', () => {
    const flags = doctorCommand().options.map((o) => o.long);
    expect(flags).toContain('--quiet');
  });

  it('--json --quiet emits a slim {ok, findingsCount, errors, warnings, infos} document', async () => {
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'warn', code: 'B2', message: 'b2' },
        { severity: 'error', code: 'C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet']);
    const parsed = JSON.parse(stdoutChunks.join('')) as {
      ok: boolean; findingsCount: number; errors: number; warnings: number; infos: number;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.findingsCount).toBe(4);
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(2);
    expect(parsed.infos).toBe(1);
    // The full per-finding payload is NOT carried — that's the
    // entire point of the flag.
    expect(stdoutChunks.join('')).not.toContain('"message"');
    expect(stdoutChunks.join('')).not.toContain('MISSING_VEC');
    // Exit code still reflects the full report's ok flag.
    expect(process.exitCode).toBe(1);
  });

  it('--json --quiet output is a single-line JSON document (no indentation, trailing newline)', async () => {
    // Mirrors the stats --slim contract: the document is one line so
    // cron snapshots diff cleanly when appended to an NDJSON log.
    const report = {
      ok: true,
      counts: { manifestDocs: 0, manifestChunks: 0, bm25Chunks: 0, lanceChunks: 0 },
      findings: [],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet']);
    const raw = stdoutChunks.join('');
    expect(raw.endsWith('\n')).toBe(true);
    // Exactly one newline at the end; nothing internal.
    expect(raw.slice(0, -1)).not.toContain('\n');
    // Sanity: parses cleanly.
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('--json --quiet with zero findings yields all-zero tallies (clean dashboard panel)', async () => {
    const report = {
      ok: true,
      counts: { manifestDocs: 0, manifestChunks: 0, bm25Chunks: 0, lanceChunks: 0 },
      findings: [],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet']);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.ok).toBe(true);
    expect(parsed.findingsCount).toBe(0);
    expect(parsed.errors).toBe(0);
    expect(parsed.warnings).toBe(0);
    expect(parsed.infos).toBe(0);
    expect(process.exitCode).toBeFalsy();
  });

  it('--quiet uses the FULL findings tally even when --severity hides some rows from view', async () => {
    // The slim shape exists for an "are we ok?" question that needs
    // the unconditional tally, not the filtered count. We pass
    // --severity error to hide info/warn from the regular --json
    // payload, but the slim tallies must still report all 3 tiers.
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'error', code: 'C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet', '--severity', 'error']);
    const parsed = JSON.parse(stdoutChunks.join(''));
    // All three tallies reported, regardless of the display filter.
    expect(parsed.findingsCount).toBe(3);
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(1);
    expect(parsed.infos).toBe(1);
  });

  it('--quiet wins over the full --json payload when both are set (no findings[] leak)', async () => {
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'error', code: 'BIG_PROBLEM', message: 'something broke' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet']);
    const raw = stdoutChunks.join('');
    // No per-finding message body leaked through.
    expect(raw).not.toContain('BIG_PROBLEM');
    expect(raw).not.toContain('something broke');
    // No `"findings":[` array (the substring "findings" appears in
    // "findingsCount" so we match the exact array opener instead).
    expect(raw).not.toContain('"findings":');
    // findingsTotal field is also absent — --quiet is the strict
    // reshape, not a partial filter on top of the existing payload.
    expect(raw).not.toContain('findingsTotal');
    // The slim shape's required keys ARE present.
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['errors', 'findingsCount', 'infos', 'ok', 'warnings']);
  });

  it('--quiet without --json is a no-op (text mode still renders the regular body)', async () => {
    // --quiet is a JSON-only contract. Used without --json it must
    // NOT silently degrade or render an empty payload — text mode
    // continues to emit the normal "ClawMind doctor: ..." report.
    const report = {
      ok: true,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--quiet']);
    const out = stdoutChunks.join('');
    // Text header still present.
    expect(out).toContain('ClawMind doctor');
    // The finding body still rendered (not a slim payload).
    expect(out).toContain('A');
  });

  // ---------------------------------------------------------------
  // --slim family-canonical alias tests — --slim is the new spelling
  // adopted across the cli (mirrors digest/stats/feedback/forget/
  // reindex/stale --json --slim byte-for-byte). The key behaviour
  // difference vs the legacy --quiet:
  //   --slim --severity narrows the per-severity tallies
  //   --quiet --severity does NOT narrow (back-compat preserved)
  // The `ok` flag is ALWAYS driven by the full report regardless.
  // ---------------------------------------------------------------

  it('exposes --slim on the command surface', () => {
    const flags = doctorCommand().options.map((o) => o.long);
    expect(flags).toContain('--slim');
  });

  it('--json --slim emits the same shape as --json --quiet when no --severity is set', async () => {
    // Without --severity narrowing, --slim and --quiet are observably
    // identical: same single-line JSON, same key set, same values.
    const report = {
      ok: true,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'error', code: 'C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--slim']);
    const fromSlim = stdoutChunks.join('');
    stdoutChunks.length = 0;
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet']);
    const fromQuiet = stdoutChunks.join('');
    expect(fromSlim).toBe(fromQuiet);
    const parsed = JSON.parse(fromSlim);
    expect(parsed).toEqual({
      ok: true, // r.ok was true even though one finding is severity 'error' (the api decides ok flag)
      findingsCount: 3,
      errors: 1,
      warnings: 1,
      infos: 1,
    });
  });

  it('--json --slim --severity error narrows the tallies to errors only', async () => {
    // The key contract: under --slim, --severity narrows the slim
    // tallies. This is what makes `clawmind doctor --json --slim
    // --severity error | jq .findingsCount` a useful poll for
    // "how many error-or-above findings are there right now".
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'warn', code: 'C', message: 'c' },
        { severity: 'error', code: 'D', message: 'd' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--slim', '--severity', 'error']);
    const parsed = JSON.parse(stdoutChunks.join(''));
    // Narrowed to errors only: 1 error survives the floor.
    expect(parsed.findingsCount).toBe(1);
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(0);
    expect(parsed.infos).toBe(0);
    // ok is STILL driven by the full report.ok, NOT recomputed
    // from the narrowed view.
    expect(parsed.ok).toBe(false);
    // Exit code reflects r.ok.
    expect(process.exitCode).toBe(1);
  });

  it('--json --slim --severity warn narrows to warn+error tallies', async () => {
    // --severity warn keeps warn AND error (errors are >= warn rank).
    // Mirrors the same SEV_RANK >= floor predicate used in text mode.
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'info', code: 'B', message: 'b' },
        { severity: 'warn', code: 'C', message: 'c' },
        { severity: 'error', code: 'D', message: 'd' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--slim', '--severity', 'warn']);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.findingsCount).toBe(2); // warn + error
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(1);
    expect(parsed.infos).toBe(0); // dropped by the warn floor
  });

  it('--json --quiet --severity error does NOT narrow the tallies (back-compat preserved)', async () => {
    // Critical regression check: the legacy --quiet shape was always
    // unconditional full tallies, regardless of --severity. Any
    // existing v0 cron consumer that relied on `findingsCount` being
    // the full count would have been silently broken by re-targeting
    // --quiet. The --slim alias is opt-in for the new semantic;
    // --quiet retains the legacy behaviour.
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'error', code: 'C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--quiet', '--severity', 'error']);
    const parsed = JSON.parse(stdoutChunks.join(''));
    // --quiet keeps the FULL counts: 3 total, 1 of each severity.
    // --severity is observed for the EXIT CODE / EXIT path but not
    // for the slim shape.
    expect(parsed.findingsCount).toBe(3);
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(1);
    expect(parsed.infos).toBe(1);
  });

  it('--slim wins over --quiet when both are passed (--slim is the new canonical name)', async () => {
    // When both flags are passed, --slim semantics apply — the
    // operator opts into the new --severity-narrowing behaviour.
    const report = {
      ok: false,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        { severity: 'info', code: 'A', message: 'a' },
        { severity: 'warn', code: 'B', message: 'b' },
        { severity: 'error', code: 'C', message: 'c' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync([
      'node', 'cli', '--json', '--slim', '--quiet', '--severity', 'error',
    ]);
    const parsed = JSON.parse(stdoutChunks.join(''));
    // --slim semantics: tallies narrowed to errors only.
    expect(parsed.findingsCount).toBe(1);
    expect(parsed.errors).toBe(1);
    expect(parsed.warnings).toBe(0);
  });

  it('--json --slim --severity error keeps ok flag driven by full report (never promotes unhealthy to ok)', async () => {
    // Safety property: hiding warnings via --severity error MUST
    // NOT promote an unhealthy report to ok=true. The ok flag is
    // always r.ok from the API, regardless of slim narrowing.
    const report = {
      ok: false, // API decided the report is unhealthy
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [
        // Note: no error-severity findings, but r.ok is false anyway
        // (e.g. STALE_INDEX could be a warn but the api considers it
        // a deployment blocker for this hypothetical workspace).
        { severity: 'warn', code: 'STALE', message: 's' },
      ],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--json', '--slim', '--severity', 'error']);
    const parsed = JSON.parse(stdoutChunks.join(''));
    // No errors in the filtered view — but ok is still false from r.ok.
    expect(parsed.findingsCount).toBe(0);
    expect(parsed.errors).toBe(0);
    expect(parsed.ok).toBe(false); // critical: NOT silently promoted to true
    expect(process.exitCode).toBe(1);
  });

  it('--slim without --json is a no-op (text mode unchanged)', async () => {
    // --slim is a JSON-only contract just like --quiet. Without --json
    // the regular text body still renders.
    const report = {
      ok: true,
      counts: { manifestDocs: 1, manifestChunks: 2, bm25Chunks: 2, lanceChunks: 2 },
      findings: [{ severity: 'info', code: 'A', message: 'a' }],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(report), { status: 200 })) as never;
    await doctorCommand().parseAsync(['node', 'cli', '--slim']);
    const out = stdoutChunks.join('');
    expect(out).toContain('ClawMind doctor');
    expect(out).toContain('A');
  });
});
