import { Command } from 'commander';
import kleur from 'kleur';
import { startWatcher } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';

export function watchCommand() {
  return new Command('watch')
    .description('Watch a directory and reindex on changes')
    .argument('[root]')
    .action(async (root?: string) => {
      const rt = await buildRuntime();
      const target = root ? expand(root) : rt.workspace;
      process.stdout.write(kleur.cyan(`Watching ${target}\n`));
      startWatcher({
        root: target,
        store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
        manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
        onEvent: (k, p) => process.stdout.write(kleur.gray(`${k} ${p}\n`)),
      });
      await new Promise(() => undefined);
    });
}
