import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-user tags applied to history items (Q&A entries). Lets customers
// organise their ask log by topic ("travel", "work", "research") and
// filter the history view by tag without touching the immutable history
// log itself. Storage is a small JSON file separate from history.jsonl so
// tagging a million-row log does not rewrite the log.
//
// Shape on disk:
//   { byUser: { [userId]: { [itemId]: string[] } } }
//
// Tags are normalised the same way as source tags: lowercased, trimmed,
// constrained character set, dedup + sorted. Capped to keep the file
// small and the UI scannable.

const MAX_TAGS_PER_ITEM = 16;
const MAX_TAG_LEN = 32;
const TAG_RE = /^[a-z0-9][a-z0-9._-]*$/;

export interface HistoryTagMap {
  byUser: Record<string, Record<string, string[]>>;
}

function file(dataDir: string) {
  return join(dataDir, 'history-tags.json');
}

export function emptyMap(): HistoryTagMap {
  return { byUser: {} };
}

export function normalizeTags(input: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().toLowerCase();
    if (!t || t.length > MAX_TAG_LEN) continue;
    if (!TAG_RE.test(t)) continue;
    seen.add(t);
  }
  return Array.from(seen).sort().slice(0, MAX_TAGS_PER_ITEM);
}

export async function loadMap(dataDir: string): Promise<HistoryTagMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as HistoryTagMap;
    if (!parsed || typeof parsed !== 'object' || !parsed.byUser) return emptyMap();
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyMap();
    throw err;
  }
}

async function saveMap(dataDir: string, map: HistoryTagMap): Promise<void> {
  const f = file(dataDir);
  const tmp = f + '.tmp';
  await mkdir(dirname(f), { recursive: true });
  await writeFile(tmp, JSON.stringify(map, null, 2));
  await rename(tmp, f);
}

export function tagsFor(map: HistoryTagMap, userId: string, itemId: string): string[] {
  return map.byUser[userId]?.[itemId] ?? [];
}

export function listUserTags(map: HistoryTagMap, userId: string): string[] {
  const seen = new Set<string>();
  const mine = map.byUser[userId] ?? {};
  for (const tags of Object.values(mine)) {
    for (const t of tags) seen.add(t);
  }
  return Array.from(seen).sort();
}

/** Replace the full tag set for one item. Empty list removes the entry. */
export async function setTags(
  dataDir: string,
  userId: string,
  itemId: string,
  tags: readonly string[],
): Promise<string[]> {
  const norm = normalizeTags(tags);
  const map = await loadMap(dataDir);
  map.byUser[userId] ??= {};
  if (norm.length === 0) {
    delete map.byUser[userId][itemId];
    if (Object.keys(map.byUser[userId]).length === 0) delete map.byUser[userId];
  } else {
    map.byUser[userId][itemId] = norm;
  }
  await saveMap(dataDir, map);
  return norm;
}

export async function addTags(
  dataDir: string,
  userId: string,
  itemId: string,
  tags: readonly string[],
): Promise<string[]> {
  const map = await loadMap(dataDir);
  const cur = new Set(map.byUser[userId]?.[itemId] ?? []);
  for (const t of normalizeTags(tags)) cur.add(t);
  return setTags(dataDir, userId, itemId, Array.from(cur));
}

export async function removeTags(
  dataDir: string,
  userId: string,
  itemId: string,
  tags: readonly string[],
): Promise<string[]> {
  const map = await loadMap(dataDir);
  const cur = new Set(map.byUser[userId]?.[itemId] ?? []);
  for (const t of normalizeTags(tags)) cur.delete(t);
  return setTags(dataDir, userId, itemId, Array.from(cur));
}

/** Drop tag rows for a deleted history item. */
export async function forgetItem(
  dataDir: string,
  userId: string,
  itemId: string,
): Promise<void> {
  const map = await loadMap(dataDir);
  if (!map.byUser[userId]?.[itemId]) return;
  delete map.byUser[userId][itemId];
  if (Object.keys(map.byUser[userId]).length === 0) delete map.byUser[userId];
  await saveMap(dataDir, map);
}
