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
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; above?: number; below?: number; json?: boolean }) => {
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
    .action(async (opts: { below?: number; above?: number; q?: string; apply?: boolean; json?: boolean }) => {
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
