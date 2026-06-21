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
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; json?: boolean }) => {
     await runAction('digest list', async () => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      const out = (await apiFetch('GET', `/v1/digests${qs}`)) as {
        items: {
          savedSearchId: string; title: string; query: string;
          lastRunTs: number | null; lastNewCount: number; lastRemovedCount: number; runs: number;
        }[];
      };
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
    .option('--json', 'emit the run report as JSON for scripting')
    .action(async (id: string | undefined, opts: { json?: boolean }) => {
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
