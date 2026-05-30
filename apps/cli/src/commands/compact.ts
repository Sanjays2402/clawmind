import { Command } from 'commander';
import kleur from 'kleur';
import { compactStore } from '@clawmind/ingest';
import { buildRuntime } from '../runtime.js';

export function compactCommand() {
  return new Command('compact')
    .description('Prune manifest, BM25, and LanceDB entries for files that no longer exist')
    .option('--dry-run', 'report what would be removed without changing anything', false)
    .action(async (opts: { dryRun: boolean }) => {
      const rt = await buildRuntime();
      const report = await compactStore({
        manifest: rt.manifest, bm25: rt.bm25, bm25File: rt.bm25File,
        lance: rt.lance, dryRun: opts.dryRun,
      });
      const head = opts.dryRun ? kleur.yellow('dry run') : kleur.green('compacted');
      process.stdout.write([
        `${head} scanned=${report.scanned} removed=${report.removed} kept=${report.kept}`,
        ...report.removedPaths.map((p) => `  ${kleur.dim('-')} ${p}`),
      ].join('\n') + '\n');
    });
}
