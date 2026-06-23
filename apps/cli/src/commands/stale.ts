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
    .option('--reverse', 'flip the --sort direction. With --sort age the default is oldest-first (desc); --reverse gives "youngest stale first" — the natural "what just crossed the threshold" question, complementary to the "oldest first" default. With --sort path the default is asc alphabetical; --reverse gives desc alphabetical — useful for `tail -f`-style log scrapes where the FIRST change is the operator\'s focus and lives at the bottom. With --sort size the default is biggest-first (desc); --reverse gives smallest-first (asc) — useful when the cleanup budget can afford to skip the big files and you want to bulk-clear the small ones. Ignored without --sort (the default API ordering is a fixed contract, not a sort-direction choice). Composes byte-identically with every output mode (--json / --tsv / --paths / --paths-only / text). The secondary tie-break by original index is ALSO reversed so cross-snapshot determinism is preserved in either direction (two consecutive `--sort path --reverse` runs over identical-ties input produce byte-identical output). Establishes the family-wide reverse-modifier shape for the rest of the --sort-bearing commands to mirror.')
    .option('--top <n>', 'cap survivors of -q / --since / --days / --sort / --reverse at this many rows. Applied LAST (after every narrowing filter AND after every ordering) so the cap is "the top N rows the operator asked for, in their chosen order". The canonical cron-budget use is `clawmind stale --sort size --top 10 --paths | xargs forget --apply` — "the 10 biggest stale files, in size-priority order, ready for a tight cleanup budget". Mirrors `stats --top`, `feedback list --top`, `tags list --top`, `digest list --last`, `search --top` family contract byte-for-byte: clamped to a sensible positive integer; non-positive or NaN values fall back to "no cap" (the full list) rather than the surprising "empty table" that `--top 0` would otherwise produce — a typo cannot silently break the report. The `total` field in --json mode reflects the POST-cap survivor count so a downstream `jq .total` consumer always matches `items.length`. Composes with --json / --tsv / --paths / --paths-only / text — the cap is applied uniformly across every output mode.', (v) => Number.parseInt(v, 10))
    .option('--tsv', 'emit tab-separated rows (path<TAB>ageDays<TAB>chunkCount<TAB>size) suitable for awk/cut')
    .option('--header', 'with --tsv: prepend a single tab-separated header row (`path\\tageDays\\tchunkCount\\tsize`) so the stream is friendly to `column -ts$\\\'\\\\t\\\'` / pandas.read_csv / spreadsheet imports without a separate echo. The default header-less shape is preserved when --header is absent so the long-standing awk-pipeline contract (`awk -F$\\\'\\\\t\\\' \\\'{print $1}\\\'`) still works byte-for-byte. Ignored without --tsv (the JSON / --paths / --paths-only / text modes already have their own well-defined shapes; adding a header line to those would break tests pinned to their exact byte layouts). When zero rows pass the filters AND --header is set, the header row STILL fires so a downstream consumer parsing the stream into a typed table never has to special-case an empty body — the schema row is the contract, not the data rows.')
    .option('--json', 'emit results as JSON for scripting')
    .option('--slim', 'with --json: emit a slim `{count, thresholdDays, since}` shape carrying ONLY the survivor count, the days threshold, and the --since cutoff (or null when absent) — instead of the full {thresholdDays, total, items: [...]} payload with per-row ageDays/chunkCount/size blocks. Mirrors `digest run --json --slim`, `feedback prune --json --slim`, `stats --json --slim`, `forget --json --slim`, `reindex --dry-run --json --slim`, and `doctor --json --quiet` byte-for-byte: single-line JSON, no per-entry detail. The canonical cron poll is a stale-budget dashboard panel polling `clawmind stale --days 30 --json --slim` once a minute to answer "how many files are stale right now" without paying the per-row detail cost. On a workspace with thousands of stale files, the full --json payload can be hundreds of kilobytes; the slim shape is ~70 bytes regardless. Composes with -q / --since / --days: the slim count describes the SURVIVORS of every narrowing filter (the same set the full --json mode would emit). Composes with --sort / --reverse: the slim count is order-invariant by definition (one integer cannot carry order). Ignored without --json. Wins over the full --json payload when set. Precedence note: in stale (unlike search/reindex/ingest), the --json branch fires BEFORE the --paths / --paths-only / --tsv pipeline branches, so when --json --slim --paths are all set, the slim shape wins. This is the long-standing stale precedence and preserves back-compat with the existing `--json --paths` test pin.')
    .action(async (opts: { days: string; limit: string; paths?: boolean; pathsOnly?: boolean; tsv?: boolean; header?: boolean; q?: string; since?: string; sort?: string; reverse?: boolean; top?: number; json?: boolean; slim?: boolean }) => {
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
          // --reverse flips the per-key direction. The natural cron
          // questions in each reverse case:
          //   --sort age --reverse   -> youngest stale first ("what
          //                             just crossed the threshold")
          //   --sort path --reverse  -> desc alphabetical ("the
          //                             last name in the report")
          //   --sort size --reverse  -> smallest first ("bulk-clear
          //                             the small files when the
          //                             budget can afford to skip
          //                             the big ones")
          //
          // Critical determinism property: the secondary tie-break
          // by original index is ALSO reversed under --reverse so a
          // two-snapshot diff over identical-ties input is byte-
          // stable in either direction. Without the index reverse,
          // ties would silently flip on every other run because
          // the primary comparator returned 0 and the secondary
          // would keep ascending while the visible ordering of
          // every other row was descending — a snapshot consumer
          // would see two adjacent rows with the same metric in
          // a different order across runs and have no way to tell
          // whether the underlying data changed.
          const dir = opts.reverse ? -1 : 1;
          const ranked = out.items
            .map((it, idx) => ({ it, idx }))
            .sort((a, b) => {
              let cmp = 0;
              if (sortKey === 'age') cmp = b.it.ageDays - a.it.ageDays;
              else if (sortKey === 'path') cmp = a.it.path.localeCompare(b.it.path);
              else if (sortKey === 'size') cmp = b.it.size - a.it.size;
              if (cmp !== 0) return cmp * dir;
              return (a.idx - b.idx) * dir;
            })
            .map((r) => r.it);
          out = { ...out, items: ranked };
        }
        // --top caps the survivors AFTER every narrowing filter AND
        // every ordering. Applied last so the cap is "the top N rows
        // the operator asked for, in their chosen order".
        //
        // Clamping matches `stats --top` / `feedback list --top` /
        // `tags list --top`: a non-positive or NaN value falls back
        // to "no cap" (the full list) rather than the surprising
        // empty table that `--top 0` would otherwise produce. A
        // typo cannot silently break the report.
        //
        // We RECOMPUTE total from the post-cap items.length so a
        // downstream `jq .total` consumer always matches the visible
        // row count — mirrors how the prior -q / --since filters
        // recompute total.
        //
        // The cap applies uniformly across every output mode (--json,
        // --tsv, --paths, --paths-only, text) — pinned by tests.
        if (opts.top !== undefined && Number.isFinite(opts.top) && opts.top > 0) {
          const items = out.items.slice(0, opts.top);
          out = { ...out, items, total: items.length };
        }
        if (opts.json) {
          // --slim wins over the full --json payload when set. The
          // slim shape is `{count, thresholdDays, since}` — only
          // the integers a dashboard panel needs, no per-row
          // ageDays/chunkCount/size blocks. Mirrors `digest run
          // --json --slim`, `feedback prune --json --slim`,
          // `stats --json --slim`, `forget --json --slim`,
          // `reindex --dry-run --json --slim`, and `doctor --json
          // --quiet` byte-for-byte: single-line JSON, no per-
          // entry detail.
          //
          // The canonical cron poll is a stale-budget dashboard
          // panel:
          //   clawmind stale --days 30 --json --slim
          // answers "how many files are stale right now" with a
          // single-line ~70-byte JSON payload. On a workspace
          // with thousands of stale files, the full --json payload
          // can be hundreds of kilobytes (each row carries path +
          // ageDays + chunkCount + size); the slim shape is
          // size-invariant.
          //
          // Why this shape (not {total, thresholdDays}):
          //   - `count` is the family-wide spelling (mirrors
          //     `forget --json --slim`, `feedback list --json
          //     --slim`, `aliases list --json --slim`, etc.).
          //     `total` is the full --json mode's spelling so we
          //     deliberately use a different name to make it
          //     clear the slim shape is a different schema —
          //     a downstream `jq .total` against the slim shape
          //     would return null and fail loudly rather than
          //     silently produce wrong numbers
          //   - `thresholdDays` is preserved verbatim because
          //     it's the input parameter the operator chose;
          //     echoing it back lets a multi-threshold dashboard
          //     identify which row it's reading
          //   - `since` echoes the --since cutoff (or null when
          //     absent) so a multi-cutoff dashboard polling
          //     several scopes can identify which row it's
          //     reading without cross-referencing cron state.
          //     Mirrors `reindex --dry-run --json --slim`,
          //     `ingest --dry-run --json --slim` byte-for-byte
          //   - `items` is intentionally dropped — that's the
          //     entire payload bloat the slim shape exists to
          //     avoid (each path is its own string + three
          //     numbers, so a workspace with 1000 stale files
          //     is ~70KB of full --json vs ~70 bytes of slim)
          //
          // Single-line JSON.stringify (no indent) so an NDJSON
          // snapshot stream like
          //   while true; do clawmind stale --json --slim; sleep 60; done
          // diffs cleanly across cron ticks.
          //
          // Composes with -q / --since / --days: the slim count
          // describes the SURVIVORS of every narrowing filter
          // (the same set the full --json mode would emit, since
          // we walk the post-filter `out.items.length`).
          // Composes with --sort / --reverse trivially: one
          // integer cannot carry order.
          if (opts.slim) {
            process.stdout.write(JSON.stringify({
              count: out.items.length,
              thresholdDays: out.thresholdDays,
              since: opts.since ?? null,
            }) + '\n');
            return;
          }
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
