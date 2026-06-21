import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
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
    .option('-o, --out <file>', 'write the answer (and citations footer / JSON payload, depending on mode) to a file instead of stdout. Stderr still gets progress / error chatter. Mirrors the same flag on `clawmind search`.')
    .action(async (question: string[], opts: { k: string; namespaces?: string; json?: boolean; citations: boolean; threshold?: string; out?: string }) => {
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
      // --out captures the answer in memory and writes once at the end.
      // In text mode this means we suppress the token-by-token stdout
      // dribble (the operator chose a file, they don't want the answer
      // both on screen AND in the file); the latency footer also goes
      // to the file. Stderr still carries progress/error chatter so a
      // long-running ask can be tailed with `tail -f answer.txt` while
      // errors / threshold-skip hints surface on the terminal. In
      // --json mode the behaviour matches `search --out`: the JSON
      // payload lands in the file and a green confirmation line goes
      // to stderr.
      const captureToFile = Boolean(opts.out);
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
          // When --out is set, accumulate silently — the file write at
          // the end carries the whole answer + (optional) citations
          // footer. When --out is NOT set, behave exactly as before:
          // print the gray sources header once, then stream the
          // answer token-by-token.
          if (captureToFile) {
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
          if (!opts.json && !captureToFile) {
            // Latency footer only goes to stdout when we are streaming
            // the answer to stdout. When --out is set, the latency is
            // appended to the file body below so the operator's saved
            // answer is self-contained.
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
        const body = JSON.stringify(payload, null, 2) + '\n';
        if (opts.out) {
          // Same shape as `search --out`: payload to file, confirmation
          // line to stderr so stdout stays parseable when --out is
          // chained with something else (rare for ask, but worth the
          // consistency with search).
          await writeFile(opts.out, body, 'utf8');
          process.stderr.write(kleur.green(`wrote answer (${answer.length} chars) -> ${opts.out}\n`));
        } else {
          process.stdout.write(body);
        }
        return;
      }
      if (opts.out) {
        // Text-mode --out: assemble the same shape the streaming path
        // would produce (sources header, answer body, latency footer,
        // optional citations), but as one final write to the chosen
        // file. ANSI styling is stripped: the kleur calls below are
        // intentionally absent so the saved text is grep-clean and
        // editor-friendly (mirrors `search --out` dropping ANSI).
        const parts: string[] = [];
        parts.push(`sources: ${sources.length}\n`);
        parts.push(answer);
        parts.push(`\n\n(${latencyMs}ms via ${model})\n`);
        if (opts.citations !== false && sources.length) {
          parts.push('\ncitations:\n');
          sources.forEach((s, i) => {
            parts.push(`  [^${i + 1}] ${s.path}:${s.startLine}-${s.endLine}\n`);
          });
        }
        await writeFile(opts.out, parts.join(''), 'utf8');
        process.stderr.write(kleur.green(`wrote answer (${answer.length} chars) -> ${opts.out}\n`));
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
