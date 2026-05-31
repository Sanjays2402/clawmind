import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { Conversation } from './conversations.js';
import type { HistoryItem } from './history.js';
import type { SavedItem } from './saved.js';
import type { FeedbackMap } from './feedback.js';
import type { ApiKeyRecord } from './api-keys.js';

// Data lifecycle (GDPR). Two operations:
//
//   exportUserData(dataDir, userId)  -> bundle of every per-user record
//   deleteUserData(dataDir, userId)  -> erase every per-user record, return counts
//
// We deliberately only touch records that have a `userId` field. Workspace
// scoped stores (pins, mutes, aliases, tags, the ingest manifest, the
// embedding index) are shared across users and survive the wipe. API key
// records are owned per user so they are included.

interface FilePaths {
  history: string;
  conversationsDir: string;
  saved: string;
  feedback: string;
  apiKeys: string;
}

function paths(dataDir: string): FilePaths {
  return {
    history: join(dataDir, 'history.jsonl'),
    conversationsDir: join(dataDir, 'conversations'),
    saved: join(dataDir, 'saved.json'),
    feedback: join(dataDir, 'feedback.json'),
    apiKeys: join(dataDir, 'api-keys.json'),
  };
}

async function readJsonl<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJsonl<T>(file: string, items: T[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const body = items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : '');
  await writeFile(file, body);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
}

export interface UserDataExport {
  schema: 'clawmind.user-export.v1';
  exportedAt: number;
  userId: string;
  history: HistoryItem[];
  conversations: Conversation[];
  saved: SavedItem[];
  feedback: Array<{ path: string; vote: 1 | -1; updatedAt: number }>;
  apiKeys: Array<Omit<ApiKeyRecord, 'hash'>>;
}

export async function exportUserData(dataDir: string, userId: string): Promise<UserDataExport> {
  const p = paths(dataDir);

  const allHistory = await readJsonl<HistoryItem>(p.history);
  const history = allHistory.filter((h) => h.userId === userId);

  const conversations: Conversation[] = [];
  try {
    const files = await readdir(p.conversationsDir);
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const conv = await readJson<Conversation | null>(join(p.conversationsDir, name), null);
      if (conv && conv.userId === userId) conversations.push(conv);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const allSaved = await readJson<SavedItem[]>(p.saved, []);
  const saved = allSaved.filter((s) => s.userId === userId);

  const fbMap = await readJson<FeedbackMap>(p.feedback, {});
  const feedback: UserDataExport['feedback'] = [];
  for (const entry of Object.values(fbMap)) {
    const vote = entry.byUser?.[userId];
    if (vote === 1 || vote === -1) {
      feedback.push({ path: entry.path, vote, updatedAt: entry.updatedAt });
    }
  }

  const allKeys = await readJson<ApiKeyRecord[]>(p.apiKeys, []);
  const apiKeys = allKeys
    .filter((k) => k.userId === userId)
    .map(({ hash: _hash, ...rest }) => rest);

  return {
    schema: 'clawmind.user-export.v1',
    exportedAt: Date.now(),
    userId,
    history,
    conversations,
    saved,
    feedback,
    apiKeys,
  };
}

export interface DeletionReport {
  userId: string;
  deletedAt: number;
  removed: {
    historyItems: number;
    conversations: number;
    savedItems: number;
    feedbackVotes: number;
    apiKeys: number;
  };
}

export interface DeletionPreview {
  schema: 'clawmind.user-deletion-preview.v1';
  userId: string;
  dryRun: true;
  previewedAt: number;
  /** Counts that the equivalent non-dry-run call would report as removed. */
  wouldRemove: DeletionReport['removed'];
}

/**
 * Count exactly what `deleteUserData` would remove, without writing anything.
 * Reads the same files as the real deletion path so the preview cannot drift
 * from what would actually happen. Safe to call repeatedly.
 */
export async function previewUserDataDeletion(
  dataDir: string,
  userId: string,
): Promise<DeletionPreview> {
  const p = paths(dataDir);

  const allHistory = await readJsonl<HistoryItem>(p.history);
  const historyItems = allHistory.filter((h) => h.userId === userId).length;

  let conversations = 0;
  try {
    const files = await readdir(p.conversationsDir);
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const conv = await readJson<Conversation | null>(join(p.conversationsDir, name), null);
      if (conv && conv.userId === userId) conversations += 1;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const allSaved = await readJson<SavedItem[]>(p.saved, []);
  const savedItems = allSaved.filter((s) => s.userId === userId).length;

  const fbMap = await readJson<FeedbackMap>(p.feedback, {});
  let feedbackVotes = 0;
  for (const entry of Object.values(fbMap)) {
    const vote = entry.byUser?.[userId];
    if (vote === 1 || vote === -1) feedbackVotes += 1;
  }

  const allKeys = await readJson<ApiKeyRecord[]>(p.apiKeys, []);
  const apiKeys = allKeys.filter((k) => k.userId === userId).length;

  return {
    schema: 'clawmind.user-deletion-preview.v1',
    userId,
    dryRun: true,
    previewedAt: Date.now(),
    wouldRemove: { historyItems, conversations, savedItems, feedbackVotes, apiKeys },
  };
}

export async function deleteUserData(dataDir: string, userId: string): Promise<DeletionReport> {
  const p = paths(dataDir);
  const removed = {
    historyItems: 0,
    conversations: 0,
    savedItems: 0,
    feedbackVotes: 0,
    apiKeys: 0,
  };

  // history.jsonl: rewrite without the user's lines
  const allHistory = await readJsonl<HistoryItem>(p.history);
  const keepHistory = allHistory.filter((h) => h.userId !== userId);
  removed.historyItems = allHistory.length - keepHistory.length;
  if (removed.historyItems > 0) await writeJsonl(p.history, keepHistory);

  // conversations/<id>.json: unlink per-user files
  try {
    const files = await readdir(p.conversationsDir);
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const fp = join(p.conversationsDir, name);
      const conv = await readJson<Conversation | null>(fp, null);
      if (conv && conv.userId === userId) {
        await unlink(fp);
        removed.conversations += 1;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  // saved.json
  const allSaved = await readJson<SavedItem[]>(p.saved, []);
  const keepSaved = allSaved.filter((s) => s.userId !== userId);
  removed.savedItems = allSaved.length - keepSaved.length;
  if (removed.savedItems > 0) await writeJson(p.saved, keepSaved);

  // feedback.json: strip the user's vote from each entry, adjust counts,
  // drop entries that go to zero. This preserves the shared boost map for
  // other users while erasing this user's contribution.
  const fbMap = await readJson<FeedbackMap>(p.feedback, {});
  let fbDirty = false;
  for (const [path, entry] of Object.entries(fbMap)) {
    const vote = entry.byUser?.[userId];
    if (vote === 1 || vote === -1) {
      if (vote === 1) entry.ups = Math.max(0, entry.ups - 1);
      else entry.downs = Math.max(0, entry.downs - 1);
      delete entry.byUser[userId];
      entry.updatedAt = Date.now();
      removed.feedbackVotes += 1;
      fbDirty = true;
      if (entry.ups === 0 && entry.downs === 0 && Object.keys(entry.byUser).length === 0) {
        delete fbMap[path];
      }
    }
  }
  if (fbDirty) await writeJson(p.feedback, fbMap);

  // api-keys.json: drop every key issued to this user. The plugin auth path
  // verifies on every request via loadKeys, so removed keys stop working on
  // the next call.
  const allKeys = await readJson<ApiKeyRecord[]>(p.apiKeys, []);
  const keepKeys = allKeys.filter((k) => k.userId !== userId);
  removed.apiKeys = allKeys.length - keepKeys.length;
  if (removed.apiKeys > 0) await writeJson(p.apiKeys, keepKeys);

  return { userId, deletedAt: Date.now(), removed };
}
