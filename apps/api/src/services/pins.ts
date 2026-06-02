import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Pinned sources are paths that the user has marked as "always relevant" for
// their workspace. Retrieval applies a strong multiplicative boost to their
// blended hybrid score so they reliably surface in answer context for any
// query that has at least a faint lexical or semantic match. Pins compose
// with feedback boosts (both are score multipliers) rather than replacing
// retrieval, so a pinned source still has to be plausibly on-topic to win
// over a perfect match elsewhere.

export interface PinEntry {
  path: string;
  note?: string;
  pinnedAt: number;
  pinnedBy: string; // user id
}

export type PinMap = Record<string, PinEntry>;

/** Multiplier applied to the blended hybrid score for pinned paths. */
export const PIN_BOOST = 1.75;

function file(dataDir: string) { return join(dataDir, 'pins.json'); }

export async function loadPins(dataDir: string): Promise<PinMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as PinMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function save(dataDir: string, map: PinMap) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(map, null, 2));
}

export async function addPin(
  dataDir: string,
  userId: string,
  path: string,
  note?: string,
): Promise<PinEntry> {
  const map = await loadPins(dataDir);
  const entry: PinEntry = {
    path,
    note: note?.trim() || undefined,
    pinnedAt: Date.now(),
    pinnedBy: userId,
  };
  map[path] = entry;
  await save(dataDir, map);
  return entry;
}

/**
 * Update only the note on an existing pin, preserving the original
 * `pinnedAt` and `pinnedBy`. Returns the updated entry, or `null` if the
 * path is not currently pinned. Use this instead of re-POSTing the pin
 * when the curator only wants to retitle the note: re-POST resets the
 * pin timestamp and ownership, which reorders the list and rewrites the
 * audit trail of who originally pinned it.
 */
export async function updatePinNote(
  dataDir: string,
  path: string,
  note: string | undefined,
): Promise<PinEntry | null> {
  const map = await loadPins(dataDir);
  const existing = map[path];
  if (!existing) return null;
  const trimmed = note?.trim();
  const updated: PinEntry = {
    ...existing,
    note: trimmed ? trimmed : undefined,
  };
  map[path] = updated;
  await save(dataDir, map);
  return updated;
}

export async function removePin(dataDir: string, path: string): Promise<boolean> {
  const map = await loadPins(dataDir);
  if (!(path in map)) return false;
  delete map[path];
  await save(dataDir, map);
  return true;
}

export function pinBoostFor(map: PinMap, path: string): number {
  return path in map ? PIN_BOOST : 1;
}
