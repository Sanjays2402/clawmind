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
    .option('--json', 'emit the forget report as JSON for scripting')
    .action(async (patterns: string[], opts: { apply?: boolean; quiet?: boolean; json?: boolean }) => {
      await runOrReport('forget', async () => {
        const dryRun = !opts.apply;
        const report = await callForget(patterns, dryRun);

        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ patterns, ...report }, null, 2) + '\n',
          );
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
