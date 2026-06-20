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
    .option('-t, --threshold <n>', 'require at least one retrieved source with score >= n; if all sources fall below this bar the LLM is NOT called and a non-zero exit code is returned')
    .option('--no-citations', 'in text mode, hide the citations footer; in --json mode, omit the citations[] array. The streamed answer is unchanged.')
    .option('--json', 'emit answer, citations, and metadata as JSON for scripting')
    .action(async (question: string[], opts: { k: string; namespaces?: string; json?: boolean; citations: boolean; threshold?: string }) => {
      const rt = await buildRuntime();
      const q = QuerySchema.parse({
        q: question.join(' '),
        k: Number(opts.k),
        namespaces: opts.namespaces?.split(',').filter(Boolean),
      });
      const deps = { bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL };
      // --threshold is a pre-LLM gate. We resolve it once up front so a
      // missing or non-numeric value (`--threshold $MAYBE` in a script
      // where the variable is empty) silently degrades to "no threshold"
      // rather than throwing. The threshold is checked against the
      // fused retrieval score the operator already sees in `search`
      // output (`(0.713)`), so it composes with the same intuition.
      const rawThreshold = opts.threshold !== undefined ? Number.parseFloat(opts.threshold) : NaN;
      const threshold = Number.isFinite(rawThreshold) ? rawThreshold : null;
      let printedSources = false;
      let answer = '';
      const sources: { path: string; startLine: number; endLine: number; score: number }[] = [];
      let latencyMs = 0;
      let model = '';
      let errored = false;
      let belowThreshold = false;
      for await (const evt of askStream(deps, q)) {
        if (evt.type === 'sources') {
          for (const s of evt.value) {
            sources.push({
              path: s.path,
              startLine: s.startLine,
              endLine: s.endLine,
              score: s.score,
            });
          }
          // Threshold check happens RIGHT after sources arrive and
          // BEFORE we pull a single token from the stream. Because
          // `askStream` is a generator, it has not yet started the
          // LLM call at this point — that work only begins when we
          // request the next event after `sources`. Breaking here
          // short-circuits the loop and lets the generator's
          // `return()` semantics clean up without spending any LLM
          // budget. We emit either a clean text-mode hint to stderr
          // or a structured JSON payload depending on mode, and
          // exit with code 1 so a `clawmind ask ... --threshold .8`
          // in a shell pipeline reports back honestly.
          if (threshold !== null) {
            const best = sources.reduce((m, s) => Math.max(m, s.score), -Infinity);
            if (!Number.isFinite(best) || best < threshold) {
              belowThreshold = true;
              if (opts.json) {
                process.stdout.write(
                  JSON.stringify(
                    {
                      question: q.q,
                      skipped: true,
                      reason: 'no citation cleared --threshold',
                      threshold,
                      bestScore: Number.isFinite(best) ? best : null,
                      count: sources.length,
                    },
                    null,
                    2,
                  ) + '\n',
                );
              } else {
                const bestStr = Number.isFinite(best) ? best.toFixed(3) : 'n/a';
                process.stderr.write(
                  kleur.yellow(
                    `no citation cleared --threshold ${threshold} (best ${bestStr} across ${sources.length} sources); LLM was not called\n`,
                  ),
                );
              }
              process.exitCode = 1;
              break;
            }
          }
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
      if (errored || belowThreshold) return;
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
