import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface HistoryItem {
  id: string;
  ts: number;
  userId: string;
  query: string;
  answer: string;
  sources: unknown[];
  model: string;
}

function file(dataDir: string) { return join(dataDir, 'history.jsonl'); }

export async function recordHistory(dataDir: string, item: HistoryItem) {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(item) + '\n', { flag: 'a' });
}

export async function listHistory(dataDir: string, userId: string, limit = 50): Promise<HistoryItem[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const items = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as HistoryItem);
    return items.filter((i) => i.userId === userId).slice(-limit).reverse();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}
