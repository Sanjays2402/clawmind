import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
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

/**
 * Read the entire stdin as a UTF-8 string. Used when the operator
 * passes `-` as the query so things like `echo foo | clawmind search -`
 * or `cat queries.txt | clawmind search -` work in shell loops without
 * having to quote the query into the argument list. Trailing newlines
 * are trimmed because that is what every shell pipeline produces.
 */
async function readStdin(): Promise<string> {
  let buf = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) buf += chunk;
  return buf.replace(/\s+$/, '');
}

export function searchCommand() {
  return new Command('search')
    .description('Hybrid search without LLM generation')
    .argument('<query...>', 'query terms; pass a single "-" to read the full query from stdin')
    .option('-k, --k <n>', 'top k', '10')
    .option('-n, --namespaces <list>', 'comma-separated namespaces to restrict to')
    .option('--include-tags <list>', 'comma-separated tags; keep only sources carrying at least one')
    .option('--exclude-tags <list>', 'comma-separated tags; drop sources carrying any')
    .option('-t, --threshold <n>', 'drop hits with score strictly below this value (0..1 typical)')
    .option('--sort <key>', 'sort survivors of -t/--threshold by one of: score (desc — highest-score-first, matches the default retrieve() ordering; useful as a no-op for symmetry with other commands and as a defence against a future retrieval-pipeline change that returns hits in a different order), path (asc alphabetical, for stable cross-snapshot diffs of `search --json`), namespace (asc alphabetical, groups hits by namespace so diffs against a known set are visually clean — pairs naturally with `search foo --json --sort namespace` for a dashboard panel showing where in the index a query\'s signal clusters). Applied AFTER -t/--threshold so the sort orders the SURVIVORS of any band-filter. Mirrors `related --sort` byte-for-byte: ties carry a secondary sort by original index for cross-snapshot determinism, unknown keys abort cleanly with exit 1, default preserves the retrieve()-returned order so existing scripts diffing `search --json` snapshots stay byte-stable. --paths-only emit (which dedupes by path in rank order) walks the post-sort order, so `--sort namespace --paths-only` emits paths grouped by namespace and `--sort path --paths-only` emits paths in plain alphabetical order — both useful one-liners for `xargs ls` / `xargs git diff` against a known shape.')
    .option('--reverse', 'flip the --sort direction (mirrors `stale --reverse` byte-for-byte). With --sort path the default is asc alphabetical; --reverse gives desc — the cron use is "what\'s at the END of the alphabetical run", useful for diff snapshots that want the FIRST change at the bottom of the visible window for a `tail -f`-style log scrape. With --sort namespace the default is asc grouping; --reverse gives desc — the most-recent (alphabetically-last) namespace at the top, useful for cron snapshots that put the freshest namespace first. With --sort score the default is desc; --reverse gives asc (weakest-first) — useful for the "what\'s about to fall off the relevance edge" question, complementary to the "strongest first" default. Ignored without --sort (the default retrieve() ordering is a fixed contract). The secondary tie-break by original index is ALSO reversed so cross-snapshot determinism holds in either direction. Composes with --paths-only — the dedupe walks the post-reverse order.')
    .option('--rerank-off', 'DEBUG escape hatch: skip the lexical-rerank step in the retrieval pipeline. Surfaces the raw hybrid-merged + boost-adjusted ordering BEFORE the lexical reorder, so an operator can diagnose whether the rerank is HELPING or HURTING on a particular query. Useful when tuning hybridAlpha or chasing a regression where a known-relevant chunk drops out of the top-k. Other stages (embed call, hybrid merge, MMR diversity) stay enabled — only the heuristic lexical-rerank is bypassed. Composes with --json / --threshold / --paths-only / -k for "what does the pipeline rank as #1 without the lexical layer", "what does the top-50 look like without the rerank pull", etc.')
    .option('--rerank-only', 'DEBUG escape hatch (inverse of --rerank-off): emit ONLY the rerank stage\'s ordering, skipping the MMR diversity pass that the production flow applies on top. Pairs with --rerank-off for a 3-way A/B against the same query: default (rerank+MMR), --rerank-off (raw hybrid+boost, no rerank, with MMR), --rerank-only (rerank applied, no MMR). The use is "is the diversity pass demoting a chunk I think should be #1, or is it the rerank step itself?" — separating the two stages lets the operator point a finger at the right layer. Implementation forwards { skipMmr: true } through retrieve(); the lexical-rerank stage still runs and the top-k is the head N of its score order. Setting both --rerank-off AND --rerank-only is allowed (raw hybrid+boost ordering with NEITHER post-stage applied) for the most extreme "what does the index look like before any heuristic touches it" probe.')
    .option('--tsv', 'emit tab-separated rows (rank, path, score, namespace) for awk/cut pipelines. No ANSI, no header (use --header), no snippet body. Mirrors stale --tsv and stats --tsv byte-for-byte. Composes with -t / --threshold / --sort / --reverse / -k / -n / --include-tags / --exclude-tags — the TSV stream describes the post-filter, post-sort, post-cap survivors (same as every other emit mode). The four columns match the --json --slim shape byte-for-byte so a downstream parser flipping between the two only changes the framing, not the schema. Precedence: --paths-only > --tsv > --json > text — --paths-only wins because it is the strictly leaner shape; --tsv wins over --json because tab-separated is a pipeline contract that awk cannot satisfy on JSON cleanly. Score is emitted with the same .toFixed(3) precision text mode uses so cross-mode diffs are byte-stable. Empty result yields a clean empty stream (the text-mode "no results" hint is suppressed under --tsv so xargs/wc see exactly 0 lines).')
    .option('--header', 'with --tsv: prepend a single tab-separated schema row (`rank<TAB>path<TAB>score<TAB>namespace`). Mirrors stale --tsv --header / stats --tsv --header byte-for-byte: fires UNCONDITIONALLY when --header is set, including on a zero-row body (the schema row is the contract, not the data rows). The default header-less shape is preserved when --header is absent so existing pipelines using bare --tsv keep working. Ignored without --tsv.')
    .option('--no-snippet', 'in --json mode, emit only rank/path/score/startLine (no snippet/highlights). Smaller payload for ranking pipelines')
    .option('--slim', 'with --json: emit a slimmed `{rank, path, score, namespace}` shape per hit. Drops snippet, highlights, AND startLine — leaving only the four fields needed for "what does the top-k for query X look like over time" cron dashboards. Mirrors the `doctor --json --quiet`, `digest run --json --slim`, `feedback prune --json --slim`, `feedback list --json --slim`, and `stats --json --slim` precedent. The full --json payload includes a per-hit snippet (240 bytes default) plus a highlights array — for a cron poll asking "is the top-5 stable" this dominates the payload size. The existing `--no-snippet` already drops snippet/highlights but PRESERVES startLine; `--slim` is the deeper cut for dashboards that do not need the chunk-identifier byte either. Per-hit shape is exactly `{rank, path, score, namespace}` — namespace is included because grouping hits by namespace is the single most useful slim-shape query (a query whose top-k clusters in one namespace tells the operator something the score alone does not). Composes with -t/--threshold (slim describes survivors of the band-filter), --sort/--reverse (slim emits the post-sort order, so `--sort path --reverse --json --slim` is the desc-alphabetical slim stream), -k (slim respects the top-k cap), and namespaces/include-tags/exclude-tags (slim describes the post-filter survivors). --paths-only wins over --slim because --paths-only is the EVEN-leaner shape (no JSON wrapper at all); the precedence is --paths-only > --slim > --no-snippet > full --json. Wins over --no-snippet when both are set (slim is strictly slimmer). Silently ignored without --json. Output is single-line JSON.stringify of the array (no indent) so an NDJSON-style cron snapshot stream diffs cleanly between ticks.')
    .option('--paths-only', 'emit only the matched paths, one per line, with duplicates collapsed in rank order. Pipeline-friendly twin of `forget --paths-only` / `stale --paths`. Ignores --json / --out / --snippet / --highlight; just dumps paths.')
    .option('--json', 'emit results as a JSON array instead of formatted text')
    .option('-o, --out <file>', 'write results to a file instead of stdout')
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
          threshold?: string;
          sort?: string;
          reverse?: boolean;
          rerankOff?: boolean;
          rerankOnly?: boolean;
          snippet: boolean;
          tsv?: boolean;
          header?: boolean;
          slim?: boolean;
          pathsOnly?: boolean;
          json?: boolean;
          out?: string;
          highlight: boolean;
          snippetWidth: string;
        },
      ) => {
        const rt = await buildRuntime();
        // Stdin sigil: a single literal `-` argument means "the real
        // query comes from stdin". This lets shell loops do
        //   echo "embeddings vs bm25" | clawmind search -
        //   xargs -I{} clawmind search - <<<{}    # one query at a time
        // without having to splice the query into the argv list. Any
        // other argv shape is joined with spaces exactly as before, so
        // existing scripts keep working byte-for-byte. We reject an
        // empty stdin loudly so an accidental `cmd | clawmind search -`
        // with no upstream output does not silently retrieve the whole
        // index by issuing the empty query against every doc.
        let qText: string;
        if (query.length === 1 && query[0] === '-') {
          qText = await readStdin();
          if (qText.length === 0) {
            process.stderr.write(kleur.red('search failed: stdin was empty (no query to run)\n'));
            process.exitCode = 1;
            return;
          }
        } else {
          qText = query.join(' ');
        }
        const q = QuerySchema.parse({
          q: qText,
          k: Number(opts.k),
          namespaces: splitList(opts.namespaces),
          includeTags: splitList(opts.includeTags),
          excludeTags: splitList(opts.excludeTags),
        });
        const rawHits = await retrieve(
          { bm25: rt.bm25, lance: rt.lance, embed: rt.embed, llm: rt.llm, embedModel: rt.env.CLAWMIND_EMBED_MODEL },
          q,
          undefined,
          // --rerank-off + --rerank-only are the two stage-bypass dials.
          // We combine them into a single RetrieveOptions payload so
          // the pipeline only sees one merged shape. When neither flag
          // is set we forward `undefined` (NOT `{}`) so the pipeline
          // default short-circuits without having to check empty
          // objects — keeps the regression contract that every existing
          // caller stays byte-identical.
          //
          // --rerank-off  -> skipRerank: true  (no lexical rerank, MMR still runs)
          // --rerank-only -> skipMmr:    true  (rerank runs, no MMR diversity)
          // both          -> skipRerank+skipMmr: pure hybrid+boost ordering
          (opts.rerankOff || opts.rerankOnly)
            ? {
                ...(opts.rerankOff ? { skipRerank: true } : {}),
                ...(opts.rerankOnly ? { skipMmr: true } : {}),
              }
            : undefined,
        );
        // --threshold is a post-retrieval filter. We apply it here rather
        // than threading a `minScore` through the retrieve() pipeline because
        // the BM25/vector fusion scores are easier to reason about as
        // already-fused floats, and the operator cares about the value they
        // see in the output (`(0.713)`), not the per-side raw scores. We
        // silently ignore a missing or non-numeric value rather than throw
        // so `--threshold $MAYBE` in a shell script does not break when the
        // variable is empty.
        const minScore = opts.threshold !== undefined ? Number.parseFloat(opts.threshold) : NaN;
        const filteredHits = Number.isFinite(minScore) ? rawHits.filter((h) => h.score >= minScore) : rawHits;
        // --sort orders the SURVIVORS of -t/--threshold. Three ordering
        // primitives, all mirroring `related --sort` byte-for-byte:
        //   score (desc)      -> highest-score-first; matches the
        //                         retrieve() pipeline's default order
        //                         (effectively a no-op, useful for
        //                         symmetry with related/feedback/
        //                         digest/aliases --sort and as a
        //                         defence against a future retrieve()
        //                         change)
        //   path (asc)        -> alphabetical, for stable cross-
        //                         snapshot diffs of `search --json`
        //   namespace (asc)   -> alphabetical by namespace then API
        //                         order within each namespace via the
        //                         secondary-by-index sort — groups
        //                         hits by namespace so a dashboard
        //                         panel showing where a query's
        //                         signal clusters is a single call
        //                         away
        //
        // Applied AFTER the threshold filter (so the sort orders the
        // kept set, not the raw retrieved set — matches the operator's
        // expectation "sort what I asked for"). Applied BEFORE the
        // --paths-only emit so the dedupe walks the post-sort order:
        // `--sort namespace --paths-only` emits paths grouped by
        // namespace; `--sort path --paths-only` emits paths in pure
        // alphabetical order.
        //
        // Unknown keys throw cleanly with exit 1 (a typo cannot
        // silently fall back to retrieve() order — which would be
        // indistinguishable from the operator forgetting --sort).
        // Ties carry a secondary sort by original index so two
        // snapshots with identical inputs produce byte-identical
        // output regardless of the engine's Array#sort stability.
        let hits = filteredHits;
        if (opts.sort !== undefined) {
          const sortKey = opts.sort.toLowerCase();
          const validKeys = ['score', 'path', 'namespace'];
          if (!validKeys.includes(sortKey)) {
            process.stderr.write(kleur.red(`search failed: --sort value must be one of: score, path, namespace (got "${opts.sort}")\n`));
            process.exitCode = 1;
            return;
          }
          // --reverse flips the per-key direction. Mirrors `stale
          // --reverse` byte-for-byte: a single sign-flipping multiplier
          // (dir = -1 under --reverse, else 1) applied to BOTH the
          // primary comparator AND the secondary tie-break by original
          // index. The dual-flip preserves cross-snapshot determinism
          // under --reverse — without it, ties would silently shift
          // on every other run because the primary returned 0 but the
          // secondary kept ascending while the visible ordering of
          // every other row was descending.
          const dir = opts.reverse ? -1 : 1;
          hits = filteredHits
            .map((h, idx) => ({ h, idx }))
            .sort((a, b) => {
              let cmp = 0;
              if (sortKey === 'score') cmp = b.h.score - a.h.score;
              else if (sortKey === 'path') cmp = a.h.path.localeCompare(b.h.path);
              else if (sortKey === 'namespace') cmp = a.h.namespace.localeCompare(b.h.namespace);
              if (cmp !== 0) return cmp * dir;
              return (a.idx - b.idx) * dir;
            })
            .map((r) => r.h);
        }
        // --paths-only is the shortest possible pipeline shape: one
        // path per line, deduplicated in rank order. Search returns
        // chunk-granular hits so the SAME file can appear multiple
        // times under different chunks; for a downstream `xargs ls`
        // or `xargs git diff` the operator wants each file once,
        // preserving the rank order so the most-relevant file comes
        // first. We dedupe with a Set sentinel against `h.path` and
        // intentionally short-circuit before the rest of the action
        // body so --json / --out / --highlight / --snippet are all
        // moot — the contract is "give me paths, nothing else". This
        // matches the precedent set by `forget --paths-only` and
        // `stale --paths`. Threshold + filter flags still apply (they
        // shaped `hits` above) so `clawmind search foo --threshold .5
        // --paths-only | xargs ...` works.
        if (opts.pathsOnly) {
          const seen = new Set<string>();
          for (const h of hits) {
            if (seen.has(h.path)) continue;
            seen.add(h.path);
            process.stdout.write(`${h.path}\n`);
          }
          return;
        }
        // --tsv emits a tab-separated row per hit: <rank>\t<path>\t
        // <score>\t<namespace>. Mirrors `stale --tsv` / `stats --tsv`
        // byte-for-byte (zero ANSI, zero header by default, zero
        // trailing summary, plain \n separator). The four columns
        // are deliberately the same fields the --json --slim shape
        // carries so a downstream parser flipping between the two
        // only changes the framing, not the schema.
        //
        // Precedence: --paths-only > --tsv > --json > text. The
        // --paths-only branch above already short-circuited (it is
        // the strictly leaner shape — no rank/score/namespace, just
        // paths). --tsv runs BEFORE the --json branch because a
        // tab-separated pipeline contract is what awk/cut expect,
        // not a JSON wrapper. The text mode is the legacy emit and
        // sits last.
        //
        // Score is emitted with `.toFixed(3)` precision matching the
        // text-mode render (`${h.score.toFixed(3)}` in the header
        // line below) so cross-mode diffs are byte-stable — a
        // snapshot taken with --tsv and one with text mode agree on
        // the score column.
        //
        // --header (when set) prepends the canonical 4-col schema
        // row. Mirrors `stale --tsv --header` / `stats --tsv --header`
        // byte-for-byte: fires UNCONDITIONALLY (including zero-row
        // bodies) because the schema row IS the contract — a
        // downstream pandas.read_csv parsing the stream against an
        // empty workspace should still see the column names and
        // produce a valid empty table, not crash with "No columns
        // to parse".
        //
        // Empty result yields a clean empty stream: the text-mode
        // "no results for X" hint is suppressed under --tsv so
        // xargs/wc see exactly 0 lines. The --header row STILL
        // fires under --header even on the zero-hits path (the
        // contract above), so wc -l = 1 (header only).
        if (opts.tsv) {
          if (opts.header) {
            process.stdout.write('rank\tpath\tscore\tnamespace\n');
          }
          hits.forEach((h, i) => {
            process.stdout.write(
              `${i + 1}\t${h.path}\t${h.score.toFixed(3)}\t${h.namespace}\n`,
            );
          });
          return;
        }
        const terms = queryTerms(q.q);
        const width = Number(opts.snippetWidth) || 240;
        if (opts.json) {
          // --slim is the deeper cut beyond --no-snippet for cron
          // dashboards polling "what does the top-k for query X look
          // like over time" without paying the snippet-rendering
          // cost. Mirrors `doctor --json --quiet`, `digest run --json
          // --slim`, `feedback prune --json --slim`, `feedback list
          // --json --slim`, and `stats --json --slim` byte-for-byte.
          //
          // The full --json payload includes a per-hit snippet
          // (240 bytes default) plus a highlights array — for a
          // cron poll asking "is the top-5 stable" this dominates
          // the payload size. The existing --no-snippet drops
          // snippet/highlights but PRESERVES startLine; --slim is
          // the deeper cut for dashboards that do not need the
          // chunk-identifier byte either.
          //
          // Per-hit shape is exactly `{rank, path, score, namespace}`.
          // Namespace is included because grouping hits by namespace
          // is the single most useful slim-shape query (a query whose
          // top-k clusters in one namespace tells the operator
          // something the score alone does not — and pairs with
          // --sort namespace for the same reason).
          //
          // Composes with -t/--threshold (slim describes survivors),
          // --sort/--reverse (slim emits the post-sort order), -k
          // (slim respects the top-k cap), and namespaces/include-
          // tags/exclude-tags (slim describes the post-filter
          // survivors). The precedence over the other emit modes:
          //   --paths-only > --slim > --no-snippet > full --json
          // --paths-only is the EVEN-leaner shape (no JSON wrapper
          // at all) so it wins; within --json, --slim is strictly
          // slimmer than --no-snippet so --slim wins when both set.
          //
          // Critical perf property: we DO NOT call snippetFor() in
          // the slim path. A cron dashboard polling once a minute
          // should not pay the snippet rendering cost; the slim
          // emit walks the hits list directly. The non-slim/non-
          // -no-snippet path still calls snippetFor() for the full
          // shape (it needs startLine + the snippet body).
          //
          // Single-line JSON.stringify (no indent) so an NDJSON
          // snapshot stream like
          //   while true; do clawmind search foo --json --slim; sleep 60; done
          // produces clean NDJSON that diffs cleanly between ticks.
          //
          // Honours --out: when set, writes the slim payload to the
          // file and emits the "wrote N result(s)" stderr confirm
          // line. Mirrors the full-shape --json behaviour exactly so
          // an operator switching --slim on/off does not see the
          // file-vs-stdout dispatch shift.
          if (opts.slim) {
            const slim = hits.map((h, i) => ({
              rank: i + 1,
              path: h.path,
              score: h.score,
              namespace: h.namespace,
            }));
            const payload = JSON.stringify(slim) + '\n';
            if (opts.out) {
              await writeFile(opts.out, payload, 'utf8');
              process.stderr.write(kleur.green(`wrote ${slim.length} result(s) -> ${opts.out}\n`));
            } else {
              process.stdout.write(payload);
            }
            return;
          }
          // --no-snippet trims the JSON payload to the bare ranking
          // fields (rank/path/score/startLine). It is roughly an order
          // of magnitude smaller than the full payload for large k and
          // is the right shape for rerank/eval pipelines that only care
          // about the order of hits. The startLine is still useful as a
          // tie-breaker / chunk-identifier and is computed regardless,
          // so keeping it costs nothing. Text mode is unaffected because
          // a snippet-less text rendering is just a slower path-and-score
          // dump — that's what `forget --paths-only` / `--paths` are for.
          const out = hits.map((h, i) => {
            const snip = snippetFor(h, terms, width);
            if (opts.snippet === false) {
              return {
                rank: i + 1,
                path: h.path,
                score: h.score,
                startLine: snip.startLine,
              };
            }
            return {
              rank: i + 1,
              path: h.path,
              score: h.score,
              startLine: snip.startLine,
              snippet: snip.text,
              highlights: snip.highlights,
            };
          });
          const payload = JSON.stringify(out, null, 2) + '\n';
          if (opts.out) {
            await writeFile(opts.out, payload, 'utf8');
            process.stderr.write(kleur.green(`wrote ${out.length} result(s) -> ${opts.out}\n`));
          } else {
            process.stdout.write(payload);
          }
          return;
        }
        if (hits.length === 0) {
          const filters: string[] = [];
          if (q.namespaces?.length) filters.push(`namespaces=${q.namespaces.join(',')}`);
          if (q.includeTags?.length) filters.push(`include-tags=${q.includeTags.join(',')}`);
          if (q.excludeTags?.length) filters.push(`exclude-tags=${q.excludeTags.join(',')}`);
          if (Number.isFinite(minScore)) filters.push(`threshold=${minScore}`);
          const suffix = filters.length ? ` with ${filters.join(' ')}` : '';
          process.stderr.write(kleur.gray(`no results for "${q.q}"${suffix}\n`));
          return;
        }
        // When writing to a file, drop ANSI styling so the saved text is clean.
        const useColor = opts.highlight && !opts.out;
        const chunks: string[] = [];
        hits.forEach((h, i) => {
          const snip = snippetFor(h, terms, width);
          let line = snip.text.replace(/\n/g, ' ');
          if (useColor) {
            // Walk spans in reverse so earlier offsets stay valid as we splice.
            for (let s = snip.highlights.length - 1; s >= 0; s--) {
              const hl = snip.highlights[s]!;
              const before = line.slice(0, hl.start);
              const mid = line.slice(hl.start, hl.end);
              const after = line.slice(hl.end);
              line = before + kleur.yellow().bold(mid) + after;
            }
          }
          const header = opts.out
            ? `#${i + 1} ${h.path}:${snip.startLine} (${h.score.toFixed(3)})\n`
            : `${kleur.cyan(`#${i + 1}`)} ${kleur.gray(h.path + ':' + snip.startLine)} ${kleur.dim(`(${h.score.toFixed(3)})`)}\n`;
          chunks.push(header + `${line}\n\n`);
        });
        if (opts.out) {
          await writeFile(opts.out, chunks.join(''), 'utf8');
          process.stderr.write(kleur.green(`wrote ${hits.length} result(s) -> ${opts.out}\n`));
        } else {
          for (const c of chunks) process.stdout.write(c);
        }
      },
    );
}
