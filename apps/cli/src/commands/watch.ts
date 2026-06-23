import { Command } from 'commander';
import { stat } from 'node:fs/promises';
import kleur from 'kleur';
import { startWatcher, discoverFiles, ingestPaths } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';

export function watchCommand() {
  return new Command('watch')
    .description('Watch a directory and reindex on changes')
    .argument('[root]')
    .option('--json', 'emit one JSON event per line (NDJSON) instead of formatted text')
    .option('--debounce <ms>', 'coalesce rapid file events at the same path within this many milliseconds before re-ingesting (default 800). The watcher emits the `add`/`change`/`unlink` notification immediately so a downstream NDJSON consumer sees every event in real time, but only one re-ingest fires per path after the quiet window. Use a higher value (e.g. 3000) when running `npm install` or `git checkout` to ride out the burst of file events without N pointless re-ingests; a lower value (e.g. 100) for tightly-typed live editing when latency matters more than CPU. Non-positive or non-numeric values are rejected so a typo cannot silently disable the debounce.', (v) => Number.parseInt(v, 10))
    .option('-q, --quiet', 'suppress the per-file event lines (the gray `add /foo.md` / `change /bar.ts` chatter in text mode, and the per-event NDJSON documents in --json mode). The startup banner on stderr STILL fires so a log scraper detects restarts, and the operator-facing "Watching <root>" stdout line STILL prints so an interactive operator sees the watcher came up. The combination is the right shape for cron-restarted watchers where the journal only needs the restart marker, not 100/sec event chatter from a tight `npm install` burst — and pairs naturally with --debounce.')
    .option('--once', 'run a single initial scan + ingest pass under the SAME discovery rules the live watcher uses (.clawmindignore + the built-in include/exclude globs), then exit cleanly with the regular ingest report shape. This lets cron use ONE code path for both scheduled refreshes and live watching — `clawmind watch --once` is the watcher\'s "initial scan" without the long-running tail. Composes with --json (NDJSON ingest report instead of text) and emits the same startup banner on stderr so a log scraper sees the restart marker even on a one-shot pass. Does NOT install the chokidar watcher; the process returns to the shell as soon as the initial ingest finishes. Exit code reflects the ingest outcome (0 on success, non-zero on a thrown error in the pipeline).')
    .option('--since <iso-date>', 'with --once: only ingest files whose filesystem mtime is at-or-after this ISO date. Pairs the new --once mode with the `ingest --since` semantics so a cron tick can ride out a quiet workspace without re-walking every file. The canonical cron flow:\n  clawmind watch --once --since "$(date -u -d \'1 hour ago\' +%FT%TZ)"\nThe filter applies AFTER discoverFiles() (same .clawmindignore + include/exclude globs still walked) but BEFORE the per-file ingest decision, so the operator pays exactly one stat() per discovered file. Cutoff is INCLUSIVE (>=) — a file modified exactly at the cutoff was "modified at the cutoff", which is the boundary an operator passing the previous tick\'s wall-clock cares about. Parse failures abort cleanly with exit 1 — a typo cannot silently degrade to "no filter" (which would re-ingest the entire workspace, the worst possible failure mode for a flag whose purpose is to do LESS work). Ignored WITHOUT --once (the live watcher has no use for an mtime cutoff — chokidar already only fires on actual file events, so --since on the live path would be a confusing no-op). stat() failures on individual files are non-fatal (matches `ingest --since`).')
    .option('--paths-only', 'with --once: pure preview — emit the deduplicated list of files that WOULD be ingested (one path per line, no styling, no header) WITHOUT touching the lance/bm25/manifest. Mirrors `ingest --dry-run --paths-only` and `reindex --dry-run --paths-only` byte-for-byte (same xargs-safe contract) but lives on the `watch` command surface so the cron muscle memory carries: `watch --once --since X --paths-only` is the natural \"what would this scheduled refresh tick touch?\" probe. Composes naturally with --since: the preview list is exactly the post-cutoff survivors. Skips ingestPaths() entirely (the file scan happens, the mtime filter applies, but nothing is read/hashed/embedded/upserted). Empty discovery (or every file pre-dating the cutoff) yields a clean empty stream — `wc -l` sees exactly 0, no header, no \"nothing to do\" hint that would poison `xargs ls`. Wins over --json (a downstream `xargs` consumer wants path-per-line, NOT a JSON document with a paths array) — matches the precedent set by forget/search/related --paths-only short-circuiting over --json. Ignored without --once (no live-watch preview semantics; the live watcher emits per-event NDJSON which is the preview shape for that surface).')
    .option('--preview-json', 'with --once: pure preview — emit a structured `{root, count, files:[...]}` JSON wrapper of the files that WOULD be ingested WITHOUT touching the lance/bm25/manifest. The dashboard-friendly twin of --paths-only: where --paths-only short-circuits --json for xargs callers, --preview-json is the explicit "give me the JSON wrapper" path for dashboard / web-UI callers who want the structured count + root context alongside the file list. Same byte layout as `ingest --dry-run --json` and `reindex --dry-run --json` so a multi-command dashboard can use one parser across all three preview surfaces. Composes naturally with --since: the files array is exactly the post-cutoff survivors. Skips ingestPaths() entirely (the file scan happens, the mtime filter applies, but nothing is read/hashed/embedded/upserted). Empty discovery yields `{root, count: 0, files: []}` (NOT an empty stream — the JSON shape is preserved so a `jq .count` consumer always gets an integer). --paths-only wins over --preview-json when both are passed (xargs callers should still get the path-per-line stream; --preview-json is the opt-in for the JSON consumer). Ignored without --once (no live-watch preview semantics).')
    .option('--slim', 'with --once --preview-json: emit a slimmed `{count, since}` 2-key shape that drops the `root` and `files[]` array entirely. The classic cron use is `clawmind watch --once --since <iso> --preview-json --slim` polled every minute as a "is the watcher seeing anything" probe without paying the per-file path list. On a workspace with thousands of files matching the cutoff, the full --preview-json payload can be hundreds of kilobytes (every path is its own string); the slim shape is ~40 bytes regardless. Mirrors `ingest --dry-run --json --slim`, `reindex --dry-run --json --slim`, `digest run --json --slim`, `compact --json --slim`, and the family-wide cron-dashboard slim contract byte-for-byte: single-line JSON, no per-row detail, only the integers a dashboard panel needs. `count` is the integer the dashboard branches on (`count > 0` = "the next scheduled refresh will touch something"); `since` echoes the cutoff (or null when absent) so a multi-cutoff dashboard polling several scopes can identify which row it is reading without out-of-band tracking. `root` is intentionally dropped (a dashboard polling a single workspace already knows the root from cron config) and `files[]` is the whole point of the slim shape (we are dropping it). Composes naturally with --since (slim count describes the post-cutoff survivors). Ignored without --once + --preview-json. --paths-only still wins over --slim when both are set with --once + --paths-only + --preview-json + --slim (the pipeline-friendly path-per-line stream is the older, simpler contract for xargs callers — same precedent as --paths-only winning over --preview-json without --slim).')
    .option('--only-add', 'live-watch event-kind filter: emit ONLY `add` events on stdout, suppressing `change` and `unlink` entirely. Port of the `digest show --paths-only --diff --only-added/--only-removed` pattern to the live watch event stream — applies to BOTH text mode (the gray `add /foo.md` lines) AND --json mode (the per-event NDJSON documents). The natural cron use is a tight "ingest the new files only" downstream pipe that does not want `change` / `unlink` chatter: `clawmind watch --json --only-add | jq -r .path | xargs clawmind ingest`. Composes with --only-change / --only-unlink as a flag triplet. "All = none" semantic: when ALL THREE flags are set together (or NONE are set), every event kind emits — the natural reading of "give me adds AND changes AND unlinks" is "give me every kind", so the triple-on shape collapses back to the bare-watch behaviour. Composes with -q / --quiet (--quiet suppresses everything; the --only-* filters narrow what would have been emitted before --quiet decides). Composes with --debounce (the debounce shapes the cadence; --only-* shapes the kinds). Ignored on the --once path (the one-shot ingest report is a different shape that does not carry per-event chatter). The filter is applied INSIDE the onEvent callback (after the watcher decided to fire) so the underlying ingest still happens for every event — only the operator-facing stdout stream is narrowed. This means the index stays consistent (a forgotten `unlink` would not silently leave a stale entry in BM25); the filter shapes what the cron pipeline sees, not what the index does.')
    .option('--only-change', 'live-watch event-kind filter: emit ONLY `change` events on stdout. Mirror of --only-add byte-for-byte (see --only-add for full semantics). Useful for the "re-embed the just-modified files" downstream pipe that does not want `add` / `unlink` noise.')
    .option('--only-unlink', 'live-watch event-kind filter: emit ONLY `unlink` events on stdout. Mirror of --only-add byte-for-byte (see --only-add for full semantics). Useful for the "forget the just-deleted files" downstream pipe paired with `xargs clawmind forget --apply`. When ALL THREE --only-* flags are set together (or NONE are set), every event kind emits — the natural "give me adds AND changes AND unlinks = give me every kind" reading.')
    .action(async (root: string | undefined, opts: { json?: boolean; debounce?: number; quiet?: boolean; once?: boolean; since?: string; pathsOnly?: boolean; previewJson?: boolean; slim?: boolean; onlyAdd?: boolean; onlyChange?: boolean; onlyUnlink?: boolean }) => {
      // --debounce forwards directly to the watcher's `debounceMs`
      // wiring (which already exists in WatcherOptions; this just
      // exposes it on the cli). Reject zero / negative / NaN values
      // up front rather than letting them silently disable the
      // debounce — a value of 0 would re-ingest on every chokidar
      // event, which during a `git checkout` or `npm install` would
      // melt CPU. The error path matches the cli's standard styled
      // stderr + exitCode=1 shape.
      if (opts.debounce !== undefined && (!Number.isFinite(opts.debounce) || opts.debounce <= 0)) {
        process.stderr.write(kleur.red(`watch failed: --debounce value must be a positive integer (got "${opts.debounce}")\n`));
        process.exitCode = 1;
        return;
      }
      // --since is meaningful ONLY on the --once path (the live
      // watcher relies on chokidar to fire on actual file events,
      // so an mtime cutoff would be a confusing no-op there). We
      // validate the cutoff up front and BEFORE the runtime build
      // — same precedent as `reindex --since` and `ingest --since`
      // — so a typo (`--since 2026-13-01`) aborts cleanly without
      // wasting the runtime warmup. The cutoff is only consumed
      // inside the --once branch below.
      let sinceCutoff: number | null = null;
      if (opts.since) {
        sinceCutoff = Date.parse(opts.since);
        if (!Number.isFinite(sinceCutoff)) {
          process.stderr.write(kleur.red(`watch failed: --since value "${opts.since}" is not a valid ISO date\n`));
          process.exitCode = 1;
          return;
        }
      }
      const rt = await buildRuntime();
      const target = root ? expand(root) : rt.workspace;
      // A one-line startup banner to stderr — separate from the
      // operator-facing "Watching <root>" stdout line — so a log
      // scraper consuming stdout (and discarding it because the live
      // events are noisy) can still detect a process restart by
      // tailing stderr alone. Crucial properties:
      //   - the banner is NDJSON shape with kind=banner so an
      //     stderr-tailing parser sees the same event-stream shape
      //     it sees on stdout for the per-file events; a script
      //     watching for restarts can just `grep '"kind":"banner"'`
      //   - it carries the resolved root and ISO ts so a log
      //     correlator knows which watcher restarted and when
      //   - it fires UNCONDITIONALLY (text mode AND --json mode AND
      //     --once mode) because the use-case is "scrape the journal
      //     for restart markers" which has to work regardless of the
      //     stdout format the operator chose
      //   - it goes to stderr explicitly so it does not pollute the
      //     stdout NDJSON stream that --json mode emits (mixing the
      //     banner into stdout would force every --json consumer to
      //     special-case kind=banner; keeping it on stderr means
      //     existing consumers do not have to change)
      process.stderr.write(
        JSON.stringify({ kind: 'banner', root: target, ts: new Date().toISOString() }) + '\n',
      );
      // --once: single initial scan + ingest pass, then exit cleanly.
      // The whole point is to let cron use ONE code path for both
      // scheduled refreshes AND live watching (`clawmind watch --once`
      // == "scheduled scan"; `clawmind watch` == "scheduled scan +
      // chokidar tail"). We honour the SAME discovery rules the
      // chokidar watcher uses (.clawmindignore + the built-in
      // include/exclude globs flowing through discoverFiles()) so the
      // one-shot pass and the live first-scan are byte-faithful.
      //
      // We deliberately fire BEFORE the "Watching <root>" line and
      // chokidar startup — there is no long-running process to mark
      // as "Watching" on a one-shot pass; that line would be
      // misleading. The startup banner ABOVE still fires so a log
      // scraper sees the restart marker either way.
      //
      // Composes with --json to emit the NDJSON ingest report shape
      // (matches `ingest --json`) instead of the human-readable text
      // form. Pipeline errors set a non-zero exit code via the
      // standard `process.exitCode` channel — does NOT throw so the
      // command finishes cleanly in cron.
      //
      // --debounce / --quiet are no-ops in this mode: there is no
      // chokidar tail to debounce and no per-file event stream to
      // quiet. We accept the flags silently rather than rejecting
      // them so the cron operator can use a single argv shape
      // ("watch --once --quiet --debounce 500") for both modes
      // without conditional plumbing.
      if (opts.once) {
        const discovered = await discoverFiles(target);
        // --since (when set) is the same mtime filter `ingest --since`
        // applies: keep only files whose mtime is at-or-after the
        // cutoff. We've already validated the parse above, so the
        // cutoff is either null (no filter) or a finite epoch ms
        // value. Per-file stat() failures are non-fatal — the file
        // is silently dropped (it cannot be re-ingested anyway, and
        // surfacing the error would spam the cron log on a file the
        // pipeline would have skipped at load() time). This matches
        // `ingest --since` byte-for-byte.
        let files = discovered;
        if (sinceCutoff !== null) {
          const kept: string[] = [];
          await Promise.all(discovered.map(async (p) => {
            try {
              const s = await stat(p);
              if (s.mtimeMs >= sinceCutoff!) kept.push(p);
            } catch {
              // stat() failed — silently drop. Same precedent as ingest.
            }
          }));
          files = kept;
        }
        // --paths-only: pure preview. Emit the deduplicated path
        // list (one path per line, no header, no styling) and
        // SHORT-CIRCUIT before ingestPaths() so nothing is read,
        // hashed, embedded, or upserted. Mirrors `ingest --dry-run
        // --paths-only` and `reindex --dry-run --paths-only`
        // byte-for-byte. Critical design properties:
        //   - dedupe via Set: discoverFiles() in production returns
        //     a flat path list, but pinning the dedupe contract via
        //     a Set means a future change cannot silently leak
        //     duplicates into an xargs consumer
        //   - file order preserved (Set iteration is insertion-order
        //     in V8) so the operator can correlate the preview with
        //     the actual ingest by re-running without --paths-only
        //   - empty discovery / every-file-pre-dating-cutoff yields
        //     a clean empty stream (no header, no "nothing to do"
        //     hint that would poison `wc -l` / `xargs ls`)
        //   - wins over --json (a downstream `xargs` consumer wants
        //     path-per-line, NOT a JSON document with a paths array)
        //     — matches the precedent set by forget/search/related
        //     --paths-only short-circuiting over --json
        //   - returns BEFORE ingestPaths() so the lance/bm25/manifest
        //     are not touched; the metric counters do not increment
        //     because no work was done (the cron operator running a
        //     preview wants the "I did nothing" signal to be honest)
        if (opts.pathsOnly) {
          const seen = new Set<string>();
          const deduped: string[] = [];
          for (const p of files) {
            if (!seen.has(p)) {
              seen.add(p);
              deduped.push(p);
            }
          }
          for (const p of deduped) process.stdout.write(p + '\n');
          return;
        }
        // --preview-json: structured JSON wrapper of the same preview
        // set. Where --paths-only short-circuits for xargs callers,
        // --preview-json is the explicit "I want the JSON shape" path
        // for dashboard / web-UI callers. Critical design properties:
        //   - same `{root, count, files}` shape as `ingest --dry-run
        //     --json` and `reindex --dry-run --json` so a multi-command
        //     dashboard uses ONE parser across all three preview
        //     surfaces (the muscle memory is the value; if we shipped
        //     a different shape here we'd force every consumer to
        //     special-case the watch surface)
        //   - dedupe via Set (insertion order preserved) so the
        //     files[] array is byte-faithful to what the corresponding
        //     --paths-only stream would emit — same survivor set,
        //     same order, just wrapped in a JSON envelope
        //   - empty discovery yields {root, count: 0, files: []} (NOT
        //     an empty stream — the JSON shape must be parseable even
        //     when nothing survived the filter, so `jq .count` always
        //     gets an integer; a downstream "is the workspace warm?"
        //     probe should never have to special-case the empty case)
        //   - skips ingestPaths() entirely (same as --paths-only): the
        //     lance/bm25/manifest stay untouched, the metric counters
        //     do not increment, the cron operator's "I previewed
        //     nothing" signal is honest
        //   - --paths-only WINS when both are passed (xargs callers
        //     should still get the path-per-line stream; --preview-json
        //     is the opt-in for the JSON consumer) — pinned in tests
        //     by an explicit `--paths-only --preview-json` case
        //   - returns BEFORE the regular ingestPaths()/--json branch
        //     so the preview never accidentally touches the index
        if (opts.previewJson) {
          const seen = new Set<string>();
          const deduped: string[] = [];
          for (const p of files) {
            if (!seen.has(p)) {
              seen.add(p);
              deduped.push(p);
            }
          }
          // --slim emits a `{count, since}` 2-key shape that drops
          // `root` AND `files[]` entirely. Mirrors the family-wide
          // cron-dashboard slim contract (`ingest --dry-run --json
          // --slim`, `reindex --dry-run --json --slim`, `digest run
          // --json --slim`, `compact --json --slim`, etc.) byte-
          // for-byte: single-line JSON, no per-row detail, only the
          // integers + identifiers a dashboard panel needs.
          //
          // Why this 2-key shape:
          //   - `count` is the integer the dashboard branches on:
          //     `count > 0` = "the next scheduled refresh will
          //     touch something". The headline cron-poll answer.
          //   - `since` echoes the cutoff (or null when absent) so
          //     a multi-cutoff dashboard polling several time-
          //     windows can identify which row it is reading
          //     without out-of-band tracking; mirrors the family-
          //     wide cron-dashboard `--since` echo contract.
          //   - `root` is intentionally dropped: a dashboard
          //     polling a single workspace already knows the root
          //     from cron config; a multi-workspace dashboard can
          //     identify them via cron labels rather than carry
          //     the path through the JSON payload (~80 byte
          //     saving per snapshot, meaningful at NDJSON-append
          //     scale)
          //   - `files[]` is the whole point of the slim shape
          //     (we are dropping it); on a workspace with
          //     thousands of files matching the cutoff, the array
          //     is the bulk of the payload, and a dashboard
          //     counting `count > N` does not need the per-path
          //     detail (the operator can re-run with --preview-
          //     json alone to see the full list if a panel turns
          //     red and needs investigation)
          //
          // The single-line JSON.stringify (no indent) keeps the
          // NDJSON snapshot diff clean across cron ticks.
          if (opts.slim) {
            process.stdout.write(JSON.stringify({
              count: deduped.length,
              since: opts.since ?? null,
            }) + '\n');
            return;
          }
          process.stdout.write(
            JSON.stringify({ root: target, count: deduped.length, files: deduped }) + '\n',
          );
          return;
        }
        const report = await ingestPaths(files, {
          store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
          manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
        });
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({
              root: target,
              processed: report.processed,
              chunks: report.chunks,
              skipped: report.skipped,
            }) + '\n',
          );
        } else {
          process.stdout.write(kleur.cyan(`one-shot scan of ${target}\n`));
          process.stdout.write(
            kleur.green(`Indexed ${report.processed} files, ${report.chunks} chunks, skipped ${report.skipped}\n`),
          );
        }
        return;
      }
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ kind: 'watching', root: target, ts: new Date().toISOString() }) + '\n',
        );
      } else {
        process.stdout.write(kleur.cyan(`Watching ${target}\n`));
      }
      startWatcher({
        root: target,
        debounceMs: opts.debounce,
        store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
        manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
        onEvent: (k, p) => {
          // --quiet / -q suppresses the per-file event chatter. The
          // watcher still does the work (debounce, ingest, store
          // updates) — we just drop the cosmetic notification line.
          // Critically the startup banner above STILL fired and the
          // "Watching <root>" stdout line ALSO printed, so:
          //   - a log scraper sees the restart marker
          //   - an interactive operator knows the watcher came up
          // What gets dropped is exactly the "add /foo.md" /
          // "change /bar.ts" stream that fills the terminal during a
          // tight `npm install` burst. In --json mode the per-event
          // NDJSON documents are dropped too — the operator who asks
          // for --quiet --json wants the banner-on-stderr signal and
          // nothing else on stdout. The contract is "no chatter,
          // restart marker stays" which matches how cron tools like
          // logrotate, journalctl --since=last-restart, etc. expect
          // their restart-aware peers to behave.
          if (opts.quiet) return;
          // --only-add / --only-change / --only-unlink: live-watch
          // event-kind filter triplet. Port of the digest --only-added
          // / --only-removed pattern to the live watch event stream.
          // Applies to BOTH text mode AND --json mode (the filter is
          // upstream of the format choice).
          //
          // "All = none" semantic: when ALL THREE flags are set
          // together (or NONE are set), every event kind emits — the
          // natural reading of "give me adds AND changes AND unlinks
          // = give me every kind" is "emit everything". This mirrors
          // the digest --only-added + --only-removed "both = none"
          // contract byte-for-byte (the operator who explicitly opts
          // into every kind has asked for the unfiltered stream).
          //
          // Computed inline so a single boolean per-event drives the
          // emit decision. No early-return when the filter is silent
          // — we still need to fall through to the emit branches.
          //
          // Composes with --debounce naturally: the debounce shapes
          // the cadence (which events fire); --only-* shapes the
          // kinds (which fired events reach stdout). The underlying
          // ingest happens for EVERY event the watcher decided to
          // fire — the filter shapes what the cron pipeline sees,
          // not what the index does. This matters: filtering ingest
          // by kind would silently leave stale entries in BM25 on
          // a forgotten `unlink`. The split keeps the index
          // consistent while still narrowing the operator stream.
          const anyOnly = opts.onlyAdd || opts.onlyChange || opts.onlyUnlink;
          const allOnly = opts.onlyAdd && opts.onlyChange && opts.onlyUnlink;
          if (anyOnly && !allOnly) {
            if (k === 'add' && !opts.onlyAdd) return;
            if (k === 'change' && !opts.onlyChange) return;
            if (k === 'unlink' && !opts.onlyUnlink) return;
          }
          if (opts.json) {
            process.stdout.write(
              JSON.stringify({ kind: k, path: p, ts: new Date().toISOString() }) + '\n',
            );
          } else {
            process.stdout.write(kleur.gray(`${k} ${p}\n`));
          }
        },
      });
      await new Promise(() => undefined);
    });
}
