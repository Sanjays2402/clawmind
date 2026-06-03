import { Command } from 'commander';
import { unlink } from 'node:fs/promises';
import { manifestPath, bm25Dir } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';
import { ingestCommand } from './ingest.js';

export function reindexCommand() {
  return new Command('reindex')
    .description('Drop the manifest and BM25, then re-ingest')
    .argument('[root]')
    .option('--json', 'emit the ingest report as JSON instead of formatted text')
    .action(async (root: string | undefined, opts: { json?: boolean }) => {
      const rt = await buildRuntime();
      await Promise.allSettled([
        unlink(manifestPath(rt.env)),
        unlink(`${bm25Dir(rt.env)}/bm25.json`),
      ]);
      const args = ['node', 'clawmind', ...(root ? [root] : []), ...(opts.json ? ['--json'] : [])];
      await ingestCommand().parseAsync(args);
    });
}
