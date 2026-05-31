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
  // Unix ms after which /s/<id> stops resolving. null/undefined means the
  // share has no expiry (legacy / explicit "never" shares).
  expiresAt?: number | null;
}

export interface ShareSummary {
  id: string;
  createdAt: number;
  query: string;
  views: number;
  url: string;
  expiresAt: number | null;
  expired: boolean;
}

function dir(dataDir: string) { return join(dataDir, 'shares'); }

// How long a share lives by default. Enterprise reviewers reject "public
// link forever" patterns, so the default is bounded. Override per call via
// createShare(... { ttlMs }) or pass null to opt out (e.g. for support
// runbooks that need a permanent link, gated elsewhere).
export const DEFAULT_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Hard cap so a caller cannot mint a "1000 year" link and defeat the policy.
export const MAX_SHARE_TTL_MS = 365 * 24 * 60 * 60 * 1000;    // 1 year

export function clampTtlMs(ttlMs: number | null | undefined): number | null {
  if (ttlMs === null) return null;
  if (ttlMs === undefined) return DEFAULT_SHARE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return DEFAULT_SHARE_TTL_MS;
  return Math.min(Math.floor(ttlMs), MAX_SHARE_TTL_MS);
}

export function isExpired(item: Pick<ShareItem, 'expiresAt'>, now = Date.now()): boolean {
  return typeof item.expiresAt === 'number' && item.expiresAt > 0 && now >= item.expiresAt;
}

export async function createShare(
  dataDir: string,
  body: Omit<ShareItem, 'id' | 'createdAt' | 'views' | 'expiresAt'> & {
    userId?: string | null;
    ttlMs?: number | null;
  },
): Promise<{ id: string; expiresAt: number | null }> {
  const id = nanoid(12);
  const file = join(dir(dataDir), `${id}.json`);
  await mkdir(dirname(file), { recursive: true });
  const ttl = clampTtlMs(body.ttlMs);
  const createdAt = Date.now();
  const expiresAt = ttl === null ? null : createdAt + ttl;
  const item: ShareItem = {
    id,
    createdAt,
    userId: body.userId ?? null,
    views: 0,
    query: body.query,
    answer: body.answer,
    sources: body.sources,
    expiresAt,
  };
  await writeFile(file, JSON.stringify(item, null, 2));
  return { id, expiresAt };
}

// Internal: returns the raw record regardless of expiry. The route layer
// uses this to distinguish "never existed" (404) from "expired" (410).
export async function readShareRaw(dataDir: string, id: string): Promise<ShareItem | null> {
  // Reject anything that looks like a path traversal attempt before we touch disk.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  try {
    const raw = await readFile(join(dir(dataDir), `${id}.json`), 'utf8');
    return JSON.parse(raw) as ShareItem;
  } catch { return null; }
}

export async function readShare(dataDir: string, id: string): Promise<ShareItem | null> {
  const item = await readShareRaw(dataDir, id);
  if (!item) return null;
  if (isExpired(item)) return null;
  return item;
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
  const now = Date.now();
  const out: ShareSummary[] = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const id = n.slice(0, -5);
    const item = await readShareRaw(dataDir, id);
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
      expiresAt: item.expiresAt ?? null,
      expired: isExpired(item, now),
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

export async function deleteShare(dataDir: string, id: string, userId: string): Promise<boolean> {
  // Owners can revoke their own shares even after expiry (so /shares cleanup
  // works without surprises). We bypass the expiry filter via readShareRaw.
  const item = await readShareRaw(dataDir, id);
  if (!item) return false;
  if (item.userId !== userId) return false;
  try {
    await unlink(join(dir(dataDir), `${id}.json`));
    return true;
  } catch {
    return false;
  }
}
