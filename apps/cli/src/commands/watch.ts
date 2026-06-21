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
    .action(async (root: string | undefined, opts: { json?: boolean; debounce?: number }) => {
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
