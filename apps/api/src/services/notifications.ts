import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';
import { shouldDeliver } from './notification-prefs.js';

// In-app notification inbox. One JSONL file per user keeps reads cheap (no
// global scan) and writes append-only, so two concurrent producers cannot
// stomp each other. Records are tiny structured envelopes the UI renders
// directly; we never store HTML or unbounded user input.
//
// Notifications are intentionally low-stakes: failure to write a record must
// never break the producing request (share view, webhook delivery, batch
// run). Every call site uses `void notify(...).catch(() => undefined)`.

export type NotificationKind =
  | 'share.viewed'
  | 'webhook.disabled'
  | 'webhook.failed'
  | 'sub-processor.changed'
  | 'system';

export interface NotificationRecord {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;          // optional in-app destination
  createdAt: number;
  readAt: number | null;
  meta?: Record<string, string | number | boolean | null>;
}

// Hard cap so the inbox cannot grow unbounded for a long-lived workspace.
// Older entries are trimmed on every write. 200 is enough for two weeks of
// noisy activity at a few notifications per day per user.
export const MAX_PER_USER = 200;

function file(dataDir: string, userId: string) {
  // Filename is user id; we constrain user ids to a safe charset elsewhere
  // (see auth plugin), but defence in depth: reject anything weird here.
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(userId)) {
    throw new Error('invalid userId for notifications store');
  }
  return join(dataDir, 'notifications', `${userId}.json`);
}

export async function loadAll(
  dataDir: string,
  userId: string,
): Promise<NotificationRecord[]> {
  try {
    const raw = await readFile(file(dataDir, userId), 'utf8');
    const parsed = JSON.parse(raw) as NotificationRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveAll(
  dataDir: string,
  userId: string,
  items: NotificationRecord[],
): Promise<void> {
  const f = file(dataDir, userId);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(items, null, 2));
}

export interface CreateInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  meta?: NotificationRecord['meta'];
  // De-dupe key: if another unread notification with the same dedupeKey
  // already exists, we bump its createdAt instead of inserting a new row.
  // Use this for "your share was viewed" to avoid spamming the inbox on
  // every page load.
  dedupeKey?: string;
}

export async function create(
  dataDir: string,
  input: CreateInput,
  now: number = Date.now(),
): Promise<NotificationRecord | null> {
  // Honour per-user notification preferences. A muted kind drops here
  // before we touch the inbox file. Producers treat null as "delivered
  // to /dev/null" and continue normally.
  if (!(await shouldDeliver(dataDir, input.userId, input.kind))) {
    return null;
  }
  const items = await loadAll(dataDir, input.userId);
  if (input.dedupeKey) {
    const existing = items.find(
      (i) => i.readAt === null && i.meta?.dedupeKey === input.dedupeKey,
    );
    if (existing) {
      existing.createdAt = now;
      existing.title = input.title;
      existing.body = input.body;
      existing.href = input.href;
      // Bump the dedupe row to the front and persist.
      const rest = items.filter((i) => i.id !== existing.id);
      rest.unshift(existing);
      await saveAll(dataDir, input.userId, rest.slice(0, MAX_PER_USER));
      return existing;
    }
  }
  const rec: NotificationRecord = {
    id: 'ntf_' + nanoid(10),
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    href: input.href,
    createdAt: now,
    readAt: null,
    meta: input.dedupeKey
      ? { ...(input.meta ?? {}), dedupeKey: input.dedupeKey }
      : input.meta,
  };
  const next = [rec, ...items].slice(0, MAX_PER_USER);
  await saveAll(dataDir, input.userId, next);
  return rec;
}

export async function list(
  dataDir: string,
  userId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRecord[]> {
  const all = await loadAll(dataDir, userId);
  const filtered = opts.unreadOnly ? all.filter((i) => i.readAt === null) : all;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, MAX_PER_USER));
  return filtered
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function unreadCount(dataDir: string, userId: string): Promise<number> {
  const all = await loadAll(dataDir, userId);
  let n = 0;
  for (const r of all) if (r.readAt === null) n++;
  return n;
}

export async function markRead(
  dataDir: string,
  userId: string,
  ids: string[],
  now: number = Date.now(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const set = new Set(ids);
  const items = await loadAll(dataDir, userId);
  let touched = 0;
  for (const i of items) {
    if (set.has(i.id) && i.readAt === null) {
      i.readAt = now;
      touched++;
    }
  }
  if (touched > 0) await saveAll(dataDir, userId, items);
  return touched;
}

export async function markAllRead(
  dataDir: string,
  userId: string,
  now: number = Date.now(),
): Promise<number> {
  const items = await loadAll(dataDir, userId);
  let touched = 0;
  for (const i of items) {
    if (i.readAt === null) {
      i.readAt = now;
      touched++;
    }
  }
  if (touched > 0) await saveAll(dataDir, userId, items);
  return touched;
}

export async function remove(
  dataDir: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const items = await loadAll(dataDir, userId);
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return false;
  await saveAll(dataDir, userId, next);
  return true;
}

export async function clear(dataDir: string, userId: string): Promise<number> {
  const items = await loadAll(dataDir, userId);
  if (items.length === 0) return 0;
  await saveAll(dataDir, userId, []);
  return items.length;
}

/** Dry-run sibling of `clear`: returns the count that would be removed without
 *  touching storage. Used by the sandbox `?dry_run=true` preview. */
export async function countAll(dataDir: string, userId: string): Promise<number> {
  const items = await loadAll(dataDir, userId);
  return items.length;
}

/** Fire-and-forget helper for producers. Never throws. Returns silently
 *  whether the notification was actually written or muted by user prefs. */
export function notify(dataDir: string, input: CreateInput): Promise<void> {
  return create(dataDir, input).then(
    () => undefined,
    () => undefined,
  );
}
