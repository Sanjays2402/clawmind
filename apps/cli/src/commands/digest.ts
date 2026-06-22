import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

class ApiError extends Error {
  constructor(public readonly cleanMessage: string) {
    super(cleanMessage);
  }
}

async function apiFetch(method: string, path: string, body?: unknown) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(`cannot reach ${base} (${msg})`);
  }
  if (!res.ok) {
    let detail = (await res.text()).trim();
    try {
      const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
      if (typeof parsed.message === 'string') detail = parsed.message;
      else if (typeof parsed.error === 'string') detail = parsed.error;
    } catch {
      // not JSON, keep as text
    }
    if (detail.length > 200) detail = detail.slice(0, 200) + '...';
    const suffix = detail ? `: ${detail}` : '';
    throw new ApiError(`${res.status} ${res.statusText}${suffix}`);
  }
  return res.json();
}

async function runAction(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.cleanMessage}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtTime(ts: number | null) {
  if (!ts) return kleur.gray('never');
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

export function digestCommand() {
  const cmd = new Command('digest').description('Re-run saved searches and show what changed');

  cmd.command('list')
    .description('List saved searches with last digest run summary')
    .option('-q, --q <text>', 'case-insensitive substring filter across id, title, and query')
    .option('--since <iso-date>', 'keep only saved searches whose lastRunTs is strictly less than this ISO date (i.e. those that have NOT been re-run since the cutoff). The natural cron use is finding overdue digests: `clawmind digest list --since "$(date -u -d \'1 hour ago\' +%FT%TZ)"` answers "which saved searches need re-running" without having to mentally subtract dates from the timestamps. Mirrors `digest run --since` semantics byte-for-byte: a digest with lastRunTs === null (never run) is ALWAYS INCLUDED (a never-run digest is the most extreme case of "overdue"), and the cutoff comparison uses strict less-than. Composes with -q as an intersection (substring filter on id/title/query AND lastRunTs predates cutoff). Parse failures abort cleanly with exit 1. Filter applies BEFORE --json / text rendering so both modes see the same survivors.')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; since?: string; json?: boolean }) => {
     await runAction('digest list', async () => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      let out = (await apiFetch('GET', `/v1/digests${qs}`)) as {
        items: {
          savedSearchId: string; title: string; query: string;
          lastRunTs: number | null; lastNewCount: number; lastRemovedCount: number; runs: number;
        }[];
      };
      // --since narrows the listed set to saved searches whose
      // lastRunTs predates the cutoff. This is the "show me which
      // digests are overdue for a re-run" question — the inverse
      // of `digest run --since` which actually runs the matching
      // batch. A common cron pattern is:
      //   clawmind digest list --since "..." --json  -> count
      //                                                     overdue
      //                                                     digests
      //   clawmind digest run --since "..."                -> run them
      // Both consume the same cutoff so a dashboard probe and the
      // run command stay in sync.
      //
      // Critical contract (mirrors `digest run --since`):
      //   - lastRunTs === null (never-run digest) is ALWAYS
      //     INCLUDED — that is the most extreme case of "overdue"
      //     and a filter that hid never-runs would lie to the
      //     dashboard the moment the operator added a new saved
      //     search.
      //   - strict less-than (<) so a digest at exactly the cutoff
      //     is EXCLUDED — it ran AT the cutoff, which means
      //     re-listing it as overdue would contradict the
      //     operator's "leave alone if it ran within the last
      //     hour" intent.
      //
      // Parse failures abort cleanly via the existing ApiError
      // path so a typo like `--since 2026-13-01` does not silently
      // degrade to "no filter" (which would surprise the operator
      // who expected the cutoff to narrow things down).
      if (opts.since) {
        const cutoff = Date.parse(opts.since);
        if (!Number.isFinite(cutoff)) {
          throw new ApiError(`--since value "${opts.since}" is not a valid ISO date`);
        }
        out = {
          ...out,
          items: out.items.filter((it) => {
            if (it.lastRunTs === null) return true; // never run -> always include
            return it.lastRunTs < cutoff;            // ran before cutoff -> include
          }),
        };
      }
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      if (out.items.length === 0) { process.stdout.write(kleur.gray('no saved searches\n')); return; }
      for (const it of out.items) {
        process.stdout.write(
          `${kleur.bold(it.title)}  ${kleur.gray(it.savedSearchId)}\n` +
          `  ${kleur.gray('query:')} ${it.query}\n` +
          `  ${kleur.gray('last:')}  ${fmtTime(it.lastRunTs)}  ` +
          `${kleur.green(`+${it.lastNewCount}`)} ${kleur.red(`-${it.lastRemovedCount}`)}  ` +
          `${kleur.gray(`(${it.runs} runs)`)}\n`,
        );
      }
     });
    });

  cmd.command('run [id]')
    .description('Run one saved search by id, or all if no id given')
    .option('--since <iso-date>', 'with no id: skip saved searches whose lastRunTs is at-or-after this ISO date. The natural cron use is "re-run only the digests that have not run in the last hour": `clawmind digest run --since "$(date -u -d \'1 hour ago\' +%FT%TZ)"` lets a frequent cron tick (every 5min) catch newly-added digests AND digests that have drifted past their refresh budget, while skipping anything a slower tick (every hour) already covered. Critical contract: a digest with lastRunTs === null (never run) is ALWAYS INCLUDED (a never-run digest is the most extreme case of "needs running" — a filter that hid never-runs would be unsafe for a saved search the operator just added). The cutoff comparison uses strict less-than: a digest whose lastRunTs is exactly the cutoff IS SKIPPED — it ran AT the cutoff so re-running it now would breach the operator\'s "leave alone if it ran within the last hour" intent. Parse failures abort cleanly. Ignored when an id is passed (a single-id `digest run X --since Y` would either skip the only thing it was asked to do or always run it; both are confusing).')
    .option('--max <n>', 'with no id: cap how many saved searches are run in this batch. Surviving candidates after --since narrowing are kept in API order (newest-first) and the head N are run; the remainder roll over to the next tick. Pairs naturally with --since for a tight cron budget: `digest run --since "..." --max 10` caps both wall-clock AND LLM/embed cost when a tick catches a big stale wave. The skipped count in the report covers BOTH the --since-skipped and the --max-deferred digests, but the text-mode summary narrates them separately so the cron log is auditable ("ran 10, deferred 3, not stale enough 2"). A non-positive or NaN value is rejected cleanly — a typo cannot silently become an empty batch. Ignored when an id is passed (single-id runs always run that one digest regardless of cap).', (v) => Number.parseInt(v, 10))
    .option('--slim', 'with --json: emit a slimmed `{ran, deferred, sinceSkipped}` shape (3 fields only) instead of the full per-digest results array. Mirrors `doctor --json --quiet` byte-for-byte: a tight cron dashboard panel that only needs "did the cron tick get through the batch" can poll this without piping the full per-id results through `jq` for the totals. Pairs naturally with --max: `digest run --max 10 --since "..." --json --slim` is the canonical cron-budget probe — three integers tell the dashboard whether the cap fired, whether the cutoff filtered candidates, and how many actually ran. Single-line JSON output so an NDJSON snapshot stream diffs cleanly between ticks. Ignored without --json (text-mode summary is already a one-liner). Ignored when an id is passed (single-id runs never produce ran/deferred/sinceSkipped counts to slim).')
    .option('--json', 'emit the run report as JSON for scripting')
    .action(async (id: string | undefined, opts: { json?: boolean; since?: string; max?: number; slim?: boolean }) => {
     await runAction('digest run', async () => {
      if (id) {
        const out = (await apiFetch('POST', `/v1/digests/${id}/run`)) as {
          entry: { newSources: { path: string }[]; removedSources: string[] };
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        process.stdout.write(kleur.green(`new (${out.entry.newSources.length}):\n`));
        for (const s of out.entry.newSources) process.stdout.write(`  + ${s.path}\n`);
        process.stdout.write(kleur.red(`removed (${out.entry.removedSources.length}):\n`));
        for (const r of out.entry.removedSources) process.stdout.write(`  - ${r}\n`);
      } else if (opts.since || opts.max !== undefined) {
        // --since narrows the batch to saved searches whose
        // lastRunTs predates the cutoff. The natural cron use is
        // a frequent tick (every 5min) that catches newly-added
        // digests + digests drifted past their refresh budget,
        // while skipping anything a slower tick already covered.
        //
        // --max caps how many of the survivors actually run in
        // this batch. Pairs naturally with --since for a tight
        // cron budget: a 5min tick that catches a big stale wave
        // (say 30 digests need running) can ride out the wave
        // across multiple ticks instead of blowing the LLM/embed
        // budget on a single one. The deferred digests roll over
        // to the next tick because they STILL satisfy --since
        // next time it fires.
        //
        // We invoke the per-id run endpoint for each chosen
        // digest rather than calling /v1/digests/run (which
        // unconditionally runs every saved search) so the batch
        // honours both filters.
        //
        // Validation:
        //   - --since: parse failures abort cleanly via ApiError
        //   - --max: non-positive / NaN aborts BEFORE the list
        //     fetch — a typo cannot silently become an empty
        //     batch (which a real "nothing to run" tick is
        //     indistinguishable from in the report)
        //
        // Contract details (unchanged from the pre-existing --since path):
        //   - lastRunTs === null (never-run digest) is ALWAYS
        //     INCLUDED — that's the most extreme case of "needs
        //     running" and a filter that hid never-runs would
        //     be unsafe for a new saved search the operator
        //     just added
        //   - strict less-than (<) so a digest at exactly the
        //     cutoff is SKIPPED — it ran AT the cutoff, which
        //     means it satisfies the operator's "leave alone if
        //     it ran within the last hour" intent (re-running
        //     would be more eager than asked)
        //   - errors on a single digest run do NOT abort the
        //     batch (other digests proceed); the report's
        //     `results` only carries successful runs
        if (opts.max !== undefined && (!Number.isFinite(opts.max) || opts.max <= 0)) {
          throw new ApiError(`--max value must be a positive integer (got "${opts.max}")`);
        }
        let cutoff: number | null = null;
        if (opts.since) {
          const parsed = Date.parse(opts.since);
          if (!Number.isFinite(parsed)) {
            throw new ApiError(`--since value "${opts.since}" is not a valid ISO date`);
          }
          cutoff = parsed;
        }
        const listed = (await apiFetch('GET', '/v1/digests')) as {
          items: { savedSearchId: string; title: string; query: string; lastRunTs: number | null }[];
        };
        const sinceFiltered = listed.items.filter((it) => {
          if (cutoff === null) return true;
          if (it.lastRunTs === null) return true; // never run -> always include
          return it.lastRunTs < cutoff;            // ran before cutoff -> include
        });
        // --max caps the surviving set. API returns items
        // newest-first (insertion order or recency depending on
        // the route, but stable for repeated calls); slice(0, N)
        // is the right shape and the deferred suffix rolls over
        // to the next tick. The `deferred` count is surfaced
        // separately from --since-skipped so the cron log can
        // narrate the two reasons distinctly.
        const candidates = opts.max !== undefined
          ? sinceFiltered.slice(0, opts.max)
          : sinceFiltered;
        const sinceSkipped = listed.items.length - sinceFiltered.length;
        const deferred = sinceFiltered.length - candidates.length;
        const results: { savedSearchId: string; newCount: number; removedCount: number }[] = [];
        for (const c of candidates) {
          try {
            const out = (await apiFetch('POST', `/v1/digests/${c.savedSearchId}/run`)) as {
              entry: { newSources: { path: string }[]; removedSources: string[] };
            };
            results.push({
              savedSearchId: c.savedSearchId,
              newCount: out.entry.newSources.length,
              removedCount: out.entry.removedSources.length,
            });
          } catch {
            // A single digest failure must not abort the batch.
            // The cron tick that fires every 5min cannot afford
            // to crash on one broken saved search and leave the
            // other N digests un-refreshed. The skipped digest
            // will be re-attempted on the next tick anyway.
            // Intentionally leave the failure out of results[]
            // so a consumer counting successful runs gets the
            // honest number.
          }
        }
        const report = {
          ran: results.length,
          // Combined "skipped" preserves the legacy --since contract
          // — every digest not in `results` is a skip from the
          // caller's POV. The text body breaks it down into the
          // two reasons so the cron log is readable, and we also
          // surface them as separate keys in the JSON payload so a
          // dashboard can distinguish "we hit the cap" from "the
          // operator's cutoff caught everything".
          skipped: sinceSkipped + deferred,
          sinceSkipped,
          deferred,
          since: opts.since,
          max: opts.max,
          results,
        };
        if (opts.json) {
          // --slim emits a 3-field shape carrying ONLY the counts a
          // cron-dashboard panel cares about. Mirrors `doctor --json
          // --quiet` byte-for-byte: single-line JSON, no nested per-
          // digest details, only the integers a status panel needs.
          // The canonical cron poll is:
          //   clawmind digest run --since "..." --max 10 --json --slim
          // which answers three questions in one shot: did the cap
          // fire (deferred > 0), did the cutoff filter candidates
          // (sinceSkipped > 0), how many actually ran (ran). A
          // downstream `jq` over an NDJSON snapshot stream can
          // graph all three over time without parsing the full
          // per-id results blob (which on a workspace with 200
          // saved searches is megabytes per snapshot vs three
          // bytes for the slim shape).
          //
          // `ran` is the count of successful runs (matches
          // report.ran which is results.length). `deferred` and
          // `sinceSkipped` are surfaced separately so the
          // dashboard can distinguish "the operator's cutoff
          // caught everything" from "we hit the cap". The total
          // `skipped` is recomputable as deferred+sinceSkipped
          // if a consumer wants the legacy combined number.
          //
          // We deliberately use single-line JSON.stringify (no
          // indent) so a snapshot stream like
          //   while true; do clawmind digest run ... --json --slim; sleep 60; done
          // produces clean NDJSON that diffs cleanly between
          // ticks (multi-line indent would force every snapshot
          // diff to walk indentation noise).
          if (opts.slim) {
            const slim = {
              ran: report.ran,
              deferred: report.deferred,
              sinceSkipped: report.sinceSkipped,
            };
            process.stdout.write(JSON.stringify(slim) + '\n');
            return;
          }
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          return;
        }
        const fragments: string[] = [`ran ${report.ran} saved search${report.ran === 1 ? '' : 'es'}`];
        if (deferred > 0) fragments.push(`deferred ${deferred} over --max ${opts.max}`);
        if (sinceSkipped > 0) fragments.push(`skipped ${sinceSkipped} not stale enough (--since ${opts.since})`);
        process.stdout.write(kleur.gray(fragments.join(', ') + '\n'));
        for (const r of report.results) {
          process.stdout.write(`  ${r.savedSearchId}  ${kleur.green(`+${r.newCount}`)} ${kleur.red(`-${r.removedCount}`)}\n`);
        }
      } else {
        const out = (await apiFetch('POST', '/v1/digests/run')) as {
          ran: number; results: { savedSearchId: string; newCount: number; removedCount: number }[];
        };
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        process.stdout.write(kleur.gray(`ran ${out.ran} saved searches\n`));
        for (const r of out.results) {
          process.stdout.write(`  ${r.savedSearchId}  ${kleur.green(`+${r.newCount}`)} ${kleur.red(`-${r.removedCount}`)}\n`);
        }
      }
     });
    });

  cmd.command('show <id>')
    .description('Show full run history for one saved search')
    .option('-q, --q <text>', 'case-insensitive substring filter; keep only history rows that touched a matching path (in newSources or removedSources)')
    .option('--since <iso-date>', 'bound the history window by absolute date; keep only rows whose ts is at-or-after the cutoff. Pairs naturally with -q for "what did saved-search X surface about path Y after date Z" queries from cron. Composes with -q (intersection: row must both touch a matching path AND be at-or-after the cutoff). Parse failures abort cleanly.')
    .option('--last <n>', 'cap the history rows returned to the newest N. Applied AFTER -q / --since so the cap is "the newest N rows that pass the other filters". Useful as a sliding-window companion to --since for cron snapshots ("the 5 most recent runs in the last week") and as a quick "tail" for big histories without --json | jq slicing. A non-positive or non-numeric value is rejected cleanly.', (v) => Number.parseInt(v, 10))
    .option('--json', 'emit the history as JSON for scripting')
    .action(async (id: string, opts: { q?: string; since?: string; last?: number; json?: boolean }) => {
     await runAction('digest show', async () => {
      const out = (await apiFetch('GET', `/v1/digests/${id}`)) as {
        state: { query: string; history: { ts: number; newSources: { path: string }[]; removedSources: string[]; totalSources: number }[] };
      };
      // -q keeps only history rows where AT LEAST ONE path in either
      // newSources or removedSources matches the substring (case
      // insensitive). This is the "show me runs that touched a path
      // about X" semantic — the same shape `digest list -q` uses,
      // except `list` filters at the API on saved-search id/title/
      // query whereas `show` filters client-side on the history rows
      // it received (we keep all rows in the JSON response shape so
      // a follow-up `--json` consumer sees exactly what was kept,
      // not a magically-shrunk total count). Empty history rows
      // (totalSources but no new/removed) are filtered out by -q
      // because they have nothing to match against — which is what
      // an operator searching for "what changed about /foo.md" wants.
      let filteredHistory = out.state.history;
      if (opts.q) {
        const needle = opts.q.toLowerCase();
        filteredHistory = filteredHistory.filter((h) =>
          h.newSources.some((s) => s.path.toLowerCase().includes(needle)) ||
          h.removedSources.some((p) => p.toLowerCase().includes(needle)),
        );
      }
      // --since <iso-date> bounds the history window by absolute
      // wall-clock. We compose AFTER -q so the intersection is
      // "row must both touch a matching path AND be at-or-after
      // the cutoff" — that's the question an operator asks when
      // they want "what did this saved search find about path Y
      // since date Z". The cutoff is inclusive (>=) because a row
      // with ts === cutoff is "from the cutoff onwards" by every
      // colloquial reading. Parse failures abort cleanly through
      // the existing apiFetch error path so a typo does not
      // silently degrade into "no filter".
      if (opts.since) {
        const cutoff = Date.parse(opts.since);
        if (!Number.isFinite(cutoff)) {
          throw new ApiError(`--since value "${opts.since}" is not a valid ISO date`);
        }
        filteredHistory = filteredHistory.filter((h) => h.ts >= cutoff);
      }
      // --last <n> caps the history to the newest N rows. We apply it
      // LAST (after -q and --since) so the semantics are "the newest
      // N rows that pass every other filter" — that is the question
      // an operator asks ("the 5 most recent runs about path Y in
      // the last week" composes the three flags naturally). The
      // history rows arrive newest-first from the API, so slice(0, N)
      // is the right shape and we do not need to re-sort. A
      // non-positive or NaN value is rejected through the standard
      // apiFetch error path so a typo like `--last 0` does not
      // silently produce an empty result that an operator would
      // misread as "nothing to report" (a real possibility because
      // a sparse history is normal). Forwarding zero through to a
      // slice(0, 0) would also break the empty-state hint logic
      // below — it can't distinguish "filter narrowed to zero" from
      // "history was empty to begin with".
      if (opts.last !== undefined) {
        if (!Number.isFinite(opts.last) || opts.last <= 0) {
          throw new ApiError(`--last value must be a positive integer (got "${opts.last}")`);
        }
        filteredHistory = filteredHistory.slice(0, opts.last);
      }
      const payload = {
        state: { ...out.state, history: filteredHistory },
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        return;
      }
      process.stdout.write(kleur.gray(`query: ${out.state.query}\n`));
      if ((opts.q || opts.since || opts.last !== undefined) && filteredHistory.length === 0) {
        // Tell the operator we found nothing without making them dig.
        // The "query: <q>" line above stays so they still see the
        // saved search context. The hint mentions whichever filter(s)
        // narrowed the result set so it's clear what they need to
        // relax to see more rows.
        const filterParts: string[] = [];
        if (opts.q) filterParts.push(`-q "${opts.q}"`);
        if (opts.since) filterParts.push(`--since ${opts.since}`);
        if (opts.last !== undefined) filterParts.push(`--last ${opts.last}`);
        process.stdout.write(kleur.gray(`no history rows match ${filterParts.join(' + ')}\n`));
        return;
      }
      for (const h of filteredHistory) {
        process.stdout.write(
          `${fmtTime(h.ts)}  ` +
          `${kleur.green(`+${h.newSources.length}`)} ${kleur.red(`-${h.removedSources.length}`)}  ` +
          `(${h.totalSources} total)\n`,
        );
      }
     });
    });

  return cmd;
}
