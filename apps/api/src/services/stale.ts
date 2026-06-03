import type { IngestManifest, ManifestEntry } from '@clawmind/store';

// Staleness diagnostics over the ingest manifest. A source is "stale" when
// its last successful ingest is older than the requested threshold. This
// helps a human (or a watchdog) spot files that have drifted out of the
// index, typically because the watcher was offline, a manual reindex was
// skipped, or the file lives outside the watched roots.
//
// We deliberately key staleness on `ingestedAt` (the manifest field already
// populated by the ingest pipeline) rather than on filesystem mtime: the
// question we want to answer is "when did ClawMind last touch this source",
// not "when did the user last edit it". A pristine, never-edited file should
// still be reported stale once it has not been re-validated in a long while.

export interface StaleEntry {
  path: string;
  ingestedAt: number;
  ageMs: number;
  ageDays: number;
  chunkCount: number;
  size: number;
}

export interface StaleResult {
  thresholdDays: number;
  thresholdMs: number;
  asOf: number;
  total: number;
  items: StaleEntry[];
}

export const DEFAULT_STALE_DAYS = 30;

/**
 * Return manifest entries whose `ingestedAt` is older than `thresholdDays`
 * relative to `now`. Results are sorted oldest first so the most pressing
 * sources appear at the top.
 *
 * `thresholdDays` is clamped to `[0, 3650]` (ten years) to keep API callers
 * from accidentally hitting integer overflow on the threshold multiplication.
 */
export function findStaleSources(
  manifest: IngestManifest,
  opts: { thresholdDays?: number; now?: number; limit?: number; q?: string } = {},
): StaleResult {
  const rawDays = opts.thresholdDays ?? DEFAULT_STALE_DAYS;
  const thresholdDays = Math.min(Math.max(0, rawDays), 3650);
  const now = opts.now ?? Date.now();
  const thresholdMs = thresholdDays * 86_400_000;
  const cutoff = now - thresholdMs;
  const needle = opts.q?.trim().toLowerCase() ?? '';

  const items: StaleEntry[] = [];
  for (const e of manifest.entries()) {
    if (e.ingestedAt > cutoff) continue;
    if (needle && !e.path.toLowerCase().includes(needle)) continue;
    const ageMs = now - e.ingestedAt;
    items.push({
      path: e.path,
      ingestedAt: e.ingestedAt,
      ageMs,
      ageDays: Math.floor(ageMs / 86_400_000),
      chunkCount: e.chunkCount,
      size: e.size,
    });
  }
  items.sort((a, b) => a.ingestedAt - b.ingestedAt);
  const limited = opts.limit ? items.slice(0, opts.limit) : items;
  return {
    thresholdDays,
    thresholdMs,
    asOf: now,
    total: items.length,
    items: limited,
  };
}

/**
 * Variant that operates on a raw entry list, useful in tests and in code
 * paths that already hold the entries (avoids reading the manifest twice).
 */
export function findStaleFromEntries(
  entries: readonly ManifestEntry[],
  opts: { thresholdDays?: number; now?: number; limit?: number; q?: string } = {},
): StaleResult {
  const fake = {
    entries: () => [...entries],
  } as unknown as IngestManifest;
  return findStaleSources(fake, opts);
}
