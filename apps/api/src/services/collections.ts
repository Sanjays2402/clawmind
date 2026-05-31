// Collections group a user's saved searches into named folders. The data
// model is intentionally separate from `saved.json` so this feature can ship
// without migrating the existing saved-search store: collections live in
// `collections.json` and the membership mapping (savedId -> collectionId)
// lives in `collection_members.json`. Each user owns their own collections;
// nothing crosses user boundaries.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

export interface Collection {
  id: string;
  userId: string;
  name: string;
  description: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionWithCount extends Collection {
  itemCount: number;
}

interface MemberRow {
  userId: string;
  savedId: string;
  collectionId: string;
  assignedAt: number;
}

const COLLECTIONS_FILE = 'collections.json';
const MEMBERS_FILE = 'collection_members.json';

const NAME_MAX = 80;
const DESC_MAX = 280;
// A small curated palette so the UI does not have to deal with arbitrary user
// input. If the caller hands us anything not in this list we fall back to the
// first entry so collections always have a stable accent.
const COLORS = ['slate', 'violet', 'emerald', 'amber', 'rose', 'sky'] as const;
type Color = (typeof COLORS)[number];

function normalizeColor(c: unknown): Color {
  return typeof c === 'string' && (COLORS as readonly string[]).includes(c) ? (c as Color) : COLORS[0];
}

function normalizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
}

function normalizeDescription(desc: unknown): string {
  if (typeof desc !== 'string') return '';
  return desc.trim().slice(0, DESC_MAX);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson<T>(path: string, value: T) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

function collectionsFile(dir: string) { return join(dir, COLLECTIONS_FILE); }
function membersFile(dir: string) { return join(dir, MEMBERS_FILE); }

async function readCollections(dir: string): Promise<Collection[]> {
  const raw = await readJson<unknown>(collectionsFile(dir), []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = r as Partial<Collection>;
      return {
        id: String(o.id ?? nanoid(8)),
        userId: String(o.userId ?? ''),
        name: normalizeName(o.name),
        description: normalizeDescription(o.description),
        color: normalizeColor(o.color),
        createdAt: Number(o.createdAt ?? Date.now()),
        updatedAt: Number(o.updatedAt ?? o.createdAt ?? Date.now()),
      };
    })
    .filter((c) => c.userId && c.name);
}

async function readMembers(dir: string): Promise<MemberRow[]> {
  const raw = await readJson<unknown>(membersFile(dir), []);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = r as Partial<MemberRow>;
      return {
        userId: String(o.userId ?? ''),
        savedId: String(o.savedId ?? ''),
        collectionId: String(o.collectionId ?? ''),
        assignedAt: Number(o.assignedAt ?? Date.now()),
      };
    })
    .filter((m) => m.userId && m.savedId && m.collectionId);
}

export async function listCollections(dir: string, userId: string): Promise<CollectionWithCount[]> {
  const [cols, members] = await Promise.all([readCollections(dir), readMembers(dir)]);
  const counts = new Map<string, number>();
  for (const m of members) {
    if (m.userId !== userId) continue;
    counts.set(m.collectionId, (counts.get(m.collectionId) ?? 0) + 1);
  }
  return cols
    .filter((c) => c.userId === userId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ ...c, itemCount: counts.get(c.id) ?? 0 }));
}

export async function getCollection(dir: string, userId: string, id: string): Promise<Collection | null> {
  const cols = await readCollections(dir);
  return cols.find((c) => c.userId === userId && c.id === id) ?? null;
}

export async function createCollection(
  dir: string,
  userId: string,
  body: { name: string; description?: string; color?: string },
): Promise<Collection> {
  const name = normalizeName(body.name);
  if (!name) throw new Error('name must be non-empty');
  const cols = await readCollections(dir);
  const dup = cols.find((c) => c.userId === userId && c.name.toLowerCase() === name.toLowerCase());
  if (dup) throw new Error('a collection with that name already exists');
  const now = Date.now();
  const next: Collection = {
    id: nanoid(8),
    userId,
    name,
    description: normalizeDescription(body.description),
    color: normalizeColor(body.color),
    createdAt: now,
    updatedAt: now,
  };
  cols.push(next);
  await writeJson(collectionsFile(dir), cols);
  return next;
}

export async function updateCollection(
  dir: string,
  userId: string,
  id: string,
  patch: { name?: string; description?: string; color?: string },
): Promise<Collection | null> {
  const cols = await readCollections(dir);
  const idx = cols.findIndex((c) => c.userId === userId && c.id === id);
  if (idx === -1) return null;
  const cur = cols[idx]!;
  const nextName = patch.name !== undefined ? normalizeName(patch.name) : cur.name;
  if (!nextName) throw new Error('name must be non-empty');
  if (patch.name !== undefined) {
    const dup = cols.find(
      (c) => c.userId === userId && c.id !== id && c.name.toLowerCase() === nextName.toLowerCase(),
    );
    if (dup) throw new Error('a collection with that name already exists');
  }
  const updated: Collection = {
    ...cur,
    name: nextName,
    description: patch.description !== undefined ? normalizeDescription(patch.description) : cur.description,
    color: patch.color !== undefined ? normalizeColor(patch.color) : cur.color,
    updatedAt: Date.now(),
  };
  cols[idx] = updated;
  await writeJson(collectionsFile(dir), cols);
  return updated;
}

export async function deleteCollection(dir: string, userId: string, id: string): Promise<boolean> {
  const cols = await readCollections(dir);
  const filtered = cols.filter((c) => !(c.userId === userId && c.id === id));
  if (filtered.length === cols.length) return false;
  await writeJson(collectionsFile(dir), filtered);
  // Drop membership rows that pointed at the removed collection. Anything
  // belonging to another user is left untouched.
  const members = await readMembers(dir);
  const nextMembers = members.filter((m) => !(m.userId === userId && m.collectionId === id));
  if (nextMembers.length !== members.length) {
    await writeJson(membersFile(dir), nextMembers);
  }
  return true;
}

export async function listMembers(dir: string, userId: string, collectionId: string): Promise<string[]> {
  const members = await readMembers(dir);
  return members
    .filter((m) => m.userId === userId && m.collectionId === collectionId)
    .sort((a, b) => b.assignedAt - a.assignedAt)
    .map((m) => m.savedId);
}

export async function setMembers(
  dir: string,
  userId: string,
  collectionId: string,
  savedIds: string[],
): Promise<string[]> {
  const exists = await getCollection(dir, userId, collectionId);
  if (!exists) throw new Error('collection not found');
  const unique = Array.from(new Set(savedIds.map((s) => s.trim()).filter(Boolean)));
  const members = await readMembers(dir);
  // Drop any prior rows for this (user, collection) pair, then reseat.
  const others = members.filter((m) => !(m.userId === userId && m.collectionId === collectionId));
  const now = Date.now();
  const fresh: MemberRow[] = unique.map((savedId) => ({ userId, savedId, collectionId, assignedAt: now }));
  await writeJson(membersFile(dir), [...others, ...fresh]);
  return unique;
}

export async function assignSavedToCollection(
  dir: string,
  userId: string,
  collectionId: string,
  savedId: string,
): Promise<boolean> {
  const exists = await getCollection(dir, userId, collectionId);
  if (!exists) throw new Error('collection not found');
  const members = await readMembers(dir);
  const already = members.some(
    (m) => m.userId === userId && m.collectionId === collectionId && m.savedId === savedId,
  );
  if (already) return false;
  members.push({ userId, savedId, collectionId, assignedAt: Date.now() });
  await writeJson(membersFile(dir), members);
  return true;
}

export async function removeSavedFromCollection(
  dir: string,
  userId: string,
  collectionId: string,
  savedId: string,
): Promise<boolean> {
  const members = await readMembers(dir);
  const next = members.filter(
    (m) => !(m.userId === userId && m.collectionId === collectionId && m.savedId === savedId),
  );
  if (next.length === members.length) return false;
  await writeJson(membersFile(dir), next);
  return true;
}

// Convenience used by the saved page: return a map of `savedId -> string[]`
// of collection ids the user has assigned them to. Lets the UI render
// per-row chips without a request per row.
export async function membershipForUser(
  dir: string,
  userId: string,
): Promise<Record<string, string[]>> {
  const members = await readMembers(dir);
  const out: Record<string, string[]> = {};
  for (const m of members) {
    if (m.userId !== userId) continue;
    (out[m.savedId] ||= []).push(m.collectionId);
  }
  return out;
}

export const __test = { COLORS };
