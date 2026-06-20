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
    .option('--no-citations', 'in text mode, hide the citations footer; in --json mode, omit the citations[] array. The streamed answer is unchanged.')
    .option('--json', 'emit answer, citations, and metadata as JSON for scripting')
    .action(async (question: string[], opts: { k: string; namespaces?: string; json?: boolean; citations: boolean }) => {
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
      let latencyMs = 0;
      let model = '';
      let errored = false;
      for await (const evt of askStream(deps, q)) {
        if (evt.type === 'sources') {
          for (const s of evt.value) sources.push(s);
        } else if (evt.type === 'token') {
          if (opts.json) {
            answer += evt.value;
            continue;
          }
          if (!printedSources) {
            process.stdout.write(kleur.gray(`\nsources: ${sources.length}\n`));
            printedSources = true;
          }
          process.stdout.write(evt.value);
          answer += evt.value;
        } else if (evt.type === 'error') {
          if (opts.json) {
            process.stdout.write(
              JSON.stringify({ question: q.q, error: evt.value.message }, null, 2) + '\n',
            );
            process.exit(1);
          }
          process.stderr.write(kleur.red(`\n${evt.value.message}\n`));
          errored = true;
          process.exit(1);
        } else if (evt.type === 'done') {
          latencyMs = evt.value.latencyMs;
          model = evt.value.model;
          if (!opts.json) {
            process.stdout.write(kleur.gray(`\n\n(${latencyMs}ms via ${model})\n`));
          }
        }
      }
      if (errored) return;
      if (opts.json) {
        // --no-citations drops the citations[] array AND the count field
        // from the JSON payload. Pipelines that only want the prose
        // answer (e.g. piping into another LLM, or storing in a
        // chat log) get a noticeably smaller, cleaner shape. The
        // question/answer/latency/model fields stay so callers still
        // get the answer body and timing info. We omit `count` along
        // with the array because keeping `count: 5` next to no
        // citations[] would be a confusing half-truth.
        const payload: Record<string, unknown> = {
          question: q.q,
          answer,
          latencyMs,
          model,
        };
        if (opts.citations !== false) {
          payload.citations = sources.map((s, i) => ({
            index: i + 1,
            path: s.path,
            startLine: s.startLine,
            endLine: s.endLine,
          }));
          payload.count = sources.length;
        }
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        return;
      }
      // --no-citations also suppresses the text-mode footer below.
      // The streamed answer body has already been printed token-by-
      // token; this just keeps the citation list off the end so an
      // operator copy-pasting the answer does not have to manually
      // strip the `[^1] ...` lines.
      if (opts.citations !== false && sources.length) {
        process.stdout.write('\n' + kleur.bold('citations:') + '\n');
        sources.forEach((s, i) => {
          process.stdout.write(kleur.gray(`  [^${i + 1}] ${s.path}:${s.startLine}-${s.endLine}\n`));
        });
      }
    });
}
