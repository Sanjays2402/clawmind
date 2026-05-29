import { Command } from 'commander';
import kleur from 'kleur';
import { retrieve } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { buildRuntime } from '../runtime.js';

export function searchCommand() {
  return new Command('search')
    .description('Hybrid search without LLM generation')
    .argument('<query...>')
    .option('-k, --k <n>', 'top k', '10')
    .action(async (query: string[], opts: { k: string }) => {
      const rt = await buildRuntime();
      const q = QuerySchema.parse({ q: query.join(' '), k: Number(opts.k) });
      const hits = await retrieve({
        bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
      }, q);
      hits.forEach((h, i) => {
        process.stdout.write(
          `${kleur.cyan(`#${i + 1}`)} ${kleur.gray(h.path + ':' + h.startLine)} ${kleur.dim(`(${h.score.toFixed(3)})`)}\n` +
          `${h.text.slice(0, 220).replace(/\n/g, ' ')}\n\n`,
        );
      });
    });
}
