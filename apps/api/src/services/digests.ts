import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import type { Source } from '@clawmind/types';

// A digest is "what changed in the answer to my saved question since the last
// time I asked it." For each saved query we keep:
//   - the previous top-source ids (a tiny set per query)
//   - a rolling history of runs with the sources that were new this run
//
// The runner is pure - it accepts a retrieve function so it can be driven
// from the API process, the CLI, or a test. The store is one JSON file per
// saved-search id under data/digests/.

export interface DigestEntry {
  ts: number;
  newSources: Source[];        // sources that did not appear in the previous run
  removedSources: string[];    // ids that were in the previous top but are gone
  totalSources: number;        // total top sources this run
}

export interface DigestState {
  savedSearchId: string;
  query: string;
  userId: string;
  lastRunTs: number | null;
  lastTopIds: string[];
  history: DigestEntry[];      // capped at MAX_HISTORY
}

export const MAX_HISTORY = 30;
export const TOP_FOR_DIFF = 8;

function file(dataDir: string, id: string) {
  return join(dataDir, 'digests', `${id}.json`);
}

export async function loadState(dataDir: string, id: string): Promise<DigestState | null> {
  try {
    const raw = await readFile(file(dataDir, id), 'utf8');
    return JSON.parse(raw) as DigestState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function saveState(dataDir: string, state: DigestState) {
  const f = file(dataDir, state.savedSearchId);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(state, null, 2));
}

export interface RunDigestInput {
  savedSearchId: string;
  query: string;
  userId: string;
}

export type RetrieveSources = (query: string) => Promise<Source[]>;

/**
 * Run a saved query, compute new vs removed sources against the previous run,
 * append the diff to history, persist, and return the diff entry.
 */
export async function runDigest(
  dataDir: string,
  input: RunDigestInput,
  retrieve: RetrieveSources,
  now: number = Date.now(),
): Promise<{ state: DigestState; entry: DigestEntry }> {
  const sources = (await retrieve(input.query)).slice(0, TOP_FOR_DIFF);
  const prev = (await loadState(dataDir, input.savedSearchId)) ?? {
    savedSearchId: input.savedSearchId,
    query: input.query,
    userId: input.userId,
    lastRunTs: null,
    lastTopIds: [],
    history: [],
  };
  const prevIds = new Set(prev.lastTopIds);
  const currentIds = sources.map((s) => s.id);
  const currentSet = new Set(currentIds);
  const newSources = sources.filter((s) => !prevIds.has(s.id));
  const removedSources = prev.lastTopIds.filter((id) => !currentSet.has(id));
  const entry: DigestEntry = {
    ts: now,
    newSources,
    removedSources,
    totalSources: sources.length,
  };
  const next: DigestState = {
    ...prev,
    query: input.query,
    userId: input.userId,
    lastRunTs: now,
    lastTopIds: currentIds,
    history: [entry, ...prev.history].slice(0, MAX_HISTORY),
  };
  await saveState(dataDir, next);
  return { state: next, entry };
}

export async function listDigestsForUser(
  dataDir: string,
  userId: string,
  savedIds: string[],
): Promise<DigestState[]> {
  const out: DigestState[] = [];
  for (const id of savedIds) {
    const s = await loadState(dataDir, id);
    if (s && s.userId === userId) out.push(s);
  }
  return out;
}
