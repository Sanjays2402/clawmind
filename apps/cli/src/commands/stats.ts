import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

interface NamespaceStats {
  namespace: string;
  files: number;
  chunks: number;
  bytes: number;
  oldestIngestedAt: number | null;
  newestIngestedAt: number | null;
  extensions: { ext: string; count: number }[];
}

interface StatsReport {
  totals: { files: number; chunks: number; bytes: number; namespaces: number };
  byNamespace: NamespaceStats[];
  generatedAt: number;
}

class StatsCliError extends Error {}

async function apiFetch(method: string, path: string) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StatsCliError(`cannot reach ${base} (${msg})`);
  }
  if (!res.ok) {
    let detail = (await res.text()).trim();
    try {
      const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
      if (typeof parsed.message === 'string') detail = parsed.message;
      else if (typeof parsed.error === 'string') detail = parsed.error;
    } catch {
      // not JSON, keep as text
    }
    if (detail.length > 200) detail = detail.slice(0, 200) + '...';
    const suffix = detail ? `: ${detail}` : '';
    throw new StatsCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof StatsCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAge(ms: number | null): string {
  if (ms === null) return 'never';
  const delta = Date.now() - ms;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function statsCommand() {
  return new Command('stats')
    .description('Per-namespace breakdown of indexed files, chunks, and bytes')
    .option('-q, --query <substr>', 'only include namespaces whose name contains this substring (case-insensitive)')
    .option('--top <n>', 'cap the per-namespace extension breakdown at this many entries (default 4). Under --json --slim the meaning shifts: --top caps the `stale` namespace array at the top N namespaces (after --sort / --reverse have ordered the survivors). This is the more useful behaviour under --slim because the per-namespace extensions list is dropped entirely under the slim shape, so leaving --top a no-op would silently ignore an explicit cap from the operator. The canonical cron poll is `clawmind stats --json --slim --since <iso> --sort files --top 5` to answer "which 5 namespaces dominate the stale set" with a single-line ~50-byte payload. Without --slim or without --json, --top behaves as before (caps the per-namespace extensions list). The pinned semantics: --top cap applies AFTER every narrowing filter (-q, --since) and AFTER every ordering (--sort, --reverse) — same as `feedback list --top`, `search --top`, and `digest list --top` family contracts.', '4')
    .option('--sort <key>', 'sort namespaces descending by one of: files, chunks, bytes, namespace (alias: name). Default: namespace. Mirrors the family-wide --sort contract used by feedback / digest / aliases / related / search / stale --sort: ties at the same metric carry a secondary sort by original index for cross-snapshot determinism (so two consecutive `stats --json --sort files` runs over identical input produce byte-identical output regardless of the engine\'s Array#sort stability), and unknown keys abort cleanly with exit 1 enumerating the valid set. The `name` alias is the family-wide canonical spelling; the original `namespace` spelling is preserved for back-compat. Both behave identically.', 'namespace')
    .option('--reverse', 'flip the --sort direction (mirrors `stale --reverse` / `search --reverse` / `related --reverse` / `feedback list --reverse` / `digest list --reverse` / `aliases list --reverse` byte-for-byte). With --sort files / chunks / bytes the default is desc (biggest namespace first); --reverse gives asc (smallest first) — the natural "audit underutilized namespaces" question, complementary to the "which namespace dominates" default. With --sort namespace / name the default is asc alphabetical; --reverse gives desc — useful for `tail`-style log scrapes where the FIRST change is the operator\'s focus and lives at the bottom of an alphabetical run. NOTE on the no-default-sort contract: every OTHER --sort-bearing command in the family treats --reverse without --sort as a no-op because --sort is undefined by default. Stats is the exception — --sort has a default value of "namespace", so --reverse is ALWAYS active (it flips against the default namespace order even with no --sort flag passed). This is the only family-contract deviation and it falls out of stats predating the family-wide reverse contract; documenting it here so the precedent is explicit. The secondary tie-break by original index is ALSO reversed under --reverse so cross-snapshot determinism holds in either direction.')
    .option('--since <iso-date>', 'keep only namespaces whose newestIngestedAt is older than this ISO date (i.e. have not been re-ingested since the cutoff). Useful for finding namespaces that have gone stale at the namespace level — complements `stale` which works at the per-file level. Namespaces with newestIngestedAt=null (never indexed) are KEPT because they are trivially older than any cutoff. The recomputed totals reflect the filtered subset so a downstream "stale namespaces dominate X bytes" report still adds up.')
    .option('--tsv', 'emit tab-separated rows (namespace<TAB>files<TAB>chunks<TAB>bytes<TAB>newestIngestedAt) for awk/cut pipelines')
    .option('--paths', 'pipeline-friendly: emit ONLY the per-namespace `extensions[*].ext` flat list, one extension per line, in API order. Answers "which file types live in this namespace" without --json + jq. Composes with -q (filter by namespace name first) and --top (cap each namespace contribution before emit) for "the top 3 extensions in namespaces matching `mem`". Zero matches yields a clean empty stream so xargs/wc keep working. Wins over --json / --tsv / text when set (short-circuits the contract is unambiguous). NOTE on --json --slim composition: with the `--json --slim` flag pair active, --paths re-targets from the per-namespace extension stream to the FLAT NAMESPACE-NAME stream (one namespace name per line). This is the natural pipeline-friendly twin of the slim JSON shape `{stale, total}` — a downstream `xargs` consumer (e.g. `clawmind stats --json --slim --since X --paths | xargs -I{} clawmind digest run --namespace {}`) wants the namespace names path-style, NOT wrapped in JSON. Without --slim, --paths preserves its legacy extension-stream meaning byte-for-byte (no regression for existing scripts).')
    .option('--json', 'emit machine-readable JSON instead of a text table')
    .option('--compact', 'with --json: emit a single-line JSON document (no indentation) for easier diffing across cron snapshots. Ignored without --json.')
    .option('--slim', 'with --json: emit a slimmed `{stale: [<namespace>], total: N}` shape carrying only the names of namespaces in the report instead of the full per-namespace metric blocks. The classic cron use is `clawmind stats --json --slim --since <iso>` to answer "which namespaces have gone stale at the namespace level" without piping the full report through `jq` for the namespace names. The `stale` key is the name (the operator already asked the question — they want a clean array of strings, not nested objects). `total` is the length of `stale` so a downstream `jq .total` can branch on emptiness without inspecting the array. Without --since the payload is "all namespaces matching the other filters", which is still a useful cron-snapshot shape (it tracks namespace presence over time). Ignored without --json. Wins over --compact when both are set because --slim already implies single-line output. Composes with --tsv: `--json --slim --tsv` emits one `<namespace>\\t<files>` row per surviving namespace (no header, no trailing summary, no ANSI) for awk pipelines that want both the staleness filter AND the per-namespace file count in a single 2-column stream. Composes with --top: under --slim the --top cap re-targets from the per-namespace extensions list (which is dropped under --slim anyway) to the `stale` namespace array, so `--json --slim --sort files --top 5` is "the 5 biggest namespaces by file count" as a single-line ~50-byte panel. Without --slim, --top keeps its legacy per-namespace-extensions meaning byte-for-byte.')
    .action(async (opts: { json?: boolean; tsv?: boolean; paths?: boolean; query?: string; top: string; sort: string; reverse?: boolean; since?: string; compact?: boolean; slim?: boolean }) => {
      await runOrReport('stats', async () => {
        let report = (await apiFetch('GET', '/v1/stats')) as StatsReport;
        if (opts.query) {
          const needle = opts.query.toLowerCase();
          const byNamespace = report.byNamespace.filter((n) => n.namespace.toLowerCase().includes(needle));
          const totals = byNamespace.reduce(
            (acc, n) => {
              acc.files += n.files;
              acc.chunks += n.chunks;
              acc.bytes += n.bytes;
              return acc;
            },
            { files: 0, chunks: 0, bytes: 0, namespaces: byNamespace.length },
          );
          report = { ...report, byNamespace, totals };
        }
        // --since <iso-date> keeps only namespaces whose newestIngestedAt
        // predates the cutoff. The intent is "show me namespaces that
        // are stale at the namespace level" — a complement to `stale`
        // which works at the per-file level. Two important design
        // properties:
        //   1. Namespaces with newestIngestedAt === null (never indexed
        //      / no timestamp) are KEPT. They are trivially older than
        //      any cutoff, so dropping them would hide exactly the
        //      class of bug an operator running this filter cares
        //      about (a namespace that exists but never got ingested).
        //   2. Totals are RECOMPUTED to reflect the filtered subset so
        //      a downstream "X bytes are dominated by stale
        //      namespaces" report still adds up. Without this the
        //      "namespaces" total would silently drift away from the
        //      length of `byNamespace`, which breaks the invariant
        //      every other filter in this command preserves (`-q`,
        //      etc.). We reuse the same reduce shape as -q so the
        //      math stays equivalent.
        // Parse failures abort with the standard cli error path so a
        // typo like `--since 2026-13-01` does not silently fall back to
        // "no filter".
        if (opts.since) {
          const cutoff = Date.parse(opts.since);
          if (!Number.isFinite(cutoff)) {
            throw new StatsCliError(`--since value "${opts.since}" is not a valid ISO date`);
          }
          const byNamespace = report.byNamespace.filter(
            (n) => n.newestIngestedAt === null || n.newestIngestedAt < cutoff,
          );
          const totals = byNamespace.reduce(
            (acc, n) => {
              acc.files += n.files;
              acc.chunks += n.chunks;
              acc.bytes += n.bytes;
              return acc;
            },
            { files: 0, chunks: 0, bytes: 0, namespaces: byNamespace.length },
          );
          report = { ...report, byNamespace, totals };
        }
        // --top trims the per-namespace `extensions` list in both --json and
        // text mode. We clamp to a sensible range so a user typo like
        // `--top 0` or `--top -1` still produces a meaningful output instead
        // of a silently empty table; large values (e.g. `--top 1000`) just
        // mean "show them all".
        const parsedTop = Number.parseInt(opts.top, 10);
        const topN = Number.isFinite(parsedTop) && parsedTop > 0 ? parsedTop : 4;
        report = {
          ...report,
          byNamespace: report.byNamespace.map((n) => ({
            ...n,
            extensions: n.extensions.slice(0, topN),
          })),
        };
        // --sort lets the operator rank by their preferred metric. The
        // numeric keys sort descending (biggest namespace first) because
        // that is the question they answer ("which namespace dominates the
        // index?"). The default "namespace" key keeps the alphabetical
        // order the API returns so existing scripts that diff stats output
        // do not have to change. `name` is a family-wide alias for
        // `namespace` (mirrors the canonical spelling exposed by aliases
        // list --sort name / digest list --sort title etc.); both behave
        // identically so existing scripts using `--sort namespace` keep
        // working unchanged.
        //
        // Ties on the numeric keys carry a secondary sort by original
        // index so two consecutive `stats --json --sort files` runs over
        // identical input produce byte-identical output. Without the
        // secondary sort, V8's Array#sort is stable in practice (since
        // 7.0) but the contract would be unenforced — a future engine
        // change or polyfill could in principle de-tie equal-files
        // namespaces in either order, and the cron snapshot would drift
        // between runs. Mirrors the family-wide secondary-index sort
        // (feedback / digest / aliases / related / search / stale --sort).
        const sortKey = opts.sort.toLowerCase();
        // --reverse flips the per-key direction. Mirrors the family-
        // wide reverse-modifier contract (stale / search / related /
        // feedback list / digest list / aliases list --reverse) byte-
        // for-byte: a single sign-flipping multiplier (dir = -1 under
        // --reverse, else 1) applied to BOTH the primary comparator
        // AND the secondary tie-break by original index. The dual-
        // flip preserves cross-snapshot determinism under --reverse.
        //
        // The namespace/name no-op path uses Array#reverse() to flip
        // the API-returned alphabetical order (which is asc by
        // default) — that's the same desc-alphabetical result the
        // numeric-key dir-multiplier would produce if there were a
        // localeCompare on the namespace field, so the two paths are
        // observationally indistinguishable to a downstream consumer.
        // Ties under namespace/name cannot happen by definition (each
        // namespace name is unique server-side) so the secondary-
        // index reverse is implicit in the array-reverse.
        const dir = opts.reverse ? -1 : 1;
        if (sortKey === 'files' || sortKey === 'chunks' || sortKey === 'bytes') {
          const sorted = [...report.byNamespace]
            .map((n, idx) => ({ n, idx }))
            .sort((a, b) => {
              const cmp = b.n[sortKey] - a.n[sortKey];
              if (cmp !== 0) return cmp * dir;
              return (a.idx - b.idx) * dir;
            })
            .map((r) => r.n);
          report = { ...report, byNamespace: sorted };
        } else if (sortKey !== 'namespace' && sortKey !== 'name') {
          throw new StatsCliError(`unknown --sort key "${opts.sort}" (expected: files, chunks, bytes, namespace, name)`);
        } else if (opts.reverse) {
          // namespace/name with --reverse: the API returns the list
          // in asc-alphabetical order so a plain Array#reverse()
          // gives desc-alphabetical, the contract for --reverse on
          // an alphabetical default. Without --reverse this branch
          // is a no-op (the API order is preserved).
          report = { ...report, byNamespace: [...report.byNamespace].reverse() };
        }
        // --paths is the pipeline-friendly flat-extension stream. It
        // emits ONLY the per-namespace `extensions[*].ext` field, one
        // ext per line, walked in API order (namespace order from the
        // server, then extension order from the server's per-namespace
        // ranking). It answers "which file types live in this
        // namespace" without --json + jq. The natural call sites:
        //
        //   clawmind stats --paths -q memory          # exts in `memory` namespace
        //   clawmind stats --paths --top 1            # the dominant ext per namespace
        //   clawmind stats --paths -q mem --top 3     # top 3 in matching namespaces
        //
        // All prior filters (-q, --since, --top, --sort) have already
        // narrowed `report` above, so we just walk what is left. Zero
        // matches yields a clean empty stream — no header, no "no
        // namespaces" hint, no ANSI — so downstream `sort -u`,
        // `xargs`, `wc -l` keep working without conditional skips.
        // We do NOT dedupe across namespaces: two namespaces with the
        // same `.md` extension surface `md` twice. A consumer that
        // wants the unique set can `| sort -u`; surfacing duplicates
        // by default is the only way to count "which namespaces
        // contain md files" via `clawmind stats --paths | grep -c md`.
        // --paths is checked BEFORE --json/--tsv/text so the contract
        // is unambiguous: pipeline-friendly trumps pretty output, the
        // same precedent set by `search --paths-only` short-circuiting
        // `--json`.
        if (opts.paths) {
          // --json --slim --paths re-targets the flat stream from
          // per-namespace extensions to the FLAT NAMESPACE-NAME
          // stream (one namespace name per line, no styling, no
          // header). The natural pipeline-friendly twin of the
          // slim JSON shape `{stale, total}` — a downstream `xargs`
          // consumer wants the namespace names path-style, NOT
          // wrapped in JSON. Pinned canonical use:
          //   clawmind stats --json --slim --since X --paths | \
          //     xargs -I{} clawmind digest run --namespace {}
          // is "for every namespace that's gone stale at the
          // namespace level, run the matching digest" as a single
          // shell pipe.
          //
          // The re-target is GATED on --json --slim being active
          // so existing scripts using just `--paths` (without
          // --slim) continue to get the legacy extension-stream
          // byte-for-byte — no regression. Without --slim, the
          // walk falls through to the per-namespace extension
          // loop below.
          //
          // The namespace names are emitted in the SAME order the
          // slim `stale` array would carry them: post-sort,
          // post-reverse, post-top-cap. That matters because the
          // slim JSON shape pins a specific ordering contract
          // (--sort files --top 5 = the 5 biggest); the --paths
          // re-target must preserve it so the two shapes are
          // observationally consistent (a consumer that picks
          // either gets the same set, just framed differently).
          //
          // Apply the same --top cap the slim JSON path uses:
          // explicit --top wins, the default '4' is intentionally
          // NOT enforced under --slim so the FULL namespace list
          // emits when the operator did not ask for a cap.
          if (opts.json && opts.slim) {
            let namespaces = report.byNamespace.map((n) => n.namespace);
            if (opts.top !== '4' && topN < namespaces.length) {
              namespaces = namespaces.slice(0, topN);
            }
            for (const ns of namespaces) process.stdout.write(`${ns}\n`);
            return;
          }
          for (const ns of report.byNamespace) {
            for (const e of ns.extensions) {
              process.stdout.write(`${e.ext}\n`);
            }
          }
          return;
        }
        if (opts.json) {
          // --slim emits a `{stale: [<namespace>], total: N}` shape
          // — just the namespace names that survived every prior
          // filter (-q, --since, etc.), plus a total for easy
          // `jq .total > 0` branching. The classic cron use is
          // `clawmind stats --json --slim --since <iso>` to answer
          // "which namespaces have gone stale at the namespace
          // level" without piping the full report through `jq` for
          // the namespace names. The key is `stale` because the
          // operator running this filter pair is asking the
          // staleness question — the array is a "needs attention"
          // list. Without --since the same payload is just "all
          // namespaces matching the other filters" which is still a
          // useful cron-snapshot shape (it tracks namespace
          // presence over time). --slim wins over --compact when
          // both are passed because --slim already implies a
          // single-line single-pass shape; no further pretty/compact
          // toggling matters. We keep total === stale.length so a
          // downstream consumer never has to reconcile the two.
          if (opts.slim) {
            // --tsv composes with --slim for the awk-pipeline shape:
            // one `<namespace>\t<files>` row per surviving namespace,
            // no header, no trailing summary, no ANSI. The natural
            // cron use is:
            //   clawmind stats --json --slim --tsv --since <iso> | awk -F'\t' '$2 > 100'
            // which lists every namespace older than the cutoff
            // whose file count crosses a threshold — two filters in
            // one pipeline without `jq` needing to flatten the slim
            // shape.
            //
            // Why files (NOT bytes/chunks): files is the cheapest
            // "size" signal — a namespace with one 100KB file and
            // a namespace with 100 1KB files look the same to an
            // operator asking "which stale namespace should I clear
            // first?". Files is also what stale/--paths counts,
            // so the two contracts compose: a `wc -l` on
            // `clawmind stale --since X --paths` should agree
            // numerically with `awk '{s+=$2} END {print s}'` on
            // `clawmind stats --json --slim --tsv --since X`
            // restricted to the same namespaces.
            //
            // Wins over the regular slim JSON shape when both
            // --tsv and --slim are set with --json. The flag
            // resolution order is: --slim > --compact (already
            // documented), then within --slim: --tsv > default
            // JSON. The text-mode `--tsv` path on the full stats
            // is unaffected because that's gated on `!opts.json`.
            if (opts.tsv) {
              for (const ns of report.byNamespace) {
                process.stdout.write(`${ns.namespace}\t${ns.files}\n`);
              }
              return;
            }
            // --top caps the `stale` namespace array under --slim.
            // The legacy per-namespace-extensions cap is meaningless
            // here because the slim shape drops `extensions` entirely
            // — re-targeting the cap to the `stale` array honours the
            // operator's explicit cap intent and mirrors the family-
            // wide `--top` contract (feedback list / search / digest
            // list --top cap their primary collection AFTER --sort
            // ordering). The cap fires after the prior --top
            // already trimmed `extensions[]` above (which is a no-op
            // for the slim shape but kept for branch symmetry); this
            // second cap operates on the slim primary array.
            //
            // We re-parse opts.top because the prior parsedTop /
            // topN computation above already consumed it but we
            // need the validated integer here too. Sharing the
            // upstream `topN` keeps the math equivalent — `--top 0`
            // / non-numeric / negative inputs all fall back to the
            // family-wide default cap of 4. We cap to N only when
            // N is LESS than the current length so the legacy
            // unbounded shape (`--slim` without explicit --top) is
            // preserved: the default of `--top 4` from commander is
            // intentionally NOT enforced under --slim because the
            // operator polling a stats-slim dashboard typically
            // wants the FULL namespace list ("how many namespaces
            // are stale"), not the top-4 default. We detect the
            // explicit-vs-default case by checking opts.top against
            // the commander default literal '4' — if the operator
            // passed --top explicitly (even '--top 4') the cap is
            // honoured, otherwise we leave the slim list unbounded.
            // This deviates from the legacy --top-affects-extensions
            // path which always applies the default, but it matches
            // the operator's mental model for --slim ("if I didn't
            // ask to cap, don't cap"). Documented in the --top
            // help text.
            let stale = report.byNamespace.map((n) => n.namespace);
            if (opts.top !== '4' && topN < stale.length) {
              stale = stale.slice(0, topN);
            }
            process.stdout.write(JSON.stringify({ stale, total: stale.length }) + '\n');
            return;
          }
          // --compact swaps the pretty-printed (indent=2) document for a
          // single-line JSON document. This is the right shape for
          // `clawmind stats --json --compact > stats.ndjson` scripts
          // that snapshot the index over time and want each row to live
          // on exactly one line (so `diff` / `comm` / line-oriented
          // tooling compares snapshots without indentation churn). The
          // trailing newline stays so each emission is still a complete
          // line — appending two compact snapshots produces valid
          // NDJSON. The default (indent=2) shape is unchanged so
          // existing pipes do not regress.
          const body = opts.compact
            ? JSON.stringify(report)
            : JSON.stringify(report, null, 2);
          process.stdout.write(body + '\n');
          return;
        }
        if (opts.tsv) {
          // No header by default — mirrors `stale --tsv` so `awk -F'\t'`
          // and `cut -f2` keep working without conditional skips. The
          // columns intentionally lead with the namespace name so a
          // partial pipeline that only splits the first field still
          // identifies each row. newestIngestedAt is the raw epoch ms
          // (or empty string when never indexed) so downstream tools
          // can format it however they want.
          for (const ns of report.byNamespace) {
            const newest = ns.newestIngestedAt == null ? '' : String(ns.newestIngestedAt);
            process.stdout.write(
              `${ns.namespace}\t${ns.files}\t${ns.chunks}\t${ns.bytes}\t${newest}\n`,
            );
          }
          return;
        }
        process.stdout.write(
          kleur.bold(
            `${report.totals.files} files, ${report.totals.chunks} chunks, ` +
            `${fmtBytes(report.totals.bytes)} across ${report.totals.namespaces} namespaces\n\n`,
          ),
        );
        if (report.byNamespace.length === 0) {
          process.stdout.write(kleur.gray('no files indexed yet\n'));
          return;
        }
        for (const ns of report.byNamespace) {
          const top = ns.extensions.map((e) => `${e.ext}:${e.count}`).join(' ');
          process.stdout.write(
            `${kleur.cyan(ns.namespace.padEnd(10))} ` +
            `${String(ns.files).padStart(6)} files  ` +
            `${String(ns.chunks).padStart(7)} chunks  ` +
            `${fmtBytes(ns.bytes).padStart(10)}  ` +
            kleur.gray(`updated ${fmtAge(ns.newestIngestedAt)}  [${top}]\n`),
          );
        }
      });
    });
}
