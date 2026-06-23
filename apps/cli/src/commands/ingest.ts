import { Command } from 'commander';
import { stat } from 'node:fs/promises';
import ora from 'ora';
import kleur from 'kleur';
import { discoverFiles, ingestPaths, ingestRoot } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { buildRuntime } from '../runtime.js';

export function ingestCommand() {
  return new Command('ingest')
    .description('Index a directory tree into ClawMind')
    .argument('[root]', 'directory to index (defaults to your workspace)')
    .option('--json', 'emit the ingest report as JSON instead of formatted text')
    .option('--since <iso-date>', 'only ingest files whose filesystem mtime is at-or-after this ISO date. The natural cron use is `clawmind ingest --since "$(date -u -d "1 hour ago" +%FT%TZ)"` to do an incremental refresh from cron without re-walking every file. Filtering happens AFTER the discovery walk (same .clawmindignore + include/exclude globs apply) but BEFORE the per-file ingest decision, so the operator pays exactly one stat() per discovered file and the per-file hash/manifest dedupe path still kicks in for anything that did get touched but did not actually change. Parse failures abort cleanly with a non-zero exit code so a typo like --since 2026-13-01 does not silently degrade into "no filter" and re-ingest everything.')
    .option('--dry-run', 'preview the set of files that WOULD be ingested without reading, hashing, or upserting anything. Composes with --since so the preview matches the actual refresh that the same flags would do. Output shapes: --paths-only (xargs-safe, one path per line, no header), --json ({root, count, files}), default text (yellow count header + gray path list + rerun nudge). The natural cron flow is `clawmind ingest --since <iso> --dry-run --paths-only > preview.txt` to snapshot what the next refresh will touch BEFORE authorising the live run — saves a wall-clock-equivalent rehearsal cycle for the operator. Mirrors `reindex --dry-run` so the muscle memory is the same across the two destructive-adjacent commands.')
    .option('--paths-only', 'with --dry-run: emit just the paths one per line, no header, no count summary. Mirrors the --paths-only contract used by search/forget/related/stale/reindex. Ignored without --dry-run (a live ingest emits the regular ingest report instead). Composes naturally for shell pipelines: `clawmind ingest --since <iso> --dry-run --paths-only | wc -l` counts the about-to-refresh set without parsing the human report.')
    .option('--slim', 'with --dry-run --json: emit a slim `{count, since, dryRun}` shape carrying ONLY the file count, the --since anchor (or null when absent), and dryRun=true — instead of the full `{root, count, files: [...]}` payload with the per-path list. Mirrors `reindex --dry-run --json --slim` byte-for-byte (the two commands share the muscle memory for the destructive-adjacent dry-run preview, and the slim shape extends that contract uniformly). The classic cron use is an incremental-refresh dashboard polling `clawmind ingest --since <iso> --dry-run --json --slim` every minute to answer "how many files will the next 1-hour refresh tick touch" without paying the per-file path list. On a workspace with thousands of files matching the cutoff, the full --json payload can be hundreds of kilobytes; the slim shape is ~80 bytes regardless. Composes with --since: the slim count describes the SURVIVORS of the mtime filter. Without --since the slim payload still works (`since: null`). Ignored without --dry-run + --json (live ingest emits the regular processed/chunks/skipped report; --paths-only short-circuits before reaching here). Wins over the full --json payload when set with --dry-run + --json. The --paths-only flag still wins over --slim when both are set with --dry-run + --json + --paths-only + --slim because --paths-only is the pipeline contract and --slim is the dashboard contract.')
    .action(async (root: string | undefined, opts: { json?: boolean; since?: string; dryRun?: boolean; pathsOnly?: boolean; slim?: boolean }) => {
      const rt = await buildRuntime();
      const target = root ? expand(root) : rt.workspace;
      // --since <iso-date> is the incremental-refresh gate. Without
      // it, ingest walks the full discoverFiles() set and lets the
      // per-file hash/manifest dedupe path skip anything unchanged.
      // That's correct but expensive on a large index: every file
      // gets read, hashed, and compared against the manifest even
      // when nothing actually changed.
      //
      // --since cuts off the work much earlier: we stat() each
      // discovered path and drop the ones whose mtime predates the
      // cutoff BEFORE any reading happens. The classic cron use is
      // a 5-minute or 1-hour refresh tick: nearly every file in the
      // workspace is older than that, so the filtered list is tiny
      // even on a workspace with tens of thousands of files.
      //
      // Critical contract choices:
      //   - cutoff is INCLUSIVE (>=) because a file with mtime
      //     exactly equal to the cutoff was "modified at the cutoff",
      //     which is exactly the boundary the operator wants to
      //     include (otherwise a `--since` set to the previous run's
      //     wall-clock would silently drop changes that happened
      //     in the same second as the previous run)
      //   - parse failures throw a clean error rather than falling
      //     back to "no filter" — a typo like `--since 2026-13-01`
      //     would silently re-ingest everything, which is the exact
      //     anti-goal of this flag (a cron operator passing --since
      //     is asking to do LESS work; degrading to full re-ingest
      //     is the worst possible failure mode)
      //   - stat() errors on a single file are non-fatal: the file
      //     is dropped (it cannot be re-ingested anyway) and the
      //     rest of the batch proceeds. This mirrors how the
      //     pipeline already swallows per-file load failures.
      //   - we call ingestPaths() with the filtered list (instead
      //     of ingestRoot which does its own discoverFiles), so the
      //     filtering happens in exactly one place
      let files: string[] | null = null;
      if (opts.since) {
        const cutoff = Date.parse(opts.since);
        if (!Number.isFinite(cutoff)) {
          process.stderr.write(kleur.red(`ingest failed: --since value "${opts.since}" is not a valid ISO date\n`));
          process.exitCode = 1;
          return;
        }
        const discovered = await discoverFiles(target);
        const kept: string[] = [];
        await Promise.all(discovered.map(async (p) => {
          try {
            const s = await stat(p);
            if (s.mtimeMs >= cutoff) kept.push(p);
          } catch {
            // stat() failed — skip the file silently. It cannot be
            // re-ingested in this run anyway; surfacing the error
            // would just spam the cron log on a file that the
            // pipeline would have skipped at load() time.
          }
        }));
        files = kept;
      }
      // --dry-run is the rehearsal-before-mutation gate. It emits the
      // exact set of files that the same invocation WOULD ingest —
      // without reading them, hashing them, or upserting anything —
      // so the operator can verify the about-to-refresh set is
      // sensible BEFORE authorising the live run. The natural cron
      // flow is two steps:
      //   1. clawmind ingest --since <iso> --dry-run --paths-only > preview.txt
      //   2. clawmind ingest --since <iso>      # if preview looks right
      // The dry-run does NOT skip the --since filter: a preview of
      // an incremental refresh has to show what the incremental
      // refresh would do, not what a full re-ingest would do. So
      // the `files` array computed above (filtered or full) is what
      // we emit. When --since is absent the dry-run falls back to
      // discoverFiles() with no filter, mirroring what the live
      // path would walk.
      //
      // Output shapes match `reindex --dry-run` byte-for-byte so the
      // muscle memory carries between the two: --paths-only wins,
      // then --json, then default text. The "rerun without --dry-run"
      // nudge only fires when there are files to ingest — an empty
      // set means there is nothing to rerun.
      if (opts.dryRun) {
        const dryFiles = files !== null ? files : await discoverFiles(target);
        if (opts.pathsOnly) {
          for (const p of dryFiles) process.stdout.write(`${p}\n`);
          return;
        }
        if (opts.json) {
          // --slim wins over the full --json payload when set. The
          // slim shape is `{count, since, dryRun}` — mirrors
          // `reindex --dry-run --json --slim` byte-for-byte (the
          // two commands share the destructive-adjacent dry-run
          // contract). Only the integers a dashboard panel needs,
          // no per-file path list. The classic cron use:
          //   clawmind ingest --since <iso> --dry-run --json --slim
          // answers "how many files will the next 1-hour refresh
          // tick touch" with a single-line ~80-byte payload,
          // regardless of how many paths matched.
          //
          // Why this shape (not {root, count}):
          //   - the natural cron poll is "how many files would
          //     the next refresh touch" — count is the only
          //     integer a dashboard needs to branch on
          //   - `since` echoes the cutoff (or null when absent)
          //     so a multi-cutoff dashboard polling several scopes
          //     can identify which row it's reading without cross-
          //     referencing cron state
          //   - `dryRun: true` is the explicit safety contract:
          //     this payload describes a PREVIEW, not a real
          //     ingest; mirrors `forget --json --slim` byte-for-
          //     byte
          //   - `root` is intentionally dropped: a dashboard
          //     polling a single workspace already knows the
          //     root from cron config (~80-byte saving per
          //     snapshot, meaningful at NDJSON-append scale)
          //
          // The single-line JSON.stringify (no indent) keeps the
          // NDJSON-snapshot diff clean across cron ticks.
          if (opts.slim) {
            process.stdout.write(JSON.stringify({
              count: dryFiles.length,
              since: opts.since ?? null,
              dryRun: true,
            }) + '\n');
            return;
          }
          process.stdout.write(
            JSON.stringify({ root: target, count: dryFiles.length, files: dryFiles }, null, 2) + '\n',
          );
          return;
        }
        process.stdout.write(
          kleur.yellow(`would ingest ${dryFiles.length} file(s) under ${target}\n`),
        );
        for (const p of dryFiles) process.stdout.write(kleur.gray(`  ${p}\n`));
        if (dryFiles.length > 0) {
          process.stdout.write(kleur.bold('\nrerun without --dry-run to actually ingest these.\n'));
        }
        return;
      }
      const spinner = opts.json ? null : ora(`Indexing ${target}`).start();
      let last = 0;
      const onProgress = ({ processed, total }: { processed: number; total: number; path: string }) => {
        if (!spinner) return;
        if (processed - last >= 10 || processed === total) {
          last = processed;
          spinner.text = `Indexing ${processed}/${total}`;
        }
      };
      const ingestDeps = {
        store: rt.lance, bm25: rt.bm25, bm25File: rt.bm25File,
        manifest: rt.manifest, embed: rt.embed, embedModel: rt.env.CLAWMIND_EMBED_MODEL,
        onProgress,
      };
      const stats = files !== null
        ? await ingestPaths(files, ingestDeps)
        : await ingestRoot(target, ingestDeps);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { root: target, processed: stats.processed, chunks: stats.chunks, skipped: stats.skipped },
            null,
            2,
          ) + '\n',
        );
        return;
      }
      // When --since filtered to zero files, the spinner needs to
      // know the operator was not idle — ingest did walk the
      // workspace, the cutoff just happened to match nothing. The
      // succeed message stays accurate either way (processed = 0,
      // chunks = 0, skipped = 0).
      spinner!.succeed(
        kleur.green(`Indexed ${stats.processed} files, ${stats.chunks} chunks, skipped ${stats.skipped}`),
      );
    });
}
