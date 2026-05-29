import { Command } from 'commander';
import kleur from 'kleur';
import { askStream } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { buildRuntime } from '../runtime.js';

export function askCommand() {
  return new Command('ask')
    .description('Ask a question grounded in your workspace')
    .argument('<question...>', 'your question')
    .option('-k, --k <n>', 'top k chunks', '8')
    .option('-n, --namespaces <list>', 'comma-separated namespaces')
    .action(async (question: string[], opts: { k: string; namespaces?: string }) => {
      const rt = await buildRuntime();
      const q = QuerySchema.parse({
        q: question.join(' '),
        k: Number(opts.k),
        namespaces: opts.namespaces?.split(',').filter(Boolean),
      });
      const deps = { bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL };
      let printedSources = false;
      let answer = '';
      const sources: { path: string; startLine: number; endLine: number }[] = [];
      for await (const evt of askStream(deps, q)) {
        if (evt.type === 'sources') {
          for (const s of evt.value) sources.push(s);
        } else if (evt.type === 'token') {
          if (!printedSources) {
            process.stdout.write(kleur.gray(`\nsources: ${sources.length}\n`));
            printedSources = true;
          }
          process.stdout.write(evt.value);
          answer += evt.value;
        } else if (evt.type === 'error') {
          process.stderr.write(kleur.red(`\n${evt.value.message}\n`));
          process.exit(1);
        } else if (evt.type === 'done') {
          process.stdout.write(kleur.gray(`\n\n(${evt.value.latencyMs}ms via ${evt.value.model})\n`));
        }
      }
      if (sources.length) {
        process.stdout.write('\n' + kleur.bold('citations:') + '\n');
        sources.forEach((s, i) => {
          process.stdout.write(kleur.gray(`  [^${i + 1}] ${s.path}:${s.startLine}-${s.endLine}\n`));
        });
      }
    });
}
