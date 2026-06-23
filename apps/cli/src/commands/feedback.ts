import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/feedback HTTP endpoints. Keeps state in one place
// (the API process owns the data dir) so a vote from `clawmind feedback`
// and a vote from the web UI converge.

class FeedbackCliError extends Error {}

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
    throw new FeedbackCliError(`cannot reach ${base} (${msg})`);
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
    throw new FeedbackCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof FeedbackCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

export function feedbackCommand() {
  const cmd = new Command('feedback').description('Upvote, downvote, list, or clear source feedback');

  cmd.command('up <path>')
    .description('Upvote a source path so retrieval ranks it higher')
    .action(async (path: string) => {
      await runOrReport('feedback up', async () => {
        const out = await apiFetch('POST', '/v1/feedback', { path, vote: 1 });
        process.stdout.write(kleur.green(`+1 ${path} (boost ${(out as { boost: number }).boost.toFixed(2)})\n`));
      });
    });

  cmd.command('down <path>')
    .description('Downvote a source path so retrieval ranks it lower')
    .action(async (path: string) => {
      await runOrReport('feedback down', async () => {
        const out = await apiFetch('POST', '/v1/feedback', { path, vote: -1 });
        process.stdout.write(kleur.yellow(`-1 ${path} (boost ${(out as { boost: number }).boost.toFixed(2)})\n`));
      });
    });

  cmd.command('clear <path>')
    .description('Remove your vote on a source path')
    .action(async (path: string) => {
      await runOrReport('feedback clear', async () => {
        await apiFetch('DELETE', '/v1/feedback', { path });
        process.stdout.write(kleur.gray(`cleared vote on ${path}\n`));
      });
    });

  cmd.command('list')
    .description('List current feedback entries with boost multipliers')
    .option('-q, --q <text>', 'case-insensitive substring filter on source path')
    .option('--above <n>', 'keep only entries whose boost multiplier is strictly greater than this value (typical: --above 1.0 to show only upvote-dominant paths)', (v) => Number.parseFloat(v))
    .option('--below <n>', 'keep only entries whose boost multiplier is strictly less than this value (typical: --below 1.0 to show only downvote-dominant paths)', (v) => Number.parseFloat(v))
    .option('--top <n>', 'cap the listed entries to the N loudest votes by absolute distance from neutral (|boost - 1.0|), descending. Answers "which votes are the LOUDEST regardless of direction" in a single call — the natural cron-audit invocation is `clawmind feedback list --top 10 --json` to surface the entries that drag retrieval ranking the hardest in either direction. Applied AFTER -q / --above / --below so the cap is "the N loudest entries that pass the other filters". Ties at the same |boost - 1.0| distance preserve the API-provided order (deterministic across snapshots). A non-positive or NaN value falls back to "no cap" so a typo like `--top 0` still yields a useful response rather than an empty list (matches `tags list --top` / `stats --top` precedent). Composes naturally with --above/--below: `--above 1.0 --top 5` is "the 5 strongest upvotes", `--below 1.0 --top 5` is "the 5 strongest downvotes", `--top 10` alone (no band filter) is "the 10 loudest entries either direction".', (v) => Number.parseInt(v, 10))
    .option('--sort <key>', 'sort entries by one of: boost (desc — highest-boost first, "show me my most-trusted paths"), path (asc alphabetical, for stable cross-snapshot diffs), ups (desc — most-upvoted first), downs (desc — most-downvoted first). Applied AFTER -q / --above / --below so the sort orders the SURVIVORS of any narrowing filter. Applied BEFORE --top so `--sort downs --top 10` is "the 10 entries with the most downvotes regardless of boost magnitude" — distinct from the existing --top semantic ("the 10 loudest votes by |boost-1.0|") which is a SEPARATE ranking primitive answering a different question. Ties at the same sort key fall back to API order (deterministic across snapshots; secondary sort by the original index). Unknown keys abort cleanly with exit 1 — a typo cannot silently fall back to API order which would be indistinguishable from an empty `--sort` invocation in the cron log. The default (no --sort) preserves the API-returned order — existing scripts diffing `feedback list --json` snapshots stay byte-stable.')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; above?: number; below?: number; top?: number; sort?: string; json?: boolean }) => {
      await runOrReport('feedback list', async () => {
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        let out = (await apiFetch('GET', `/v1/feedback${qs}`)) as {
          items: { path: string; ups: number; downs: number; boost: number }[];
        };
        // --above / --below are client-side post-filters on the boost
        // multiplier. The classic cron use-cases are:
        //   --above 1.0  -> only paths the operator has upvoted-net
        //   --below 1.0  -> only paths the operator has downvoted-net
        //   --above 1.2  -> only the strongest upvotes (audit candidates)
        //   --below 0.8  -> only the strongest downvotes (suppression candidates)
        // We use strict comparisons (`>` and `<`) so a path with
        // boost === 1.0 is excluded from both `--above 1.0` and
        // `--below 1.0` — that path is neutral and the operator
        // asking either question wants signed motion. Both flags
        // compose as an intersection (--above 0.9 --below 1.1 = the
        // "almost neutral" band). Invalid numeric values abort
        // cleanly so `--above foo` does not silently degrade to
        // "no filter" (which would be surprising when the operator
        // expected it to narrow things down). The filter applies
        // BEFORE the --json emit / text rendering so both output
        // modes see the same subset.
        if (opts.above !== undefined && !Number.isFinite(opts.above)) {
          throw new FeedbackCliError(`--above value is not a number`);
        }
        if (opts.below !== undefined && !Number.isFinite(opts.below)) {
          throw new FeedbackCliError(`--below value is not a number`);
        }
        if (opts.above !== undefined || opts.below !== undefined) {
          out = {
            ...out,
            items: out.items.filter((it) => {
              if (opts.above !== undefined && it.boost <= opts.above) return false;
              if (opts.below !== undefined && it.boost >= opts.below) return false;
              return true;
            }),
          };
        }
        // --sort orders the SURVIVORS of any narrowing filter. It is a
        // separate ranking primitive from --top: --top ranks by absolute
        // distance from neutral (|boost - 1.0|), while --sort ranks by an
        // operator-chosen axis. The two compose deliberately:
        //   --sort downs --top 10  -> the 10 entries with the most
        //                              downvotes (regardless of boost
        //                              magnitude); --sort wins the
        //                              ordering, --top caps the head
        //   --sort boost           -> highest-boost first ("show me my
        //                              most-trusted paths")
        //   --sort path            -> alphabetical, for stable cross-
        //                              snapshot diffs of `feedback list
        //                              --json`
        //
        // We apply --sort AFTER the narrowing filters (-q / --above /
        // --below) so the sort orders the kept set — the operator's
        // expectation is "sort what I asked for, not the original API
        // payload". We apply it BEFORE --top so --top caps the head of
        // the --sort ordering, which is the natural reading of the
        // composition.
        //
        // Ties at the same sort key carry a secondary sort by the
        // original index (the order the API returned items in) so two
        // snapshots that contain the same entries produce byte-
        // identical output. Without the secondary sort, V8's Array#sort
        // — which is stable since 7.0 but the spec only required
        // stability after ES2019 — could in principle flip ties, and
        // the snapshot would drift between runs of identical input.
        //
        // Unknown keys throw cleanly so a typo cannot silently fall
        // back to API order (which would be indistinguishable from an
        // empty `--sort` invocation in the cron log).
        if (opts.sort !== undefined) {
          const sortKey = opts.sort.toLowerCase();
          const validKeys = ['boost', 'path', 'ups', 'downs'];
          if (!validKeys.includes(sortKey)) {
            throw new FeedbackCliError(`unknown --sort key "${opts.sort}" (expected one of: ${validKeys.join(', ')})`);
          }
          const ranked = out.items
            .map((it, idx) => ({ it, idx }))
            .sort((a, b) => {
              let cmp = 0;
              if (sortKey === 'boost') cmp = b.it.boost - a.it.boost;
              else if (sortKey === 'ups') cmp = b.it.ups - a.it.ups;
              else if (sortKey === 'downs') cmp = b.it.downs - a.it.downs;
              else if (sortKey === 'path') cmp = a.it.path.localeCompare(b.it.path);
              if (cmp !== 0) return cmp;
              // Secondary sort by original index for deterministic ties.
              return a.idx - b.idx;
            })
            .map((r) => r.it);
          out = { ...out, items: ranked };
        }
        // --top caps the kept entries to the N loudest by absolute
        // distance from neutral (|boost - 1.0|), descending. The
        // contract is "show me the loudest votes regardless of
        // direction" — answers a question the existing --above /
        // --below cannot answer in a single call (each of those
        // filters only sees one direction). Applied AFTER --above /
        // --below so the cap is "the N loudest entries that pass
        // the OTHER filters" — e.g. `--above 1.0 --top 5` is "the 5
        // strongest UPVOTES", and `--top 10` alone is "the 10
        // loudest in either direction".
        //
        // Ties at the same distance (e.g. boost 0.85 and 1.15 both
        // distance 0.15) preserve the API-provided order so the
        // snapshot is deterministic across runs. Distances are
        // snapped to 6-decimal precision before comparison to
        // dodge the floating-point trap where 1.40 - 1.0 evaluates
        // to 0.3999999999999999 while 0.60 - 1.0 evaluates to
        // 0.40000000000000004 — at boost precision (4 sig figs)
        // those ARE tied and the operator expects them to honour
        // API order; without the snap the FP noise would make them
        // sort opposite to the colloquial reading. The original
        // index is also carried as a secondary key so a stable-sort
        // implementation difference (Array#sort is stable on V8
        // 7.0+ but the spec only required stability after ES2019)
        // can never flip tied entries.
        //
        // Non-positive / NaN values fall back to "no cap" rather
        // than producing the surprising empty list — matches the
        // precedent set by `tags list --top` and `stats --top`.
        // The text-mode header line / count is recomputed below
        // from the post-top length so the operator sees the
        // right number.
        //
        // Composition with --sort: when --sort is set, the
        // operator has already picked their ordering primitive
        // (boost / path / ups / downs); --top just caps the head
        // of THAT ordering rather than re-sorting by |boost-1.0|.
        // Without this branch, `--sort downs --top 10` would
        // silently throw away the --sort and produce "the 10
        // loudest by distance" — exactly what --top alone does
        // and exactly what the composition is supposed to NOT do.
        if (opts.top !== undefined && Number.isFinite(opts.top) && opts.top > 0) {
          if (opts.sort !== undefined) {
            // --sort already determined ordering; --top just caps the head.
            out = { ...out, items: out.items.slice(0, opts.top) };
          } else {
            const ranked = out.items
              .map((it, idx) => ({
                it,
                idx,
                // Snap to 6 decimals so floating-point error in the
                // raw subtraction does not de-tie genuinely-equal
                // distances at boost precision.
                dist: Math.round(Math.abs(it.boost - 1.0) * 1e6) / 1e6,
              }))
              .sort((a, b) => {
                if (b.dist !== a.dist) return b.dist - a.dist;
                // Ties: preserve API order (lower idx first).
                return a.idx - b.idx;
              })
              .map((r) => r.it);
            out = { ...out, items: ranked.slice(0, opts.top) };
          }
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        if (out.items.length === 0) { process.stdout.write(kleur.gray('no feedback yet\n')); return; }
        for (const it of out.items) {
          const sign = it.boost > 1 ? kleur.green('+') : it.boost < 1 ? kleur.red('-') : kleur.gray('=');
          process.stdout.write(`${sign} ${it.boost.toFixed(2)}x  ${kleur.bold(it.path)}  ups=${it.ups} downs=${it.downs}\n`);
        }
      });
    });

  cmd.command('prune')
    .description('Bulk-clear feedback entries whose boost falls below (or above) a threshold')
    .option('--below <n>', 'clear every entry whose boost multiplier is strictly less than this value (typical: --below 0.7 to drop the strongest downvotes that no longer earn their boost). At least one of --below / --above is REQUIRED — there is no "prune everything" shorthand because that would be `feedback clear *` and a misclick should never wipe the whole map.', (v) => Number.parseFloat(v))
    .option('--above <n>', 'symmetric sibling of --below: clear every entry whose boost multiplier is strictly GREATER than this value. The natural cron use is "the upvote cap has been recalibrated downward and every old boost above the new ceiling should be cleared so re-vote pressure restarts from neutral" (e.g. `--above 1.45 --apply` after lowering MAX_BOOST from 1.5 to 1.45). Strict comparison (`>`) so an entry at exactly the threshold is preserved (it is ON the new ceiling, not above it). Composes with --below as an intersection (the "almost neutral" prune band: `--above 1.05 --below 0.95 --apply` clears every non-neutral entry). At least one of --below / --above is required.', (v) => Number.parseFloat(v))
    .option('-q, --q <text>', 'narrow the candidate set by case-insensitive substring on the source path BEFORE the --below / --above threshold is applied. Use to limit the prune to a specific directory subtree (e.g. `--q /archive --below 0.7` only touches feedback on archived paths).')
    .option('--apply', 'actually clear the matched entries. Without --apply this is a dry-run that lists what WOULD be cleared without touching the feedback store. Matches the forget --apply safety pattern: destructive by default off, never silent.')
    .option('--json', 'emit the prune report as JSON for scripting')
    .option('--slim', 'with --json: emit a slimmed `{threshold, thresholdAbove, dryRun, matched, cleared, errors}` shape that drops the `paths` array. The full --json report includes the array of every matched path, which can be megabytes on a large workspace and is almost never needed by a cron dashboard that only cares about the counts and the error log. --slim mirrors the precedent set by `doctor --json --quiet` and `digest run --json --slim`: when the operator only needs the headline numbers, the count-only shape diffs cleanly across cron snapshots (no path-array churn flooding the diff) and the network/disk footprint stays bounded. Pairs naturally with --apply for tight cron-budget snapshots: `clawmind feedback prune --above 1.45 --apply --json --slim` gives a one-line-per-snapshot health check that "the cap recalibration cleared N entries". The errors array is PRESERVED in --slim because per-path failures are exactly what a dashboard needs to surface — dropping them would hide the only signal the cron has that something actually broke. Silently ignored without --json (the dry-run text output already lives without the paths array; --slim has nothing to slim there).')
    .action(async (opts: { below?: number; above?: number; q?: string; apply?: boolean; json?: boolean; slim?: boolean }) => {
      await runOrReport('feedback prune', async () => {
        // The bulk-prune flow. The natural cron uses are:
        //   clawmind feedback prune --below 0.7              # dry-run, lists candidates
        //   clawmind feedback prune --below 0.7 --apply      # actually clears them
        //   clawmind feedback prune --above 1.45 --apply     # cap recalibration
        // This mirrors the forget --apply safety pattern: the
        // command is destructive when --apply is set, dry-run
        // otherwise, and the dry-run is byte-identical to the
        // apply call MINUS the actual DELETE. The operator can
        // copy-paste their preview command, add --apply, and get
        // exactly the rows they previewed cleared.
        //
        // Why at least one of --below / --above required, no
        // "prune everything" shorthand: a misclick or auto-
        // completed `clawmind feedback prune --apply` should
        // NEVER wipe the whole feedback map. Requiring an
        // explicit threshold makes the operator declare their
        // intent and gives us a number to validate.
        //
        // --above was added in a later tick once a real use-case
        // surfaced: a cap recalibration ("we lowered MAX_BOOST
        // from 1.5 to 1.45 — clear every entry above 1.45 so
        // re-vote pressure restarts cleanly"). The semantics
        // mirror --below byte-for-byte (strict comparison, same
        // dry-run/apply UX) so the muscle memory carries.
        // Composes with --below as an intersection for the
        // "almost neutral" band: `--above 1.05 --below 0.95
        // --apply` clears every non-neutral entry but preserves
        // the curated entries in the band of indifference.
        if (opts.below === undefined && opts.above === undefined) {
          throw new FeedbackCliError(`at least one of --below <n> or --above <n> is required (no shorthand to prune the entire map; use \`feedback clear <path>\` for individual entries)`);
        }
        if (opts.below !== undefined && !Number.isFinite(opts.below)) {
          throw new FeedbackCliError(`--below value is not a number`);
        }
        if (opts.above !== undefined && !Number.isFinite(opts.above)) {
          throw new FeedbackCliError(`--above value is not a number`);
        }
        // Step 1: fetch the candidate set. Forwards -q to the API
        // server-side (so the operator's substring filter does
        // not waste network bandwidth on rows the cron is going
        // to throw away anyway).
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        const list = (await apiFetch('GET', `/v1/feedback${qs}`)) as {
          items: { path: string; ups: number; downs: number; boost: number }[];
        };
        // Step 2: client-side filter. Strict comparisons (`<`, `>`)
        // so an entry exactly at the threshold is EXCLUDED — an
        // entry exactly at --below 0.7 is ON the line not below
        // it, and an entry exactly at --above 1.45 is ON the new
        // ceiling not above it. Mirrors the strict-comparison
        // semantics in `feedback list --above` / `--below`.
        // When both --below and --above are passed they compose
        // as an intersection (boost must be EITHER below the
        // floor OR above the ceiling) — no wait, that's the
        // SYMMETRIC use ("clear all extremes"), which is the
        // natural meaning of "the operator declared both ends".
        // So the predicate is OR: an entry matches if it satisfies
        // EITHER condition. That gives the "trim both tails"
        // shape `--above 1.05 --below 0.95 --apply` (clear
        // everything outside the [0.95, 1.05] neutral band).
        // An entry only one of the two conditions matches is
        // still cleared — that's what "I want both tails gone"
        // means.
        const candidates = list.items.filter((it) => {
          const belowMatch = opts.below !== undefined && it.boost < opts.below;
          const aboveMatch = opts.above !== undefined && it.boost > opts.above;
          return belowMatch || aboveMatch;
        });
        // Step 3: with --apply, actually clear each matched path.
        // We do this serially rather than in parallel because the
        // /v1/feedback DELETE endpoint mutates the same feedback
        // store and the recordVote/clearVote service has its own
        // race-sensitive reload step. Serial is safer for a
        // typical prune of dozens of paths; if a future prune
        // needs to clear thousands, a server-side bulk endpoint
        // would be the right answer.
        let cleared = 0;
        const errors: { path: string; message: string }[] = [];
        if (opts.apply) {
          for (const it of candidates) {
            try {
              await apiFetch('DELETE', '/v1/feedback', { path: it.path });
              cleared++;
            } catch (err) {
              // A single failure does not abort the rest of the
              // prune — surface the failure in the report and
              // keep going. The cron use is "clear the bad
              // entries from last week"; one entry that hits a
              // transient failure should not block the other
              // forty-nine.
              const msg = err instanceof FeedbackCliError ? err.message : String(err);
              errors.push({ path: it.path, message: msg });
            }
          }
        }
        const report = {
          threshold: opts.below,
          thresholdAbove: opts.above,
          dryRun: !opts.apply,
          matched: candidates.length,
          cleared,
          errors,
          paths: candidates.map((it) => it.path),
        };
        // Set the exit code BEFORE any output branch returns so the
        // JSON mode and the text mode agree: a partial failure
        // surfaces as exit 1 regardless of which output shape the
        // operator asked for. A wrapper script piping --json into
        // jq must be able to detect "not every clear succeeded"
        // from the exit code alone, the same way a shell wrapper
        // grepping the text output can detect it from the red
        // "clear(s) failed" header.
        if (errors.length > 0) {
          process.exitCode = 1;
        }
        if (opts.json) {
          // --slim drops the `paths` array for cron dashboards that
          // only care about the headline counts. Mirrors the
          // `doctor --json --quiet` and `digest run --json --slim`
          // precedent. The errors array is PRESERVED because per-
          // path failures are exactly what a dashboard needs to
          // surface — dropping them would hide the only signal
          // the cron has that something broke. Silent-ignored
          // without --json (the dry-run text path already lives
          // without the paths array). The shape is otherwise
          // byte-identical to the full report so a downstream
          // consumer that switches from --slim to non-slim sees
          // every other field unchanged.
          if (opts.slim) {
            const { paths: _drop, ...slim } = report;
            void _drop;
            process.stdout.write(JSON.stringify(slim, null, 2) + '\n');
            return;
          }
          process.stdout.write(JSON.stringify(report, null, 2) + '\n');
          return;
        }
        const verb = opts.apply ? 'cleared' : 'would clear';
        // Build a "below boost X" / "above boost Y" / "below X or above Y"
        // suffix that matches the operator's invocation exactly, so the
        // header line in the cron log narrates precisely the predicate
        // that ran. The suffix is the only piece that changes with the
        // new --above flag; the verb / count / pluralisation logic is
        // identical to the --below-only path.
        const parts: string[] = [];
        if (opts.below !== undefined) parts.push(`below boost ${opts.below}`);
        if (opts.above !== undefined) parts.push(`above boost ${opts.above}`);
        const predicate = parts.join(' or ');
        const head = `${verb} ${candidates.length} feedback entr${candidates.length === 1 ? 'y' : 'ies'} ${predicate}`;
        process.stdout.write((opts.apply ? kleur.red(head) : kleur.yellow(head)) + '\n');
        for (const it of candidates) {
          process.stdout.write(kleur.gray(`  ${it.boost.toFixed(2)}x  ${it.path}\n`));
        }
        if (errors.length > 0) {
          process.stdout.write(kleur.red(`\n${errors.length} clear(s) failed:\n`));
          for (const e of errors) {
            process.stdout.write(kleur.red(`  ${e.path}: ${e.message}\n`));
          }
        }
        if (!opts.apply && candidates.length > 0) {
          process.stdout.write(kleur.bold('\nrerun with --apply to actually clear these.\n'));
        }
      });
    });

  return cmd;
}
