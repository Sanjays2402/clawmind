import { Command } from 'commander';
import ora from 'ora';
import kleur from 'kleur';
import { ingestRoot } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';

export function ingestCommand() {
  return new Command('ingest')
    .description('Index a directory tree into ClawMind')
    .argument('[root]', 'directory to index (defaults to your workspace)')
    .option('--json', 'emit the ingest report as JSON instead of formatted text')
    .action(async (root: string | undefined, opts: { json?: boolean }) => {
      const rt = await buildRuntime();
      const target = root ? expand(root) : rt.workspace;
      const spinner = opts.json ? null : ora(`Indexing ${target}`).start();
      let last = 0;
      const stats = await ingestRoot(target, {
        store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
        manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
        onProgress: ({ processed, total }) => {
          if (!spinner) return;
          if (processed - last >= 10 || processed === total) {
            last = processed;
            spinner.text = `Indexing ${processed}/${total}`;
          }
        },
      });
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { root: target, processed: stats.processed, chunks: stats.chunks, skipped: stats.skipped },
            null,
            2,
          ) + '\n',
        );
        return;
      }
      spinner!.succeed(
        kleur.green(`Indexed ${stats.processed} files, ${stats.chunks} chunks, skipped ${stats.skipped}`),
      );
    });
}
