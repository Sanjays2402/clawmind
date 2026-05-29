import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

export interface ShareItem { id: string; createdAt: number; query: string; answer: string; sources: unknown[]; }

function dir(dataDir: string) { return join(dataDir, 'shares'); }

export async function createShare(dataDir: string, body: Omit<ShareItem, 'id' | 'createdAt'>): Promise<string> {
  const id = nanoid(12);
  const file = join(dir(dataDir), `${id}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ id, createdAt: Date.now(), ...body }, null, 2));
  return id;
}

export async function readShare(dataDir: string, id: string): Promise<ShareItem | null> {
  try {
    const raw = await readFile(join(dir(dataDir), `${id}.json`), 'utf8');
    return JSON.parse(raw) as ShareItem;
  } catch { return null; }
}
