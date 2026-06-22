import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI for the /v1/sources/stale endpoint. Prints sources whose last ingest
// is older than the threshold, oldest first. Designed for piping: with
// --paths only the path column is emitted, suitable for feeding into
// `clawmind reindex --files -`.

class StaleCliError extends Error {}

async function apiFetch(method: string, path: string) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { method });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StaleCliError(`cannot reach ${base} (${msg})`);
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
    throw new StaleCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof StaleCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

export function staleCommand() {
  const cmd = new Command('stale')
    .description('List sources not re-ingested in N days')
    .option('-d, --days <n>', 'staleness threshold in days', '30')
    .option('-l, --limit <n>', 'cap on rows returned', '200')
    .option('-q, --q <text>', 'case-insensitive substring filter on path')
    .option('--since <iso-date>', 'further restrict the report to files whose last ingest predates this ISO date. Complements --days <n> (which is a relative "older than N days from now" threshold) by accepting an absolute cutoff — useful from cron where the cutoff is anchored to a known date. The two filters compose: the kept set is the intersection. Files are kept when their lastIngestedAt < cutoff; lastIngestedAt is derived from the row\'s ageDays (which the API already computes against current time) so a file aged 90 days passes `--since` cutoffs up to 90 days in the past. Parse failures abort cleanly.')
    .option('--paths', 'print just the path column for piping into other commands. Predates the `--paths-only` naming used by search/forget/related/pins etc. and is preserved here for back-compat with byte-layout tests; `--paths-only` is the recommended alias going forward.')
    .option('--paths-only', 'alias for --paths to bring the flag in line with search/forget/related (which all expose --paths-only). Either flag emits exactly the same byte stream (one path per line, no ANSI, no header) so existing scripts using --paths keep working unchanged. When both are passed, --paths-only wins (it is the newer, canonical spelling).')
    .option('--sort <key>', 'sort survivors of -q / --since / --days by one of: age (desc — oldest-first, the natural "what should I clean up first" ordering and the question stale is built around; equivalent to ageDays descending), path (asc alphabetical, for stable cross-snapshot diffs of `stale --json` / `stale --tsv`), size (desc — biggest stale files first, the natural "which deletes recover the most disk space" ordering). Applied AFTER the narrowing filters so the sort orders the SURVIVORS (matches the operator\'s "sort what I asked for" expectation, consistent with feedback/digest/aliases/related/search --sort). Applied BEFORE every output mode (--json / --tsv / --paths / --paths-only / text) so each mode sees the SAME ordered subset — a downstream consumer parsing --json and a sibling parsing --tsv get byte-equivalent row orders. Mirrors the family contract: ties carry a secondary sort by original index for cross-snapshot determinism, unknown keys abort cleanly with exit 1, default preserves the API-returned order (which is already oldest-first, so --sort age is effectively a no-op against the default but useful for symmetry).')
    .option('--tsv', 'emit tab-separated rows (path<TAB>ageDays<TAB>chunkCount<TAB>size) suitable for awk/cut')
    .option('--header', 'with --tsv: prepend a single tab-separated header row (`path\\tageDays\\tchunkCount\\tsize`) so the stream is friendly to `column -ts$\\\'\\\\t\\\'` / pandas.read_csv / spreadsheet imports without a separate echo. The default header-less shape is preserved when --header is absent so the long-standing awk-pipeline contract (`awk -F$\\\'\\\\t\\\' \\\'{print $1}\\\'`) still works byte-for-byte. Ignored without --tsv (the JSON / --paths / --paths-only / text modes already have their own well-defined shapes; adding a header line to those would break tests pinned to their exact byte layouts). When zero rows pass the filters AND --header is set, the header row STILL fires so a downstream consumer parsing the stream into a typed table never has to special-case an empty body — the schema row is the contract, not the data rows.')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { days: string; limit: string; paths?: boolean; pathsOnly?: boolean; tsv?: boolean; header?: boolean; q?: string; since?: string; sort?: string; json?: boolean }) => {
      await runOrReport('stale', async () => {
        const params: Record<string, string> = {
          olderThanDays: opts.days,
          limit: opts.limit,
        };
        if (opts.q) params.q = opts.q;
        const qs = new URLSearchParams(params).toString();
        let out = (await apiFetch('GET', `/v1/sources/stale?${qs}`)) as {
          thresholdDays: number;
          total: number;
          items: { path: string; ageDays: number; chunkCount: number; size: number }[];
        };
        // --since <iso-date> is a client-side post-filter that
        // intersects with the existing --days threshold. The /v1
        // endpoint already filters by "older than N days from now"
        // (a relative window anchored to wall-clock); --since gives
        // the operator an absolute anchor instead, which matters
        // from cron where the cutoff often lives in a config or env
        // var rather than being recomputed each run. We compute each
        // row's effective lastIngestedAt by subtracting ageDays from
        // the current wall clock — the API does not surface the
        // timestamp directly but ageDays is computed from it, so the
        // round-trip is lossless to the nearest day. Files whose
        // effective lastIngestedAt < cutoff are kept; the rest are
        // dropped. We recompute `total` from the filtered length so
        // the "N stale, showing M" header in text mode reflects the
        // post-filter shape — otherwise the operator would see a
        // header that does not match the rows below it. Parse
        // failures abort cleanly via the StaleCliError path so a
        // typo like `--since 2026-13-01` does not silently fall back
        // to "no extra filter".
        if (opts.since) {
          const cutoff = Date.parse(opts.since);
          if (!Number.isFinite(cutoff)) {
            throw new StaleCliError(`--since value "${opts.since}" is not a valid ISO date`);
          }
          const now = Date.now();
          const dayMs = 86_400_000;
          const items = out.items.filter((it) => (now - it.ageDays * dayMs) < cutoff);
          out = { ...out, items, total: items.length };
        }
        // --sort orders the SURVIVORS of -q / --since / --days. Three
        // ordering primitives, mirroring the family-wide --sort contract:
        //   age (desc)   -> oldest-first (the natural "what should I
        //                    clean up first" ordering and the question
        //                    stale is built around). Effectively a no-op
        //                    against the API default (which already
        //                    returns oldest-first), but useful for
        //                    symmetry with other commands and as a
        //                    defence against a future API change that
        //                    reorders rows.
        //   path (asc)   -> alphabetical, for stable cross-snapshot
        //                    diffs of `stale --json` / `stale --tsv`.
        //                    Pairs naturally with --header on TSV mode
        //                    for a typed-table import where the row
        //                    order is part of the contract.
        //   size (desc)  -> biggest stale files first; the natural
        //                    "which deletes recover the most disk
        //                    space" ordering. The canonical cron use
        //                    is `clawmind stale --sort size --paths`
        //                    to feed `xargs forget` in size-priority
        //                    order so a tight cleanup budget hits the
        //                    biggest savings first.
        //
        // Applied AFTER the narrowing filters so the sort orders the
        // kept set. Applied BEFORE every output mode (--json, --tsv,
        // --paths, --paths-only, default text) so each mode sees the
        // SAME ordered subset — a downstream consumer parsing --json
        // and a sibling parsing --tsv get byte-equivalent row orders.
        //
        // Ties carry a secondary sort by original index (matches the
        // family contract). Unknown keys throw cleanly.
        if (opts.sort !== undefined) {
          const sortKey = opts.sort.toLowerCase();
          const validKeys = ['age', 'path', 'size'];
          if (!validKeys.includes(sortKey)) {
            throw new StaleCliError(`--sort value must be one of: age, path, size (got "${opts.sort}")`);
          }
          const ranked = out.items
            .map((it, idx) => ({ it, idx }))
            .sort((a, b) => {
              let cmp = 0;
              if (sortKey === 'age') cmp = b.it.ageDays - a.it.ageDays;
              else if (sortKey === 'path') cmp = a.it.path.localeCompare(b.it.path);
              else if (sortKey === 'size') cmp = b.it.size - a.it.size;
              if (cmp !== 0) return cmp;
              return a.idx - b.idx;
            })
            .map((r) => r.it);
          out = { ...out, items: ranked };
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        // --paths-only is the canonical alias for --paths. The two
        // flags emit exactly the same byte stream (one path per line,
        // no ANSI, no header) so existing scripts using --paths keep
        // working unchanged AND new scripts can use the family-wide
        // --paths-only naming that search/forget/related/etc. all
        // expose. We OR the two flags so either spelling triggers
        // the pipeline-friendly shape; when both are passed, the
        // effect is identical (no warning, no precedence — they are
        // truly equivalent). This keeps the flag family uniform
        // without breaking the existing --paths contract that the
        // tests pin to its exact byte layout.
        if (opts.paths || opts.pathsOnly) {
          for (const it of out.items) process.stdout.write(`${it.path}\n`);
          return;
        }
        if (opts.tsv) {
          // No header by default: leaves the output drop-in friendly for
          // `awk -F'\t' '{print $1}'` and `sort -t$'\t' -k2 -n`. The columns
          // intentionally lead with the path so a partial pipeline that only
          // splits the first field still works.
          //
          // --header opts INTO a single tab-separated schema row prepended
          // to the body. The natural cron use is piping the stream into
          // `column -ts$'\t'` or `pandas.read_csv(..., sep='\t')` where a
          // typed table consumer wants the column names embedded in the
          // stream — embedding the schema means a downstream parser does
          // not have to keep a separate column-list constant in sync with
          // the cli's emit shape, which is the typical drift source.
          //
          // The header fires UNCONDITIONALLY when --header is set, even
          // when zero data rows pass the filters. The contract is "the
          // schema row is the contract, not the data rows" — a
          // downstream typed-table consumer parsing `clawmind stale --tsv
          // --header --since X` against a workspace that has nothing
          // older than X should still see the column names and produce a
          // valid empty table, not an empty stream that crashes the
          // parser. Mirrors the JSON-shape preservation precedent (empty
          // discovery yields {root, count: 0, files: []}, not an empty
          // stream).
          //
          // The four column names mirror the value-row layout exactly so
          // a refactor that adds a new column to the body would
          // surface as a column-count drift in tests (the header would
          // still emit 4 names while the body rows would emit 5 — pinned
          // in tests).
          if (opts.header) {
            process.stdout.write(`path\tageDays\tchunkCount\tsize\n`);
          }
          for (const it of out.items) {
            process.stdout.write(
              `${it.path}\t${it.ageDays}\t${it.chunkCount}\t${it.size}\n`,
            );
          }
          return;
        }
        if (out.total === 0) {
          process.stdout.write(kleur.gray(`no sources stale beyond ${out.thresholdDays}d\n`));
          return;
        }
        const shown = out.items.length;
        const header = `${out.total} stale (older than ${out.thresholdDays}d), showing ${shown}`;
        process.stdout.write(kleur.bold(header) + '\n');
        for (const it of out.items) {
          const age = kleur.yellow(`${it.ageDays}d`.padStart(5));
          const size = kleur.gray(fmtBytes(it.size).padStart(6));
          const chunks = kleur.gray(`${it.chunkCount}c`.padStart(5));
          process.stdout.write(`${age} ${size} ${chunks}  ${it.path}\n`);
        }
      });
    });
  return cmd;
}
