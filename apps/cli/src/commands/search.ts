import { Command } from 'commander';
import kleur from 'kleur';
import { retrieve, snippetFor, queryTerms } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { buildRuntime } from '../runtime.js';

function splitList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

export function searchCommand() {
  return new Command('search')
    .description('Hybrid search without LLM generation')
    .argument('<query...>')
    .option('-k, --k <n>', 'top k', '10')
    .option('-n, --namespaces <list>', 'comma-separated namespaces to restrict to')
    .option('--include-tags <list>', 'comma-separated tags; keep only sources carrying at least one')
    .option('--exclude-tags <list>', 'comma-separated tags; drop sources carrying any')
    .option('--json', 'emit results as a JSON array instead of formatted text')
    .option('--no-highlight', 'disable ANSI highlighting of matched terms')
    .option('--snippet-width <n>', 'snippet width in characters', '240')
    .action(
      async (
        query: string[],
        opts: {
          k: string;
          namespaces?: string;
          includeTags?: string;
          excludeTags?: string;
          json?: boolean;
          highlight: boolean;
          snippetWidth: string;
        },
      ) => {
        const rt = await buildRuntime();
        const q = QuerySchema.parse({
          q: query.join(' '),
          k: Number(opts.k),
          namespaces: splitList(opts.namespaces),
          includeTags: splitList(opts.includeTags),
          excludeTags: splitList(opts.excludeTags),
        });
        const hits = await retrieve(
          { bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL },
          q,
        );
        const terms = queryTerms(q.q);
        const width = Number(opts.snippetWidth) || 240;
        if (opts.json) {
          const out = hits.map((h, i) => {
            const snip = snippetFor(h, terms, width);
            return {
              rank: i + 1,
              path: h.path,
              score: h.score,
              startLine: snip.startLine,
              snippet: snip.text,
              highlights: snip.highlights,
            };
          });
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        if (hits.length === 0) {
          const filters: string[] = [];
          if (q.namespaces?.length) filters.push(`namespaces=${q.namespaces.join(',')}`);
          if (q.includeTags?.length) filters.push(`include-tags=${q.includeTags.join(',')}`);
          if (q.excludeTags?.length) filters.push(`exclude-tags=${q.excludeTags.join(',')}`);
          const suffix = filters.length ? ` with ${filters.join(' ')}` : '';
          process.stderr.write(kleur.gray(`no results for "${q.q}"${suffix}\n`));
          return;
        }
        hits.forEach((h, i) => {
          const snip = snippetFor(h, terms, width);
          let line = snip.text.replace(/\n/g, ' ');
          if (opts.highlight) {
            // Walk spans in reverse so earlier offsets stay valid as we splice.
            for (let s = snip.highlights.length - 1; s >= 0; s--) {
              const hl = snip.highlights[s]!;
              const before = line.slice(0, hl.start);
              const mid = line.slice(hl.start, hl.end);
              const after = line.slice(hl.end);
              line = before + kleur.yellow().bold(mid) + after;
            }
          }
          process.stdout.write(
            `${kleur.cyan(`#${i + 1}`)} ${kleur.gray(h.path + ':' + snip.startLine)} ${kleur.dim(`(${h.score.toFixed(3)})`)}\n` +
              `${line}\n\n`,
          );
        });
      },
    );
}
