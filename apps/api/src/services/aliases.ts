import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Source aliases give the user short, memorable names for long workspace
// paths. They are useful in two places:
//
//   1. Query text: a token like "@notes/foo.md" or "@notes" is rewritten to
//      the real path before retrieval, letting the user scope a question to
//      a folder without typing a full POSIX path.
//   2. Citation rendering: when an alias is the longest prefix match for a
//      cited path, the shortened form is returned as `displayPath` so UIs
//      can show "@notes/foo.md" beside the raw path.
//
// Alias names are restricted to a small, URL-safe charset so we can put
// them inline in queries without quoting headaches.

export const ALIAS_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

export interface AliasEntry {
  name: string;
  path: string; // absolute or workspace-relative; treated as a string prefix
  createdAt: number;
  createdBy: string;
}

export type AliasMap = Record<string, AliasEntry>;

function file(dataDir: string) { return join(dataDir, 'aliases.json'); }

export async function loadAliases(dataDir: string): Promise<AliasMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as AliasMap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function save(dataDir: string, map: AliasMap) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(map, null, 2));
}

export async function addAlias(
  dataDir: string,
  userId: string,
  name: string,
  path: string,
): Promise<AliasEntry> {
  if (!ALIAS_NAME_RE.test(name)) {
    throw new Error(`invalid alias name: ${name}`);
  }
  const trimmed = path.replace(/\/+$/, ''); // store without trailing slashes
  if (!trimmed) throw new Error('alias path must be non-empty');
  const map = await loadAliases(dataDir);
  const entry: AliasEntry = {
    name,
    path: trimmed,
    createdAt: Date.now(),
    createdBy: userId,
  };
  map[name] = entry;
  await save(dataDir, map);
  return entry;
}

export async function removeAlias(dataDir: string, name: string): Promise<boolean> {
  const map = await loadAliases(dataDir);
  if (!(name in map)) return false;
  delete map[name];
  await save(dataDir, map);
  return true;
}

/**
 * Expand `@alias` and `@alias/sub/file` tokens in a query string to their
 * full path. Unknown aliases are left untouched so a stray "@" in prose
 * does not break a query. The match is greedy on alphanumerics, dashes,
 * and underscores so an alias name boundary is unambiguous.
 */
export function expandQueryAliases(map: AliasMap, q: string): string {
  return q.replace(/@([A-Za-z0-9_-]+)((?:\/[^\s]*)?)/g, (whole, name: string, rest: string) => {
    const entry = map[name];
    if (!entry) return whole;
    return entry.path + (rest || '');
  });
}

/**
 * Return the longest-prefix alias for a path so callers can render
 * "@notes/foo.md" instead of a 90-character home-directory path. Returns
 * `null` when no alias is a prefix of `path`.
 */
export function shortenPath(map: AliasMap, path: string): string | null {
  let best: AliasEntry | null = null;
  for (const entry of Object.values(map)) {
    const p = entry.path;
    if (path === p) {
      if (!best || p.length > best.path.length) best = entry;
      continue;
    }
    if (path.startsWith(p + '/') && (!best || p.length > best.path.length)) {
      best = entry;
    }
  }
  if (!best) return null;
  if (path === best.path) return '@' + best.name;
  return '@' + best.name + path.slice(best.path.length);
}
