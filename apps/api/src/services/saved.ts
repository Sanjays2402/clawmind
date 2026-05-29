import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

export interface SavedItem { id: string; userId: string; title: string; query: string; createdAt: number; }

function file(dataDir: string) { return join(dataDir, 'saved.json'); }

async function readAll(dataDir: string): Promise<SavedItem[]> {
  try { return JSON.parse(await readFile(file(dataDir), 'utf8')) as SavedItem[]; }
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

export async function listSaved(dataDir: string, userId: string) {
  return (await readAll(dataDir)).filter((i) => i.userId === userId);
}

export async function addSaved(dataDir: string, userId: string, body: { title: string; query: string }) {
  const items = await readAll(dataDir);
  const item: SavedItem = { id: nanoid(8), userId, title: body.title, query: body.query, createdAt: Date.now() };
  items.push(item);
  await writeAll(dataDir, items);
  return item;
}

export async function removeSaved(dataDir: string, userId: string, id: string) {
  const items = (await readAll(dataDir)).filter((i) => !(i.userId === userId && i.id === id));
  await writeAll(dataDir, items);
}
