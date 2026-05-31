import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface HistoryItem {
  id: string;
  ts: number;
  userId: string;
  query: string;
  answer: string;
  sources: unknown[];
  model: string;
}

export interface HistoryQuery {
  /** Cap on the number of items returned (default 50, max 1000). */
  limit?: number;
  /** Only return items with `ts >= since` (milliseconds since epoch). */
  since?: number;
  /** Only return items with `ts <= until` (milliseconds since epoch). */
  until?: number;
  /** Case-insensitive substring filter applied to query and answer. */
  q?: string;
  /** Keep only items that cite at least one source in any of these namespaces. */
  namespaces?: string[];
}

function file(dataDir: string) { return join(dataDir, 'history.jsonl'); }

async function readAll(dataDir: string): Promise<HistoryItem[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as HistoryItem);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function recordHistory(dataDir: string, item: HistoryItem) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(item) + '\n', { flag: 'a' });
}

/**
 * Decide whether a single history entry passes the given filters. Exported so
 * other callers (digests, exports) can reuse the same semantics.
 */
export function matchesHistoryFilter(item: HistoryItem, filter: HistoryQuery): boolean {
  if (filter.since !== undefined && item.ts < filter.since) return false;
  if (filter.until !== undefined && item.ts > filter.until) return false;
  if (filter.q) {
    const needle = filter.q.toLowerCase();
    const hay = (item.query + '\n' + item.answer).toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (filter.namespaces && filter.namespaces.length > 0) {
    const want = new Set(filter.namespaces);
    const ok = (item.sources as Array<{ namespace?: string }> | undefined)?.some((s) =>
      s && typeof s.namespace === 'string' && want.has(s.namespace),
    );
    if (!ok) return false;
  }
  return true;
}

/**
 * List history for `userId` newest-first, applying optional filters and a
 * limit. Filtering happens server-side so callers do not need to download
 * the whole log to narrow down a window.
 */
export async function listHistory(
  dataDir: string,
  userId: string,
  query: HistoryQuery = {},
): Promise<HistoryItem[]> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 1000);
  const items = await readAll(dataDir);
  const out: HistoryItem[] = [];
  for (const item of items) {
    if (item.userId !== userId) continue;
    if (!matchesHistoryFilter(item, query)) continue;
    out.push(item);
  }
  // Newest first, then cap.
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, limit);
}

/**
 * Delete a single history entry owned by `userId`. Returns true if the entry
 * was found and removed, false if no matching entry exists for that user.
 * Other users' entries are never touched, even if the id collides.
 * Atomic via tmp file + rename so a crash mid-write cannot truncate the log.
 */
export async function deleteHistoryItem(
  dataDir: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const items = await readAll(dataDir);
  let removed = false;
  const kept: HistoryItem[] = [];
  for (const it of items) {
    if (!removed && it.id === id && it.userId === userId) {
      removed = true;
      continue;
    }
    kept.push(it);
  }
  if (!removed) return false;
  const f = file(dataDir);
  const tmp = f + '.tmp';
  await mkdir(dirname(f), { recursive: true });
  await writeFile(
    tmp,
    kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length ? '\n' : ''),
  );
  await rename(tmp, f);
  return true;
}

export interface PruneOptions {
  /** Delete entries strictly older than this timestamp (ms since epoch). */
  before?: number;
  /** Keep at most this many entries per user (newest kept). */
  keepPerUser?: number;
}

/**
 * Rewrite the history log, dropping entries that fail the prune criteria.
 * Returns the number of entries removed. Atomic via tmp file + rename.
 */
export async function pruneHistory(
  dataDir: string,
  userId: string,
  opts: PruneOptions,
): Promise<{ removed: number; kept: number }> {
  if (opts.before === undefined && opts.keepPerUser === undefined) {
    return { removed: 0, kept: 0 };
  }
  const items = await readAll(dataDir);
  const mine = items.filter((i) => i.userId === userId).sort((a, b) => b.ts - a.ts);
  const others = items.filter((i) => i.userId !== userId);

  let kept = mine;
  if (opts.before !== undefined) {
    kept = kept.filter((i) => i.ts >= opts.before!);
  }
  if (opts.keepPerUser !== undefined && opts.keepPerUser >= 0) {
    kept = kept.slice(0, opts.keepPerUser);
  }
  const removed = mine.length - kept.length;
  if (removed === 0) return { removed: 0, kept: mine.length };

  const merged = [...others, ...kept].sort((a, b) => a.ts - b.ts);
  const f = file(dataDir);
  const tmp = f + '.tmp';
  await mkdir(dirname(f), { recursive: true });
  await writeFile(tmp, merged.map((m) => JSON.stringify(m)).join('\n') + (merged.length ? '\n' : ''));
  await rename(tmp, f);
  return { removed, kept: kept.length };
}
