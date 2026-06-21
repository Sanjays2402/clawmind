import { Command } from 'commander';
import kleur from 'kleur';
import { compactStore } from '@clawmind/ingest';
import { buildRuntime } from '../runtime.js';

export function compactCommand() {
  return new Command('compact')
    .description('Prune manifest, BM25, and LanceDB entries for files that no longer exist')
    .option('--dry-run', 'report what would be removed without changing anything', false)
    .option('--json', 'emit machine-readable JSON instead of a text report')
    .action(async (opts: { dryRun: boolean; json?: boolean }) => {
      const rt = await buildRuntime();
      const report = await compactStore({
        manifest: rt.manifest, bm25: rt.bm25, bm25File: rt.bm25File,
        lance: rt.lance, dryRun: opts.dryRun,
      });
      if (opts.json) {
        // `report` already carries its own dryRun flag (the same value we
        // passed in), so spreading it after a literal dryRun key wins the
        // duplicate-property race and tsc flags TS2783. Drop the literal —
        // the spread is the single source of truth.
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
      }
      const head = opts.dryRun ? kleur.yellow('dry run') : kleur.green('compacted');
      process.stdout.write([
        `${head} scanned=${report.scanned} removed=${report.removed} kept=${report.kept}`,
        ...report.removedPaths.map((p) => `  ${kleur.dim('-')} ${p}`),
      ].join('\n') + '\n');
    });
}
