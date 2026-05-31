import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-user custom titles for history items. Lets customers rename a Q&A
// row to something memorable ("Q3 launch plan", "deck refs") so the
// history view scans like a real notebook instead of a wall of raw
// questions. Stored separately from history.jsonl so renaming never
// rewrites the immutable ask log.
//
// On-disk shape:
//   { byUser: { [userId]: { [itemId]: string } } }
//
// Titles are trimmed, collapsed whitespace, capped in length. Empty
// titles delete the entry, which is how clients clear a rename to fall
// back to the original query.

const MAX_TITLE_LEN = 120;

export interface HistoryTitleMap {
  byUser: Record<string, Record<string, string>>;
}

function file(dataDir: string) {
  return join(dataDir, 'history-titles.json');
}

export function emptyMap(): HistoryTitleMap {
  return { byUser: {} };
}

/**
 * Normalise a candidate title: collapse whitespace, strip controls, cap
 * length. Returns an empty string for anything unusable so callers can
 * treat empty as "clear the title".
 */
export function normalizeTitle(input: unknown): string {
  if (typeof input !== 'string') return '';
  // Drop control chars (newlines, tabs) and collapse runs of whitespace.
  const cleaned = input.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.slice(0, MAX_TITLE_LEN);
}

export async function loadMap(dataDir: string): Promise<HistoryTitleMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as HistoryTitleMap;
    if (!parsed || typeof parsed !== 'object' || !parsed.byUser) return emptyMap();
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyMap();
    throw err;
  }
}

async function saveMap(dataDir: string, map: HistoryTitleMap): Promise<void> {
  const f = file(dataDir);
  const tmp = f + '.tmp';
  await mkdir(dirname(f), { recursive: true });
  await writeFile(tmp, JSON.stringify(map, null, 2));
  await rename(tmp, f);
}

export function titleFor(map: HistoryTitleMap, userId: string, itemId: string): string | undefined {
  return map.byUser[userId]?.[itemId];
}

/**
 * Set or clear the custom title for one history item owned by `userId`.
 * Returns the persisted title (or empty string if cleared).
 */
export async function setTitle(
  dataDir: string,
  userId: string,
  itemId: string,
  title: unknown,
): Promise<string> {
  const norm = normalizeTitle(title);
  const map = await loadMap(dataDir);
  map.byUser[userId] ??= {};
  if (!norm) {
    delete map.byUser[userId][itemId];
    if (Object.keys(map.byUser[userId]).length === 0) delete map.byUser[userId];
  } else {
    map.byUser[userId][itemId] = norm;
  }
  await saveMap(dataDir, map);
  return norm;
}

/** Drop the title for a deleted history item. No-op if absent. */
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
