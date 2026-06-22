import { Command } from 'commander';
import kleur from 'kleur';
import { buildRuntime } from '../runtime.js';

// `clawmind status` is the operator's "is everything healthy?" smoke
// check. Beyond the static counts (workspace, documents, chunks) we
// surface two pieces of context that have repeatedly proven useful when
// chasing why CI looks green locally but red in a container:
//
//   1. the resolved api base URL (host:port). The cli, web, and several
//      side services all read CLAWMIND_API_HOST / CLAWMIND_API_PORT, and
//      a typo in one .env file is the usual culprit. Echoing the URL the
//      runtime would dial removes the guesswork.
//   2. the per-probe latency for the embed and llm health checks. A
//      provider that is "up but slow" is the failure mode users actually
//      notice in production; reporting the wall-clock time on the probe
//      both calls out the regression early and gives Sanjay a number to
//      put in a bug report.
//
// We measure with `performance.now()` so the figure survives clock skew
// and is monotonic on all the platforms ClawMind targets. The probe is
// allowed to fail without crashing the command: a slow / down provider
// becomes a `down` flag plus the latency we observed up to the timeout.

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

interface StatusSnapshot {
  workspace: string;
  apiBase: string;
  documents: number;
  chunks: number;
  bm25Docs: number;
  embed: 'ok' | 'down';
  llm: 'ok' | 'down';
  embedLatencyMs: number;
  llmLatencyMs: number;
  ok: boolean;
}

// One full poll of the status snapshot (probes both providers in
// parallel, sums the static counts). Pulled out of the action body so
// the --watch loop can re-invoke it on each tick WITHOUT the cost of
// rebuilding the runtime (lance / bm25 / manifest stay warm across
// polls). Returns the same shape both --json and text modes consume.
async function snapshotStatus(rt: Awaited<ReturnType<typeof buildRuntime>>): Promise<StatusSnapshot> {
  const apiBase = `http://${rt.env.CLAWMIND_API_HOST}:${rt.env.CLAWMIND_API_PORT}`;
  const [embedProbe, llmProbe, chunks] = await Promise.all([
    timed(() => rt.embed.health() as Promise<boolean>),
    timed(() => rt.llm.health() as Promise<boolean>),
    rt.lance.count() as Promise<number>,
  ]);
  const embedOk = Boolean(embedProbe.value);
  const llmOk = Boolean(llmProbe.value);
  return {
    workspace: rt.workspace,
    apiBase,
    documents: rt.manifest.size(),
    chunks,
    bm25Docs: rt.bm25.size(),
    embed: embedOk ? 'ok' : 'down',
    llm: llmOk ? 'ok' : 'down',
    embedLatencyMs: embedProbe.ms,
    llmLatencyMs: llmProbe.ms,
    ok: embedOk && llmOk,
  };
}

function renderText(snap: StatusSnapshot): string {
  const fmtProbe = (state: 'ok' | 'down', ms: number) => {
    const label = state === 'ok' ? kleur.green('ok') : kleur.red('down');
    return `${label}  ${kleur.gray(`(${ms}ms)`)}`;
  };
  return [
    kleur.bold('ClawMind status'),
    `  workspace : ${snap.workspace}`,
    `  api       : ${snap.apiBase}`,
    `  documents : ${snap.documents}`,
    `  chunks    : ${snap.chunks}`,
    `  bm25 docs : ${snap.bm25Docs}`,
    `  embed     : ${fmtProbe(snap.embed, snap.embedLatencyMs)}`,
    `  llm       : ${fmtProbe(snap.llm, snap.llmLatencyMs)}`,
  ].join('\n') + '\n';
}

function emitCheckStderr(snap: StatusSnapshot) {
  // Also drop a one-line summary to stderr so a script that redirected
  // stdout to /dev/null still sees WHICH probe was down. We
  // intentionally name only the down probes; an operator scanning
  // `journalctl` should not have to re-parse the table to find the
  // offender.
  const down: string[] = [];
  if (snap.embed === 'down') down.push('embed');
  if (snap.llm === 'down') down.push('llm');
  process.stderr.write(kleur.red(`status --check: ${down.join(' + ')} down\n`));
}

export function statusCommand() {
  return new Command('status')
    .description('Print index status and provider health')
    .option('--json', 'emit status as JSON for scripting')
    .option('--check', 'exit non-zero (code 2) when any probe is down. Designed for CI smoke checks — pipes back the same JSON / text body but flips the exit code so a flat `clawmind status --check` is a usable health-check command in a wider script.')
    .option('--watch <ms>', 'repoll the status snapshot every <ms> milliseconds for a live terminal dashboard. Without --json, each cycle clears the previous render and re-emits the table in place so the operator watches a single refreshing panel (uses ANSI cursor-up + clear-line, falls back to a fresh print on dumb terminals). With --json, each cycle emits one self-contained JSON document on its own line — NDJSON shape by construction so `clawmind status --watch 5000 --json | jq -c .` streams the snapshot for graphing. Polling continues until SIGINT (Ctrl-C) or --max-polls is reached. The minimum interval is 100ms (anything lower would just thrash the providers). Mirrors the polling-loop UX of `top`/`htop` without forcing the operator to wrap the cli in `watch -n 5 clawmind status`. Each cycle reuses the SAME runtime (lance/bm25/manifest stay warm) so per-tick latency is dominated by the two health probes, not the cli warmup.', (v) => Number.parseInt(v, 10))
    .option('--max-polls <n>', 'with --watch: stop after N polling cycles instead of looping until SIGINT. Useful for cron-style probes that want a bounded number of snapshots (`--watch 5000 --max-polls 3` emits 3 snapshots 5s apart then exits cleanly), and required for the test suite to exercise the loop without leaking timers. Ignored without --watch (a one-shot status is already bounded). Non-positive or non-numeric values are rejected up front rather than silently degrading to "no cap" (which on a flag whose entire purpose is to bound the loop is the worst possible failure mode).', (v) => Number.parseInt(v, 10))
    .action(async (opts: { json?: boolean; check?: boolean; watch?: number; maxPolls?: number }) => {
      // --watch validation up front. We REJECT non-positive / NaN /
      // sub-100ms intervals before doing any work because a typo'd
      // --watch 0 would melt CPU spinning the probe loop, and a
      // typo'd --watch abc that silently degrades to undefined would
      // make the operator wonder why their dashboard never refreshed.
      // The 100ms floor protects the embed/llm providers from being
      // probed faster than they can plausibly respond.
      if (opts.watch !== undefined) {
        if (!Number.isFinite(opts.watch) || opts.watch < 100) {
          process.stderr.write(kleur.red(`status failed: --watch interval must be >= 100ms (got "${opts.watch}")\n`));
          process.exitCode = 1;
          return;
        }
      }
      // --max-polls validation. Only meaningful when --watch is set.
      // We do NOT throw on --max-polls without --watch — silently
      // ignoring the flag in the one-shot path matches the precedent
      // set by --slim without --json on digest run (a flag whose
      // companion is absent is a no-op, not an error). But we DO
      // validate the value when present so a typo cannot poison a
      // bounded run.
      if (opts.maxPolls !== undefined && (!Number.isFinite(opts.maxPolls) || opts.maxPolls <= 0)) {
        process.stderr.write(kleur.red(`status failed: --max-polls value must be a positive integer (got "${opts.maxPolls}")\n`));
        process.exitCode = 1;
        return;
      }
      const rt = await buildRuntime();

      // ---------------- One-shot path (no --watch) -----------------
      // Unchanged from the pre-watch behaviour byte-for-byte. The
      // --check exit-code logic, the json shape, and the text body
      // are all identical. The --watch path below builds on the same
      // snapshotStatus() helper so the per-cycle output of a watch
      // loop is the same shape a one-shot run produces — a
      // dashboard consuming `clawmind status --json` does not have
      // to special-case the --watch variant.
      if (opts.watch === undefined) {
        const snap = await snapshotStatus(rt);
        if (opts.json) {
          process.stdout.write(JSON.stringify(snap) + '\n');
          if (opts.check && !snap.ok) process.exitCode = 2;
          return;
        }
        process.stdout.write(renderText(snap));
        if (opts.check && !snap.ok) {
          emitCheckStderr(snap);
          process.exitCode = 2;
        }
        return;
      }

      // ----------------- Watch (polling) path ----------------------
      // We loop until --max-polls (if set) or SIGINT. Critical
      // properties:
      //
      //   - Each cycle uses the SAME runtime so lance/bm25/manifest
      //     stay warm; per-cycle latency is dominated by the two
      //     health probes, not the cli warmup.
      //   - --json mode emits ONE self-contained JSON document per
      //     cycle on its own line. That's NDJSON by construction so
      //     `... --watch 5000 --json | jq -c .` streams cleanly and
      //     a snapshot stream diffs without parsing wrapper objects.
      //   - Text mode re-emits the table on each tick. On TTY
      //     stdout we clear the previous render with ANSI cursor-up
      //     + clear-line so the operator sees a single refreshing
      //     panel (the same UX `htop` and `top` give). On non-TTY
      //     stdout (piping to a file, redirect, journal) we fall
      //     back to printing each snapshot in full — no ANSI
      //     control codes that would muddy a log.
      //   - --check on a watch loop sets the FINAL exit code to 2
      //     if the LAST observed snapshot was unhealthy. We do not
      //     exit early on the first bad probe because the watch is
      //     a monitoring tool, not a circuit breaker — the operator
      //     wants to see the recovery cycle. The stderr "X down"
      //     line is emitted on EVERY unhealthy cycle so a journal
      //     tail catches every transition.
      //   - SIGINT (Ctrl-C) is intercepted to break the loop
      //     cleanly so the final exit code still reflects the
      //     final probe state. We restore the handler on exit so
      //     the cli does not leak the listener.
      const intervalMs = opts.watch;
      const maxPolls = opts.maxPolls; // may be undefined (loop forever)
      const useTtyClear = process.stdout.isTTY && !opts.json;
      // A one-line startup banner to stderr — separate from the per-
      // cycle snapshots on stdout — so a log scraper consuming stdout
      // (and discarding it because the snapshot stream is noisy) can
      // still detect a process restart by tailing stderr alone.
      // Mirrors the `watch` command's startup banner byte-for-byte
      // in shape (kind=banner + ts) so a scraper watching for
      // restarts across both commands can use a single grep.
      // Crucial properties:
      //   - fires ONCE, BEFORE the first cycle, so a scraper sees
      //     the marker before any snapshot lands on stdout
      //   - NDJSON shape so a stderr-tailing parser sees the same
      //     event-stream shape it sees on stdout (in --json mode)
      //   - carries the resolved apiBase + the polling interval so
      //     a log correlator knows which status dashboard restarted
      //     and at what cadence
      //   - goes to stderr explicitly so it does not pollute the
      //     stdout NDJSON stream that --json mode emits (mixing the
      //     banner into stdout would force every --json consumer to
      //     special-case kind=banner; keeping it on stderr means
      //     existing consumers do not have to change)
      //   - does NOT fire on the one-shot path (no loop to mark)
      //     and does NOT fire on the --watch validation error path
      //     (no half-started process to mark) — both paths exit
      //     before reaching this point
      const apiBase = `http://${rt.env.CLAWMIND_API_HOST}:${rt.env.CLAWMIND_API_PORT}`;
      process.stderr.write(
        JSON.stringify({
          kind: 'banner',
          apiBase,
          interval: intervalMs,
          ts: new Date().toISOString(),
        }) + '\n',
      );
      let interrupted = false;
      const onSig = () => { interrupted = true; };
      process.once('SIGINT', onSig);
      let lastLineCount = 0;
      let lastSnap: StatusSnapshot | null = null;
      try {
        let polls = 0;
        // Tight loop with an awaited sleep between cycles. We exit
        // when (a) SIGINT was received, OR (b) --max-polls was set
        // and reached. The first cycle fires immediately so the
        // operator sees the dashboard without waiting --watch ms.
        // Subsequent cycles sleep first so the requested cadence is
        // honoured. This matches `watch -n 5 cmd` semantics.
        while (true) {
          const snap = await snapshotStatus(rt);
          lastSnap = snap;
          polls += 1;
          if (opts.json) {
            // Single-line JSON, no trailing newline-newline — pure
            // NDJSON shape. A downstream `jq -c .` (or any line-
            // based consumer) gets one document per line.
            process.stdout.write(JSON.stringify(snap) + '\n');
          } else {
            // Clear the previous render in-place on a TTY so the
            // operator sees one refreshing panel. On a non-TTY
            // (pipe, redirect) we print each snapshot in full —
            // logs benefit from the historic context.
            if (useTtyClear && lastLineCount > 0) {
              // ANSI: \x1b[<n>A = cursor up N lines; \x1b[2K =
              // erase entire line; \x1b[0G = cursor to column 0.
              // We do the up-then-clear sequence per line so a
              // terminal that grew/shrunk between cycles still
              // gets a clean canvas.
              const clear = `\x1b[${lastLineCount}A` + ('\x1b[2K\x1b[0G' + '\x1b[1B').repeat(lastLineCount) + `\x1b[${lastLineCount}A`;
              process.stdout.write(clear);
            }
            const body = renderText(snap);
            process.stdout.write(body);
            // Count the lines we just emitted so the next clear
            // sequence knows how far back to scrub. We strip the
            // trailing newline first so we don't off-by-one when
            // the body ends with '\n'.
            lastLineCount = body.replace(/\n$/, '').split('\n').length;
          }
          if (opts.check && !snap.ok) {
            // On EVERY unhealthy cycle, drop the "X down" hint to
            // stderr so a journal tail catches every transition.
            // The exit code is set at loop-exit (below) to reflect
            // the LAST observed state — the watcher is a monitoring
            // tool, not a tripwire.
            if (!opts.json) emitCheckStderr(snap);
          }
          if (interrupted) break;
          if (maxPolls !== undefined && polls >= maxPolls) break;
          // Sleep for the requested interval, but bail early if
          // SIGINT fires mid-sleep so Ctrl-C is responsive. The
          // outer onSig handler set up before the loop catches
          // SIGINT (sets `interrupted` = true). We mirror it here
          // with a one-shot listener that resolves the sleep
          // promise immediately when the signal lands.
          await new Promise<void>((resolve) => {
            let timer: NodeJS.Timeout | null = null;
            const wake = () => {
              if (timer) clearTimeout(timer);
              resolve();
            };
            timer = setTimeout(() => {
              process.removeListener('SIGINT', wake);
              resolve();
            }, intervalMs);
            timer.unref?.();
            process.once('SIGINT', wake);
          });
        }
      } finally {
        process.removeListener('SIGINT', onSig);
      }
      // Final exit code reflects the LAST observed snapshot. --check
      // is opt-in; without it the watcher exits 0 regardless of
      // probe state.
      if (opts.check && lastSnap && !lastSnap.ok) {
        process.exitCode = 2;
      }
    });
}
