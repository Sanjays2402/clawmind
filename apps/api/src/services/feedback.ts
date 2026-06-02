import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-source feedback boosts. Users thumbs-up or thumbs-down a source from a
// previous answer; we keep a small JSON map keyed by source path so the next
// retrieval can re-weight hits. Boost values are bounded so a single
// downvote can't permanently bury a relevant doc, and the multiplier is
// applied multiplicatively to the blended hybrid score, not the raw BM25 or
// dense score, so it composes cleanly with the existing rerank.

export interface FeedbackEntry {
  path: string;
  ups: number;
  downs: number;
  updatedAt: number;
  byUser: Record<string, 1 | -1>; // last vote per user so re-voting flips, not stacks
}

export type FeedbackMap = Record<string, FeedbackEntry>;

const MAX_BOOST = 1.5;
const MIN_BOOST = 0.5;
const PER_VOTE = 0.05;

function file(dataDir: string) { return join(dataDir, 'feedback.json'); }

/**
 * Fetch a single feedback entry by source path, or null if the path has
 * no recorded votes. Used by the single-entry GET and per-entry export
 * routes so a curator can deep-link or share votes for one source
 * without paging the whole map.
 */
export async function getFeedback(
  dataDir: string,
  path: string,
): Promise<FeedbackEntry | null> {
  const map = await loadFeedback(dataDir);
  return map[path] ?? null;
}

export async function loadFeedback(dataDir: string): Promise<FeedbackMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as FeedbackMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function save(dataDir: string, map: FeedbackMap) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(map, null, 2));
}

export async function recordVote(
  dataDir: string,
  userId: string,
  path: string,
  vote: 1 | -1,
): Promise<FeedbackEntry> {
  const map = await loadFeedback(dataDir);
  const cur = map[path] ?? { path, ups: 0, downs: 0, updatedAt: 0, byUser: {} };
  const prev = cur.byUser[userId];
  // Undo prior vote first so the same user can flip without stacking.
  if (prev === 1) cur.ups = Math.max(0, cur.ups - 1);
  if (prev === -1) cur.downs = Math.max(0, cur.downs - 1);
  if (vote === 1) cur.ups += 1;
  else cur.downs += 1;
  cur.byUser[userId] = vote;
  cur.updatedAt = Date.now();
  map[path] = cur;
  await save(dataDir, map);
  return cur;
}

export async function clearVote(dataDir: string, userId: string, path: string): Promise<void> {
  const map = await loadFeedback(dataDir);
  const cur = map[path];
  if (!cur) return;
  const prev = cur.byUser[userId];
  if (prev === 1) cur.ups = Math.max(0, cur.ups - 1);
  if (prev === -1) cur.downs = Math.max(0, cur.downs - 1);
  delete cur.byUser[userId];
  cur.updatedAt = Date.now();
  if (cur.ups === 0 && cur.downs === 0) delete map[path];
  await save(dataDir, map);
}

export function boostFor(entry: FeedbackEntry | undefined): number {
  if (!entry) return 1;
  const net = entry.ups - entry.downs;
  const raw = 1 + net * PER_VOTE;
  return Math.max(MIN_BOOST, Math.min(MAX_BOOST, raw));
}

export interface ScoredItem { path: string; score: number }

export function applyBoosts<T extends ScoredItem>(items: T[], map: FeedbackMap): T[] {
  if (Object.keys(map).length === 0) return items;
  const out = items.map((it) => {
    const b = boostFor(map[it.path]);
    return b === 1 ? it : { ...it, score: it.score * b };
  });
  out.sort((a, b) => b.score - a.score);
  return out;
}

export const FEEDBACK_BOUNDS = { MAX_BOOST, MIN_BOOST, PER_VOTE };
