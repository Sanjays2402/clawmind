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
        .action(async (root) => {
        const rt = await buildRuntime();
        const target = root ? expand(root) : rt.workspace;
        const spinner = ora(`Indexing ${target}`).start();
        let last = 0;
        const stats = await ingestRoot(target, {
            store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
            manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
            onProgress: ({ processed, total }) => {
                if (processed - last >= 10 || processed === total) {
                    last = processed;
                    spinner.text = `Indexing ${processed}/${total}`;
                }
            },
        });
        spinner.succeed(kleur.green(`Indexed ${stats.processed} files, ${stats.chunks} chunks, skipped ${stats.skipped}`));
    });
}
//# sourceMappingURL=ingest.js.map