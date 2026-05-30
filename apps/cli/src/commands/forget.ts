import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

interface ForgetReport {
  matched: number;
  removedChunks: number;
  removedPaths: string[];
  dryRun: boolean;
}

async function callForget(patterns: string[], dryRun: boolean): Promise<ForgetReport> {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  const res = await fetch(`${base}/v1/maintenance/forget`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patterns, dryRun }),
  });
  if (!res.ok) throw new Error(`POST /v1/maintenance/forget -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as ForgetReport;
}

export function forgetCommand() {
  return new Command('forget')
    .description('Remove indexed sources by glob pattern (manifest, BM25, and vector store)')
    .argument('<patterns...>', 'one or more glob patterns matched against absolute paths')
    .option('--apply', 'actually delete the matches; default is a dry-run preview')
    .option('--quiet', 'do not list every matched path')
    .action(async (patterns: string[], opts: { apply?: boolean; quiet?: boolean }) => {
      const dryRun = !opts.apply;
      const report = await callForget(patterns, dryRun);

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
}
