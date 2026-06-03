import { Command } from 'commander';
import kleur from 'kleur';
import { startWatcher } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';

export function watchCommand() {
  return new Command('watch')
    .description('Watch a directory and reindex on changes')
    .argument('[root]')
    .option('--json', 'emit one JSON event per line (NDJSON) instead of formatted text')
    .action(async (root: string | undefined, opts: { json?: boolean }) => {
      const rt = await buildRuntime();
      const target = root ? expand(root) : rt.workspace;
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ kind: 'watching', root: target, ts: new Date().toISOString() }) + '\n',
        );
      } else {
        process.stdout.write(kleur.cyan(`Watching ${target}\n`));
      }
      startWatcher({
        root: target,
        store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
        manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
        onEvent: (k, p) => {
          if (opts.json) {
            process.stdout.write(
              JSON.stringify({ kind: k, path: p, ts: new Date().toISOString() }) + '\n',
            );
          } else {
            process.stdout.write(kleur.gray(`${k} ${p}\n`));
          }
        },
      });
      await new Promise(() => undefined);
    });
}
