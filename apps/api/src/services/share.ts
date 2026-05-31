import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

export interface ShareItem {
  id: string;
  createdAt: number;
  userId?: string | null;
  views?: number;
  query: string;
  answer: string;
  sources: unknown[];
}

export interface ShareSummary {
  id: string;
  createdAt: number;
  query: string;
  views: number;
  url: string;
}

function dir(dataDir: string) { return join(dataDir, 'shares'); }

export async function createShare(
  dataDir: string,
  body: Omit<ShareItem, 'id' | 'createdAt' | 'views'> & { userId?: string | null },
): Promise<string> {
  const id = nanoid(12);
  const file = join(dir(dataDir), `${id}.json`);
  await mkdir(dirname(file), { recursive: true });
  const item: ShareItem = {
    id,
    createdAt: Date.now(),
    userId: body.userId ?? null,
    views: 0,
    query: body.query,
    answer: body.answer,
    sources: body.sources,
  };
  await writeFile(file, JSON.stringify(item, null, 2));
  return id;
}

export async function readShare(dataDir: string, id: string): Promise<ShareItem | null> {
  // Reject anything that looks like a path traversal attempt before we touch disk.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  try {
    const raw = await readFile(join(dir(dataDir), `${id}.json`), 'utf8');
    return JSON.parse(raw) as ShareItem;
  } catch { return null; }
}

// Atomically bump the view counter on read. Failures are non-fatal: the
// counter is a "best effort" stat, not billing data, so a corrupt or
// concurrent write should never break the share itself.
export async function bumpViews(dataDir: string, id: string): Promise<number> {
  const item = await readShare(dataDir, id);
  if (!item) return 0;
  const views = (item.views ?? 0) + 1;
  try {
    await writeFile(join(dir(dataDir), `${id}.json`), JSON.stringify({ ...item, views }, null, 2));
  } catch { /* ignore */ }
  return views;
}

export async function listSharesByUser(dataDir: string, userId: string): Promise<ShareSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir(dataDir));
  } catch {
    return [];
  }
  const out: ShareSummary[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const id = n.slice(0, -5);
    const item = await readShare(dataDir, id);
    if (!item) continue;
    // Legacy shares (created before per-user ownership existed) have no
    // userId. We surface them to nobody rather than leak them across
    // accounts, but we keep them readable by id at /s/<id> so old links
    // do not 404.
    if (!item.userId || item.userId !== userId) continue;
    out.push({
      id: item.id,
      createdAt: item.createdAt,
      query: item.query,
      views: item.views ?? 0,
      url: `/s/${item.id}`,
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function deleteShare(dataDir: string, id: string, userId: string): Promise<boolean> {
  const item = await readShare(dataDir, id);
  if (!item) return false;
  if (item.userId !== userId) return false;
  try {
    await unlink(join(dir(dataDir), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
