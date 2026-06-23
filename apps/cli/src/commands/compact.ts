import { Command } from 'commander';
import kleur from 'kleur';
import { compactStore } from '@clawmind/ingest';
import { buildRuntime } from '../runtime.js';

export function compactCommand() {
  return new Command('compact')
    .description('Prune manifest, BM25, and LanceDB entries for files that no longer exist')
    .option('--dry-run', 'report what would be removed without changing anything', false)
    .option('--json', 'emit machine-readable JSON instead of a text report')
    .option('--slim', 'with --json: emit a slimmed `{scanned, removed, kept, dryRun}` 4-integer shape that drops the per-path `removedPaths` array. Mirrors `doctor --json --quiet`, `digest run --json --slim`, `feedback prune --json --slim`, `forget --json --slim`, `reindex --dry-run --json --slim`, and `ingest --dry-run --json --slim` byte-for-byte: single-line JSON carrying only the integers a cron-dashboard panel needs, no per-row detail. The classic cron use is `clawmind compact --dry-run --json --slim` polled every minute to answer \"does compact have anything to do\" without paying the per-path list. On a workspace with hundreds of removed files, the full --json payload re-emits every removed path (kilobytes); the slim shape is ~60 bytes regardless. The four-integer shape preserves the sum-equals-total invariant `scanned === removed + kept` so a downstream `jq` consumer can verify the math without re-reading the array. `dryRun` is preserved so a dashboard distinguishes preview-snapshots from live-run snapshots in the same NDJSON stream. Composes naturally with --dry-run (preview-the-compact path) and the live path (post-mutation report). Ignored without --json (text mode unchanged). Wins over the full --json payload when set — same precedent as the family-wide --slim contract.')
    .action(async (opts: { dryRun: boolean; json?: boolean; slim?: boolean }) => {
      const rt = await buildRuntime();
      const report = await compactStore({
        manifest: rt.manifest, bm25: rt.bm25, bm25File: rt.bm25File,
        lance: rt.lance, dryRun: opts.dryRun,
      });
      if (opts.json) {
        // --slim wins over the full --json payload when set. The slim
        // shape is `{scanned, removed, kept, dryRun}` — only the four
        // integers a cron-dashboard panel needs, no per-path
        // `removedPaths` array. Mirrors the family-wide cron-dashboard
        // contract (`doctor --json --quiet`, `digest run --json --slim`,
        // `feedback prune --json --slim`, `forget --json --slim`,
        // `reindex --dry-run --json --slim`, `ingest --dry-run --json
        // --slim`) byte-for-byte: single-line JSON, no per-row detail.
        //
        // Why this shape (preserves all 4 integers, drops just the
        // path array):
        //   - the natural cron poll is "does compact have anything to
        //     do" — `removed > 0` is the branch a dashboard wires
        //     against, and `scanned` / `kept` give the context to
        //     judge whether `removed > 0` is normal (a workspace
        //     with thousands of files churning through 10 removals
        //     a tick is healthy; a tiny workspace with 5 removals
        //     a tick is a leak)
        //   - the sum-equals-total invariant `scanned === removed +
        //     kept` holds so a downstream `jq` consumer can verify
        //     the math without re-reading the removedPaths array,
        //     and a regression on the math is observable from the
        //     slim shape alone (which is the whole point of a
        //     cron-dashboard probe)
        //   - `dryRun` is preserved (mirrors `forget --json --slim`
        //     and the family-wide preview/live disambiguation) so
        //     the same dashboard panel can poll both `compact
        //     --dry-run --json --slim` (preview snapshot) and
        //     `compact --json --slim` (live-run snapshot) into the
        //     same NDJSON stream without out-of-band tracking of
        //     which command emitted which line
        //   - `removedPaths` is dropped: on a workspace with hundreds
        //     of removed files (a stale git worktree pruned, a temp
        //     directory wiped), the array is the bulk of the
        //     payload; a dashboard counting `removed > N` does not
        //     need the per-path detail (the operator can re-run
        //     without --slim to get the full list if a panel turns
        //     red and needs investigation)
        //
        // Single-line JSON.stringify (no indent) keeps the NDJSON
        // snapshot diff clean across cron ticks.
        if (opts.slim) {
          process.stdout.write(JSON.stringify({
            scanned: report.scanned,
            removed: report.removed,
            kept: report.kept,
            dryRun: report.dryRun,
          }) + '\n');
          return;
        }
        // `report` already carries its own dryRun flag (the same value we
        // passed in), so spreading it after a literal dryRun key wins the
        // duplicate-property race and tsc flags TS2783. Drop the literal —
        // the spread is the single source of truth.
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        return;
      }
      const head = opts.dryRun ? kleur.yellow('dry run') : kleur.green('compacted');
      process.stdout.write([
        `${head} scanned=${report.scanned} removed=${report.removed} kept=${report.kept}`,
        ...report.removedPaths.map((p) => `  ${kleur.dim('-')} ${p}`),
      ].join('\n') + '\n');
    });
}
