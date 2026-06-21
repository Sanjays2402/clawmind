import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

interface ForgetReport {
  matched: number;
  removedChunks: number;
  removedPaths: string[];
  dryRun: boolean;
}

class ForgetCliError extends Error {}

async function callForget(patterns: string[], dryRun: boolean): Promise<ForgetReport> {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}/v1/maintenance/forget`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patterns, dryRun }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ForgetCliError(`cannot reach ${base} (${msg})`);
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
    throw new ForgetCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return (await res.json()) as ForgetReport;
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ForgetCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

export function forgetCommand() {
  return new Command('forget')
    .description('Remove indexed sources by glob pattern (manifest, BM25, and vector store)')
    .argument('<patterns...>', 'one or more glob patterns matched against absolute paths')
    .option('--apply', 'actually delete the matches; default is a dry-run preview')
    .option('--quiet', 'do not list every matched path')
    .option('--paths-only', 'emit only the matched paths, one per line, for piping into other commands')
    .option('--confirm <n>', 'safety tripwire: with --apply, refuse to run unless the dry-run match count exactly equals N. Prevents an unintended `clawmind forget /tmp/foo --apply` from wiping the whole index when the glob accidentally matches everything. Specify the expected number of sources; supply -1 to allow any (explicit opt-out).')
    .option('--json', 'emit the forget report as JSON for scripting')
    .action(async (patterns: string[], opts: { apply?: boolean; quiet?: boolean; pathsOnly?: boolean; confirm?: string; json?: boolean }) => {
      await runOrReport('forget', async () => {
        const dryRun = !opts.apply;
        // --confirm is only meaningful with --apply (a dry-run is
        // already safe). When set, we do a dry-run FIRST regardless of
        // what the operator asked for, compare the match count to the
        // declared expectation, and only proceed to the apply call if
        // the numbers agree. The "-1" sentinel means "any count is
        // fine" — that is the explicit opt-out for cases where the
        // operator wants to script forget across an unknown-size
        // result set but still benefits from the validation that
        // --confirm was passed at all (catches typo'd flags). The
        // sentinel matches the convention used elsewhere in the cli
        // where -1 means "no limit".
        let report: ForgetReport;
        if (opts.apply && opts.confirm !== undefined) {
          const expected = Number.parseInt(opts.confirm, 10);
          if (!Number.isFinite(expected)) {
            throw new ForgetCliError(`--confirm value "${opts.confirm}" is not a number`);
          }
          // Probe with a dry-run first so we know the real match count
          // without touching the store.
          const preview = await callForget(patterns, true);
          if (expected !== -1 && preview.matched !== expected) {
            // Refuse loudly. The error explicitly tells the operator
            // BOTH numbers so they can re-run with the right value or
            // refine the glob. We do NOT proceed with the apply.
            throw new ForgetCliError(
              `--confirm ${expected} does not match actual count ${preview.matched}; ` +
              `re-run with --confirm ${preview.matched} (or --confirm -1 to bypass) if this is correct`,
            );
          }
          // Numbers agree (or operator passed -1): now actually apply.
          report = await callForget(patterns, false);
        } else {
          report = await callForget(patterns, dryRun);
        }

        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ patterns, ...report }, null, 2) + '\n',
          );
          return;
        }

        // --paths-only is the pipe-friendly twin of `stale --paths`. It
        // skips every styled byte (no header, no rerun hint, no colour)
        // so `clawmind forget '/tmp/*.md' --paths-only | xargs git rm`
        // is safe. It deliberately ignores --quiet (which only hides the
        // path list in the human report) because hiding paths in
        // --paths-only would defeat the point of the flag.
        if (opts.pathsOnly) {
          for (const p of report.removedPaths) process.stdout.write(`${p}\n`);
          return;
        }

        const verb = dryRun ? 'would remove' : 'removed';
        const head = `${verb} ${report.matched} source(s) and ${report.removedChunks} chunk(s)`;
        process.stdout.write((dryRun ? kleur.yellow(head) : kleur.red(head)) + '\n');

        if (!opts.quiet) {
          for (const p of report.removedPaths) {
            process.stdout.write(kleur.gray(`  ${p}\n`));
          }
        }
        if (dryRun && report.matched > 0) {
          process.stdout.write(kleur.bold('\nrerun with --apply to actually forget these.\n'));
        }
      });
    });
}
