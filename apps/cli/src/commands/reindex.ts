import { Command } from 'commander';
import { stat, unlink } from 'node:fs/promises';
import kleur from 'kleur';
import { discoverFiles } from '@clawmind/ingest';
import { manifestPath, bm25Dir, expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';
import { ingestCommand } from './ingest.js';

export function reindexCommand() {
  return new Command('reindex')
    .description('Drop the manifest and BM25, then re-ingest')
    .argument('[root]')
    .option('--json', 'emit the ingest report as JSON instead of formatted text')
    .option('--dry-run', 'show the files that WOULD be reindexed without dropping the manifest, the BM25 index, or re-running ingest. Useful as a "what is about to happen" preview before a destructive reindex on a production index. Honours the same discovery rules ingest uses (.clawmindignore + the built-in include/exclude globs) so the preview is byte-faithful to the real run. Pairs with --paths-only for `clawmind reindex --dry-run --paths-only | wc -l` to count without parsing the human report.')
    .option('--paths-only', 'with --dry-run: emit just the paths one per line, no header, no count summary. Mirrors the --paths-only contract used by search/forget/related/stale. Ignored without --dry-run (a non-dry reindex emits the live ingest report instead). Composes naturally for shell pipelines: `clawmind reindex --dry-run --paths-only > before.txt` lets an operator snapshot the file set before mutating the index, then diff it post-reindex.')
    .option('--since <iso-date>', 'mtime filter: only consider files modified at-or-after this ISO date. Composes with both --dry-run (preview the narrowed set without mutating) AND the destructive path (when set without --dry-run, the manifest+BM25 wipe still happens, then ingest is called with --since so only the recently-modified files are re-ingested — sources older than the cutoff stay missing from the rebuilt index until the next full reindex). The natural use is a partial-reindex flow: `clawmind reindex --since "$(date -u -d \'1 week ago\' +%FT%TZ)"` rebuilds the index from scratch but only walks the files that have actually changed recently. Parse failures abort with exit code 1 — a typo cannot silently degrade to a full reindex (which would defeat the purpose of the flag).')
    .option('--slim', 'with --dry-run --json: emit a slim `{count, since, dryRun}` shape carrying ONLY the file count, the --since anchor (or null when absent), and dryRun=true — instead of the full `{root, count, files: [...]}` payload with the per-path list. Mirrors `digest run --json --slim`, `feedback prune --json --slim`, `stats --json --slim`, `forget --json --slim`, and `doctor --json --quiet` byte-for-byte: single-line JSON, no per-file detail, only the integers a dashboard panel needs. The classic cron use is a partial-reindex dashboard polling `clawmind reindex --since <iso> --dry-run --json --slim` every minute to answer "how many files would the next refresh touch" without paying the per-file path list. On a workspace with thousands of files matching the cutoff, the full --json payload can be hundreds of kilobytes (each path is its own string); the slim shape is ~80 bytes regardless. Composes with --since: the slim count describes the SURVIVORS of the mtime filter. Without --since the slim payload still works (`since: null`) — useful for the canonical "how many files total" dashboard panel without the per-path noise. Ignored without --dry-run + --json (the live path emits the ingest report; --paths-only short-circuits before reaching here). Wins over the full --json payload when set with --dry-run + --json. The --paths-only flag still wins over --slim when both are set with --dry-run + --json + --paths-only + --slim because --paths-only is the pipeline contract and --slim is the dashboard contract — they answer different questions, and the pipeline-friendly shape is the more destructive precedent to break.')
    .action(async (root: string | undefined, opts: { json?: boolean; dryRun?: boolean; pathsOnly?: boolean; since?: string; slim?: boolean }) => {
      const rt = await buildRuntime();
      // --since <iso-date> validates up front so a typo (`--since
      // 2026-13-01`) aborts cleanly BEFORE we wipe the manifest.
      // This is the most safety-critical defence in the command:
      // the destructive path runs the wipe FIRST and then calls
      // ingest, so a parse-failure-after-wipe would leave the index
      // in a partial state that the operator can only recover from
      // by re-running the command without the flag (a full reindex
      // they were trying to avoid). Hard-fail before any mutation.
      let sinceCutoff: number | null = null;
      if (opts.since) {
        sinceCutoff = Date.parse(opts.since);
        if (!Number.isFinite(sinceCutoff)) {
          process.stderr.write(kleur.red(`reindex failed: --since value "${opts.since}" is not a valid ISO date\n`));
          process.exitCode = 1;
          return;
        }
      }
      // --dry-run is the "preview the destructive action" gate.
      // We DO NOT delete the manifest, DO NOT touch the BM25, and
      // DO NOT call ingestRoot. We just enumerate the discover
      // step the real ingest would walk, so the operator sees
      // exactly the set of files that would be re-ingested AFTER
      // a non-dry reindex wipes the manifest. (Without the dry
      // path, reindex unconditionally wipes the manifest BEFORE
      // ingest runs — a typo on a large index is destructive and
      // there is no way back.)
      //
      // When --since is also set, we narrow the preview by mtime
      // BEFORE emitting — the operator sees exactly the set the
      // live `reindex --since` would walk, not the unfiltered
      // discovery set. stat() failures on individual files are
      // silently dropped (they cannot be re-ingested anyway, so
      // surfacing the error would just noise the cron log).
      //
      // Three output shapes, decided in this order so the contract
      // is unambiguous:
      //   --paths-only -> one path per line, no header (xargs-safe)
      //   --json       -> {root, count, files: [...] }
      //   default text -> the count + every path, gray-prefixed,
      //                   plus a "rerun without --dry-run to apply"
      //                   nudge so the operator does not get stuck.
      if (opts.dryRun) {
        const target = root ? expand(root) : rt.workspace;
        const discovered = await discoverFiles(target);
        let files = discovered;
        if (sinceCutoff !== null) {
          const kept: string[] = [];
          await Promise.all(discovered.map(async (p) => {
            try {
              const s = await stat(p);
              if (s.mtimeMs >= sinceCutoff!) kept.push(p);
            } catch {
              // stat() failed — skip the file silently. It cannot
              // be re-ingested in this run anyway.
            }
          }));
          files = kept;
        }
        if (opts.pathsOnly) {
          for (const p of files) process.stdout.write(`${p}\n`);
          return;
        }
        if (opts.json) {
          // --slim wins over the full --json payload when set. The
          // slim shape is `{count, since, dryRun}` — only the
          // integers a dashboard panel needs, no per-file path
          // list. Mirrors `digest run --json --slim`, `feedback
          // prune --json --slim`, `stats --json --slim`, `forget
          // --json --slim`, and `doctor --json --quiet` byte-for-
          // byte: single-line JSON, no per-entry detail.
          //
          // Why this shape (not {root, count}):
          //   - the natural cron poll is "how many files would
          //     the next refresh touch" — count is the only integer
          //     a dashboard needs to branch on
          //   - `since` echoes the cutoff (or null when absent) so
          //     a multi-cutoff dashboard polling several scopes can
          //     identify which row it's reading without correlating
          //     against the cron's own state
          //   - `dryRun: true` is the explicit safety contract: this
          //     payload describes a PREVIEW, not a real ingest;
          //     mirrors `forget --json --slim`'s explicit dryRun key
          //   - `root` is intentionally dropped: a dashboard polling
          //     a single workspace already knows the root from cron
          //     config, and a dashboard polling multiple workspaces
          //     can identify them via cron labels rather than carry
          //     the path through the JSON payload (~80 byte savings
          //     per snapshot, meaningful at NDJSON-append scale)
          //
          // The single-line JSON.stringify (no indent) is the
          // family-wide cron-snapshot contract so an NDJSON stream
          //   while true; do clawmind reindex --since X --dry-run --json --slim; sleep 60; done
          // diffs cleanly between ticks without indentation churn.
          if (opts.slim) {
            process.stdout.write(JSON.stringify({
              count: files.length,
              since: opts.since ?? null,
              dryRun: true,
            }) + '\n');
            return;
          }
          process.stdout.write(
            JSON.stringify({ root: target, count: files.length, files }, null, 2) + '\n',
          );
          return;
        }
        process.stdout.write(
          kleur.yellow(`would reindex ${files.length} file(s) under ${target}\n`),
        );
        for (const p of files) process.stdout.write(kleur.gray(`  ${p}\n`));
        if (files.length > 0) {
          process.stdout.write(kleur.bold('\nrerun without --dry-run to actually reindex these.\n'));
        }
        return;
      }
      // Live path. Wipe the manifest + BM25, then defer to the
      // ingest command. When --since is set we forward it so the
      // live re-ingest narrows to recently-modified files — the
      // operator gets a partial-reindex flow without having to
      // wire up the same composition manually.
      //
      // Note: we already validated --since above, so threading it
      // through here cannot crash mid-wipe.
      await Promise.allSettled([
        unlink(manifestPath(rt.env)),
        unlink(`${bm25Dir(rt.env)}/bm25.json`),
      ]);
      const args = [
        'node', 'clawmind',
        ...(root ? [root] : []),
        ...(opts.json ? ['--json'] : []),
        ...(opts.since ? ['--since', opts.since] : []),
      ];
      await ingestCommand().parseAsync(args);
    });
}
