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
    .action(async (root: string | undefined, opts: { json?: boolean; since?: string }) => {
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
