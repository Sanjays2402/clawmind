import { Command } from 'commander';
import kleur from 'kleur';
import { startWatcher } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';

export function watchCommand() {
  return new Command('watch')
    .description('Watch a directory and reindex on changes')
    .argument('[root]')
    .option('--json', 'emit one JSON event per line (NDJSON) instead of formatted text')
    .option('--debounce <ms>', 'coalesce rapid file events at the same path within this many milliseconds before re-ingesting (default 800). The watcher emits the `add`/`change`/`unlink` notification immediately so a downstream NDJSON consumer sees every event in real time, but only one re-ingest fires per path after the quiet window. Use a higher value (e.g. 3000) when running `npm install` or `git checkout` to ride out the burst of file events without N pointless re-ingests; a lower value (e.g. 100) for tightly-typed live editing when latency matters more than CPU. Non-positive or non-numeric values are rejected so a typo cannot silently disable the debounce.', (v) => Number.parseInt(v, 10))
    .option('-q, --quiet', 'suppress the per-file event lines (the gray `add /foo.md` / `change /bar.ts` chatter in text mode, and the per-event NDJSON documents in --json mode). The startup banner on stderr STILL fires so a log scraper detects restarts, and the operator-facing "Watching <root>" stdout line STILL prints so an interactive operator sees the watcher came up. The combination is the right shape for cron-restarted watchers where the journal only needs the restart marker, not 100/sec event chatter from a tight `npm install` burst — and pairs naturally with --debounce.')
    .action(async (root: string | undefined, opts: { json?: boolean; debounce?: number; quiet?: boolean }) => {
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
      //   - it fires UNCONDITIONALLY (text mode AND --json mode)
      //     because the use-case is "scrape the journal for restart
      //     markers" which has to work regardless of the stdout
      //     format the operator chose
      //   - it goes to stderr explicitly so it does not pollute the
      //     stdout NDJSON stream that --json mode emits (mixing the
      //     banner into stdout would force every --json consumer to
      //     special-case kind=banner; keeping it on stderr means
      //     existing consumers do not have to change)
      process.stderr.write(
        JSON.stringify({ kind: 'banner', root: target, ts: new Date().toISOString() }) + '\n',
      );
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
