import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Muted sources are the opposite of pins: paths the user wants retrieval to
// avoid surfacing. Mutes apply a small multiplicative penalty to the blended
// hybrid score so a muted source can still win if it is overwhelmingly the
// best match, but in practice it will fall well below any reasonable
// alternative. This is intentionally softer than a hard filter so that
// queries which can only be answered by a muted file still get an answer
// (with the muted source visible in citations) rather than a confident
// "no results" response.
//
// Pattern semantics: an entry whose path ends with "/**" matches the
// directory plus everything under it; otherwise the entry matches the
// exact path. This is the same minimal subset we already use for pins-style
// curation: we deliberately do not pull in a glob library here because the
// configuration surface is intended to be small and explicit.

export interface MuteEntry {
  path: string;
  reason?: string;
  mutedAt: number;
  mutedBy: string; // user id
}

export type MuteMap = Record<string, MuteEntry>;

/** Multiplier applied to the blended hybrid score for muted paths. */
export const MUTE_PENALTY = 0.1;

function file(dataDir: string) { return join(dataDir, 'mutes.json'); }

export async function loadMutes(dataDir: string): Promise<MuteMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as MuteMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function save(dataDir: string, map: MuteMap) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(map, null, 2));
}

export async function addMute(
  dataDir: string,
  userId: string,
  path: string,
  reason?: string,
): Promise<MuteEntry> {
  const map = await loadMutes(dataDir);
  const entry: MuteEntry = {
    path,
    reason: reason?.trim() || undefined,
    mutedAt: Date.now(),
    mutedBy: userId,
  };
  map[path] = entry;
  await save(dataDir, map);
  return entry;
}

export async function removeMute(dataDir: string, path: string): Promise<boolean> {
  const map = await loadMutes(dataDir);
  if (!(path in map)) return false;
  delete map[path];
  await save(dataDir, map);
  return true;
}

/**
 * Return true when `path` is muted, either by exact match or by a directory
 * prefix entry of the form "dir/**".
 */
export function isMuted(map: MuteMap, path: string): boolean {
  if (path in map) return true;
  for (const key of Object.keys(map)) {
    if (key.endsWith('/**')) {
      const prefix = key.slice(0, -2); // keep trailing slash
      if (path.startsWith(prefix)) return true;
    }
  }
  return false;
}

export function mutePenaltyFor(map: MuteMap, path: string): number {
  return isMuted(map, path) ? MUTE_PENALTY : 1;
}
