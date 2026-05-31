import { Command } from 'commander';
import kleur from 'kleur';
import { retrieve, snippetFor, queryTerms } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { buildRuntime } from '../runtime.js';
export function searchCommand() {
    return new Command('search')
        .description('Hybrid search without LLM generation')
        .argument('<query...>')
        .option('-k, --k <n>', 'top k', '10')
        .option('--no-highlight', 'disable ANSI highlighting of matched terms')
        .option('--snippet-width <n>', 'snippet width in characters', '240')
        .action(async (query, opts) => {
        const rt = await buildRuntime();
        const q = QuerySchema.parse({ q: query.join(' '), k: Number(opts.k) });
        const hits = await retrieve({ bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL }, q);
        const terms = queryTerms(q.q);
        const width = Number(opts.snippetWidth) || 240;
        hits.forEach((h, i) => {
            const snip = snippetFor(h, terms, width);
            let line = snip.text.replace(/\n/g, ' ');
            if (opts.highlight) {
                // Walk spans in reverse so earlier offsets stay valid as we splice.
                for (let s = snip.highlights.length - 1; s >= 0; s--) {
                    const hl = snip.highlights[s];
                    const before = line.slice(0, hl.start);
                    const mid = line.slice(hl.start, hl.end);
                    const after = line.slice(hl.end);
                    line = before + kleur.yellow().bold(mid) + after;
                }
            }
            process.stdout.write(`${kleur.cyan(`#${i + 1}`)} ${kleur.gray(h.path + ':' + snip.startLine)} ${kleur.dim(`(${h.score.toFixed(3)})`)}\n` +
                `${line}\n\n`);
        });
    });
}
//# sourceMappingURL=search.js.map