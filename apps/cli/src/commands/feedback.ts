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

  return cmd;
}
