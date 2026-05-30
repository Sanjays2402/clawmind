import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Tags are arbitrary user-defined labels attached to source paths. They are
// independent of namespaces (which are physical, ingestion-time partitions)
// and intended as a lightweight cross-cutting categorization layer: a single
// path can carry many tags, and tags are added or removed at query time
// without re-ingesting anything.
//
// Retrieval honours two optional filters per query:
//
//   includeTags: only consider hits whose source carries at least one
//                of the listed tags. This is a hard filter applied after
//                the hybrid merge but before reranking, which keeps the
//                lexical and dense candidate pools intact.
//
//   excludeTags: drop hits whose source carries any of the listed tags.
//                Stronger than mutes (which only down-weight) and intended
//                for "definitely not this stuff" scoping.
//
// Tag normalization: tags are lowercased, trimmed, and constrained to a
// safe identifier-ish character set so they round-trip through query
// strings, CLI flags, and JSON without surprises.

export interface TagMap {
  /** path -> sorted unique tag list */
  byPath: Record<string, string[]>;
}

function file(dataDir: string) { return join(dataDir, 'tags.json'); }

const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function normalizeTag(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!TAG_RE.test(t)) return null;
  return t;
}

export function normalizeTags(raw: readonly string[]): string[] {
  const out = new Set<string>();
  for (const r of raw) {
    const n = normalizeTag(r);
    if (n) out.add(n);
  }
  return [...out].sort();
}

export async function loadTags(dataDir: string): Promise<TagMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<TagMap>;
    return { byPath: parsed.byPath ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { byPath: {} };
    throw err;
  }
}

async function save(dataDir: string, map: TagMap) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(map, null, 2));
}

export async function setTags(
  dataDir: string,
  path: string,
  tags: readonly string[],
): Promise<string[]> {
  const map = await loadTags(dataDir);
  const norm = normalizeTags(tags);
  if (norm.length === 0) delete map.byPath[path];
  else map.byPath[path] = norm;
  await save(dataDir, map);
  return norm;
}

export async function addTags(
  dataDir: string,
  path: string,
  tags: readonly string[],
): Promise<string[]> {
  const map = await loadTags(dataDir);
  const cur = new Set(map.byPath[path] ?? []);
  for (const t of normalizeTags(tags)) cur.add(t);
  const next = [...cur].sort();
  if (next.length === 0) delete map.byPath[path];
  else map.byPath[path] = next;
  await save(dataDir, map);
  return next;
}

export async function removeTags(
  dataDir: string,
  path: string,
  tags: readonly string[],
): Promise<string[]> {
  const map = await loadTags(dataDir);
  const cur = new Set(map.byPath[path] ?? []);
  for (const t of normalizeTags(tags)) cur.delete(t);
  const next = [...cur].sort();
  if (next.length === 0) delete map.byPath[path];
  else map.byPath[path] = next;
  await save(dataDir, map);
  return next;
}

export function tagsFor(map: TagMap, path: string): string[] {
  return map.byPath[path] ?? [];
}

/** Inverse index: tag -> sorted unique path list. Useful for listings. */
export function pathsByTag(map: TagMap): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const [path, tags] of Object.entries(map.byPath)) {
    for (const t of tags) (out[t] ??= new Set()).add(path);
  }
  const final: Record<string, string[]> = {};
  for (const [t, set] of Object.entries(out)) final[t] = [...set].sort();
  return final;
}

/**
 * Build a per-hit predicate based on a query's tag filters. Returns null when
 * no filter is in effect so callers can skip the filtering pass entirely.
 */
export function buildTagFilter(
  map: TagMap,
  opts: { includeTags?: readonly string[]; excludeTags?: readonly string[] },
): ((path: string) => boolean) | null {
  const inc = normalizeTags(opts.includeTags ?? []);
  const exc = new Set(normalizeTags(opts.excludeTags ?? []));
  if (inc.length === 0 && exc.size === 0) return null;
  const incSet = new Set(inc);
  return (path: string) => {
    const tags = map.byPath[path];
    if (exc.size > 0 && tags && tags.some((t) => exc.has(t))) return false;
    if (incSet.size > 0) {
      if (!tags || !tags.some((t) => incSet.has(t))) return false;
    }
    return true;
  };
}
