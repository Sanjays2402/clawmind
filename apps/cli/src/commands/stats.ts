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
    .option('--top <n>', 'cap the per-namespace extension breakdown at this many entries (default 4)', '4')
    .option('--sort <key>', 'sort namespaces descending by one of: files, chunks, bytes, namespace (default: namespace)', 'namespace')
    .option('--since <iso-date>', 'keep only namespaces whose newestIngestedAt is older than this ISO date (i.e. have not been re-ingested since the cutoff). Useful for finding namespaces that have gone stale at the namespace level — complements `stale` which works at the per-file level. Namespaces with newestIngestedAt=null (never indexed) are KEPT because they are trivially older than any cutoff. The recomputed totals reflect the filtered subset so a downstream "stale namespaces dominate X bytes" report still adds up.')
    .option('--tsv', 'emit tab-separated rows (namespace<TAB>files<TAB>chunks<TAB>bytes<TAB>newestIngestedAt) for awk/cut pipelines')
    .option('--paths', 'pipeline-friendly: emit ONLY the per-namespace `extensions[*].ext` flat list, one extension per line, in API order. Answers "which file types live in this namespace" without --json + jq. Composes with -q (filter by namespace name first) and --top (cap each namespace contribution before emit) for "the top 3 extensions in namespaces matching `mem`". Zero matches yields a clean empty stream so xargs/wc keep working. Wins over --json / --tsv / text when set (short-circuits the contract is unambiguous).')
    .option('--json', 'emit machine-readable JSON instead of a text table')
    .option('--compact', 'with --json: emit a single-line JSON document (no indentation) for easier diffing across cron snapshots. Ignored without --json.')
    .option('--slim', 'with --json: emit a slimmed `{stale: [<namespace>], total: N}` shape carrying only the names of namespaces in the report instead of the full per-namespace metric blocks. The classic cron use is `clawmind stats --json --slim --since <iso>` to answer "which namespaces have gone stale at the namespace level" without piping the full report through `jq` for the namespace names. The `stale` key is the name (the operator already asked the question — they want a clean array of strings, not nested objects). `total` is the length of `stale` so a downstream `jq .total` can branch on emptiness without inspecting the array. Without --since the payload is "all namespaces matching the other filters", which is still a useful cron-snapshot shape (it tracks namespace presence over time). Ignored without --json. Wins over --compact when both are set because --slim already implies single-line output.')
    .action(async (opts: { json?: boolean; tsv?: boolean; paths?: boolean; query?: string; top: string; sort: string; since?: string; compact?: boolean; slim?: boolean }) => {
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
        // do not have to change.
        const sortKey = opts.sort.toLowerCase();
        if (sortKey === 'files' || sortKey === 'chunks' || sortKey === 'bytes') {
          const sorted = [...report.byNamespace].sort((a, b) => b[sortKey] - a[sortKey]);
          report = { ...report, byNamespace: sorted };
        } else if (sortKey !== 'namespace') {
          throw new StatsCliError(`unknown --sort key "${opts.sort}" (expected: files, chunks, bytes, namespace)`);
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
            const stale = report.byNamespace.map((n) => n.namespace);
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
