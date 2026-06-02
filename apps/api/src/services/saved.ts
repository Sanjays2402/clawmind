import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

export interface SavedItem {
  id: string;
  userId: string;
  title: string;
  query: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

function file(dataDir: string) { return join(dataDir, 'saved.json'); }

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const v = t.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 32);
    if (v && /^[a-z0-9][a-z0-9-]{0,31}$/.test(v)) out.add(v);
  }
  return [...out].sort().slice(0, 16);
}

function migrate(raw: unknown): SavedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = r as Partial<SavedItem> & { tags?: unknown };
    return {
      id: String(o.id ?? nanoid(8)),
      userId: String(o.userId ?? ''),
      title: String(o.title ?? ''),
      query: String(o.query ?? ''),
      tags: normalizeTags(o.tags),
      createdAt: Number(o.createdAt ?? Date.now()),
      updatedAt: Number(o.updatedAt ?? o.createdAt ?? Date.now()),
    };
  }).filter((i) => i.userId && i.title && i.query);
}

async function readAll(dataDir: string): Promise<SavedItem[]> {
  try { return migrate(JSON.parse(await readFile(file(dataDir), 'utf8'))); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(dataDir: string, items: SavedItem[]) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(items, null, 2));
}

export interface ListSavedFilter {
  /** Restrict to entries tagged with this normalized tag (case-insensitive). */
  tag?: string;
  /** Case-insensitive substring match against title and query. */
  q?: string;
}

export async function listSaved(
  dataDir: string,
  userId: string,
  filter: ListSavedFilter = {},
) {
  const owned = (await readAll(dataDir)).filter((i) => i.userId === userId);
  const tag = filter.tag?.trim().toLowerCase();
  const needle = filter.q?.trim().toLowerCase();
  return owned.filter((i) => {
    if (tag && !i.tags.includes(tag)) return false;
    if (needle) {
      const hay = `${i.title}\n${i.query}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export async function getSaved(
  dataDir: string,
  userId: string,
  id: string,
): Promise<SavedItem | null> {
  const items = await readAll(dataDir);
  return items.find((i) => i.id === id && i.userId === userId) ?? null;
}

export async function addSaved(
  dataDir: string,
  userId: string,
  body: { title: string; query: string; tags?: string[] },
) {
  const items = await readAll(dataDir);
  const now = Date.now();
  const item: SavedItem = {
    id: nanoid(8),
    userId,
    title: body.title.trim(),
    query: body.query.trim(),
    tags: normalizeTags(body.tags),
    createdAt: now,
    updatedAt: now,
  };
  items.push(item);
  await writeAll(dataDir, items);
  return item;
}

export async function updateSaved(
  dataDir: string,
  userId: string,
  id: string,
  patch: { title?: string; query?: string; tags?: string[] },
): Promise<SavedItem | null> {
  const items = await readAll(dataDir);
  const idx = items.findIndex((i) => i.id === id && i.userId === userId);
  if (idx === -1) return null;
  const cur = items[idx]!;
  const next: SavedItem = {
    ...cur,
    title: patch.title !== undefined ? patch.title.trim() : cur.title,
    query: patch.query !== undefined ? patch.query.trim() : cur.query,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : cur.tags,
    updatedAt: Date.now(),
  };
  if (!next.title || !next.query) throw new Error('title and query must be non-empty');
  items[idx] = next;
  await writeAll(dataDir, items);
  return next;
}

export async function removeSaved(dataDir: string, userId: string, id: string) {
  const items = (await readAll(dataDir)).filter((i) => !(i.userId === userId && i.id === id));
  await writeAll(dataDir, items);
}
