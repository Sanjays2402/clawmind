import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import type { Source } from '@clawmind/types';

// Snapshots are user-triggered captures of the current top-N sources for a
// saved search. They differ from digests (apps/api/src/services/digests.ts)
// in two important ways:
//
//   1. Snapshots are explicit: a human (or a script) decides when "this is
//      the state I want to remember." Digests are automatic diffs on every
//      run. Snapshots are forever; digests roll off after MAX_HISTORY runs.
//
//   2. Snapshots support diffing the current result set against any chosen
//      snapshot id, not just the previous run. This is the pattern you want
//      when investigating regressions ("what did the top sources look like
//      before the latest reindex?") or auditing a long-term saved query.
//
// Each saved search owns a directory under data/snapshots/<savedSearchId>/
// containing one JSON file per snapshot. Per-file storage keeps deletes and
// reads cheap and avoids a write-amplification problem on a single combined
// file once a query has accumulated dozens of snapshots.

export interface SnapshotEntry {
  id: string;
  savedSearchId: string;
  userId: string;
  /** Human-friendly label, optional. Falls back to the timestamp. */
  label: string | null;
  ts: number;
  /** Top-N sources captured at this point in time. */
  sources: Source[];
}

export interface SnapshotDiff {
  baselineId: string;
  baselineTs: number;
  currentTs: number;
  /** Source ids that are in `current` but not in baseline. */
  added: Source[];
  /** Source ids that were in baseline but are absent from `current`. */
  removed: Source[];
  /** Source ids present in both. */
  unchanged: string[];
}

export const DEFAULT_SNAPSHOT_TOP = 8;
export const MAX_SNAPSHOTS_PER_QUERY = 100;

function snapDir(dataDir: string, savedSearchId: string) {
  return join(dataDir, 'snapshots', savedSearchId);
}

function snapFile(dataDir: string, savedSearchId: string, id: string) {
  return join(snapDir(dataDir, savedSearchId), `${id}.json`);
}

/**
 * Persist a snapshot. The caller supplies the sources (already retrieved)
 * so this layer stays free of any RAG plumbing. Returns the stored entry.
 *
 * When the per-query snapshot count would exceed MAX_SNAPSHOTS_PER_QUERY,
 * the oldest snapshot is unlinked to keep the directory bounded. Newest
 * snapshots win because operators reach for "recent" far more often than
 * "earliest" when investigating drift.
 */
export async function captureSnapshot(
  dataDir: string,
  input: {
    savedSearchId: string;
    userId: string;
    sources: Source[];
    label?: string | null;
  },
): Promise<SnapshotEntry> {
  const entry: SnapshotEntry = {
    id: nanoid(10),
    savedSearchId: input.savedSearchId,
    userId: input.userId,
    label: input.label?.trim()?.slice(0, 200) || null,
    ts: Date.now(),
    sources: input.sources.slice(0, DEFAULT_SNAPSHOT_TOP),
  };
  const f = snapFile(dataDir, input.savedSearchId, entry.id);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(entry, null, 2));
  await pruneOldest(dataDir, input.savedSearchId);
  return entry;
}

async function pruneOldest(dataDir: string, savedSearchId: string): Promise<void> {
  const all = await listSnapshots(dataDir, savedSearchId);
  if (all.length <= MAX_SNAPSHOTS_PER_QUERY) return;
  const excess = all.length - MAX_SNAPSHOTS_PER_QUERY;
  // listSnapshots sorts newest first; the tail holds the oldest entries.
  const victims = all.slice(-excess);
  for (const v of victims) {
    await unlink(snapFile(dataDir, savedSearchId, v.id)).catch(() => undefined);
  }
}

export async function listSnapshots(
  dataDir: string,
  savedSearchId: string,
): Promise<SnapshotEntry[]> {
  const d = snapDir(dataDir, savedSearchId);
  try {
    const names = await readdir(d);
    const all = await Promise.all(
      names.filter((n) => n.endsWith('.json')).map(async (n) => {
        const raw = await readFile(join(d, n), 'utf8');
        return JSON.parse(raw) as SnapshotEntry;
      }),
    );
    return all.sort((a, b) => b.ts - a.ts);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function loadSnapshot(
  dataDir: string,
  savedSearchId: string,
  id: string,
): Promise<SnapshotEntry | null> {
  try {
    const raw = await readFile(snapFile(dataDir, savedSearchId, id), 'utf8');
    return JSON.parse(raw) as SnapshotEntry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteSnapshot(
  dataDir: string,
  savedSearchId: string,
  id: string,
): Promise<boolean> {
  try {
    await unlink(snapFile(dataDir, savedSearchId, id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Diff a fresh source list against a stored snapshot. Identity is by Source
 * id rather than path so reindexes that change chunk boundaries are
 * detected, which is exactly what an operator wants when checking drift.
 */
export function diffAgainstSnapshot(
  baseline: SnapshotEntry,
  current: Source[],
  currentTs: number = Date.now(),
): SnapshotDiff {
  const baseIds = new Set(baseline.sources.map((s) => s.id));
  const curIds = new Set(current.map((s) => s.id));
  const added = current.filter((s) => !baseIds.has(s.id));
  const removed = baseline.sources.filter((s) => !curIds.has(s.id));
  const unchanged: string[] = [];
  for (const id of curIds) if (baseIds.has(id)) unchanged.push(id);
  return {
    baselineId: baseline.id,
    baselineTs: baseline.ts,
    currentTs,
    added,
    removed,
    unchanged,
  };
}
