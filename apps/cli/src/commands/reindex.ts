import { Command } from 'commander';
import { unlink } from 'node:fs/promises';
import kleur from 'kleur';
import { discoverFiles } from '@clawmind/ingest';
import { manifestPath, bm25Dir, expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';
import { ingestCommand } from './ingest.js';

export function reindexCommand() {
  return new Command('reindex')
    .description('Drop the manifest and BM25, then re-ingest')
    .argument('[root]')
    .option('--json', 'emit the ingest report as JSON instead of formatted text')
    .option('--dry-run', 'show the files that WOULD be reindexed without dropping the manifest, the BM25 index, or re-running ingest. Useful as a "what is about to happen" preview before a destructive reindex on a production index. Honours the same discovery rules ingest uses (.clawmindignore + the built-in include/exclude globs) so the preview is byte-faithful to the real run. Pairs with --paths-only for `clawmind reindex --dry-run --paths-only | wc -l` to count without parsing the human report.')
    .option('--paths-only', 'with --dry-run: emit just the paths one per line, no header, no count summary. Mirrors the --paths-only contract used by search/forget/related/stale. Ignored without --dry-run (a non-dry reindex emits the live ingest report instead). Composes naturally for shell pipelines: `clawmind reindex --dry-run --paths-only > before.txt` lets an operator snapshot the file set before mutating the index, then diff it post-reindex.')
    .action(async (root: string | undefined, opts: { json?: boolean; dryRun?: boolean; pathsOnly?: boolean }) => {
      const rt = await buildRuntime();
      // --dry-run is the "preview the destructive action" gate.
      // We DO NOT delete the manifest, DO NOT touch the BM25, and
      // DO NOT call ingestRoot. We just enumerate the discover
      // step the real ingest would walk, so the operator sees
      // exactly the set of files that would be re-ingested AFTER
      // a non-dry reindex wipes the manifest. (Without the dry
      // path, reindex unconditionally wipes the manifest BEFORE
      // ingest runs — a typo on a large index is destructive and
      // there is no way back.)
      //
      // Three output shapes, decided in this order so the contract
      // is unambiguous:
      //   --paths-only -> one path per line, no header (xargs-safe)
      //   --json       -> {root, count, files: [...] }
      //   default text -> the count + every path, gray-prefixed,
      //                   plus a "rerun without --dry-run to apply"
      //                   nudge so the operator does not get stuck.
      //
      // We resolve the target with `expand` the same way the
      // non-dry path does (via ingestCommand below), so the
      // preview's root matches the real ingest's root for the
      // same `clawmind reindex /foo` invocation. The runtime is
      // already built (we needed it for the workspace fallback)
      // so this adds zero new dependencies vs the non-dry path.
      if (opts.dryRun) {
        const target = root ? expand(root) : rt.workspace;
        const files = await discoverFiles(target);
        if (opts.pathsOnly) {
          for (const p of files) process.stdout.write(`${p}\n`);
          return;
        }
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ root: target, count: files.length, files }, null, 2) + '\n',
          );
          return;
        }
        process.stdout.write(
          kleur.yellow(`would reindex ${files.length} file(s) under ${target}\n`),
        );
        for (const p of files) process.stdout.write(kleur.gray(`  ${p}\n`));
        if (files.length > 0) {
          process.stdout.write(kleur.bold('\nrerun without --dry-run to actually reindex these.\n'));
        }
        return;
      }
      await Promise.allSettled([
        unlink(manifestPath(rt.env)),
        unlink(`${bm25Dir(rt.env)}/bm25.json`),
      ]);
      const args = ['node', 'clawmind', ...(root ? [root] : []), ...(opts.json ? ['--json'] : [])];
      await ingestCommand().parseAsync(args);
    });
}
