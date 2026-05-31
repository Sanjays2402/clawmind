import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

// Active session registry. Tracks every cookie session that has logged in so
// the user can see "where am I signed in" and force-logout one or all of
// them. The cookie session data itself stays in @fastify/session's in-memory
// store, which is fine for a single-node deploy. This registry is the
// enterprise-visible bit: an admin can audit and revoke without having to
// rotate the session secret.
//
// On-disk layout: <dataDir>/sessions.json, atomic-rewrite, schema below.
// We hash the raw sid before persisting so a leaked sessions.json file does
// not equal a leaked cookie. The hash is also what the auth preHandler
// compares on every request to detect a revoked session.

export const MAX_SESSIONS_PER_USER = 50;
export const MAX_LABEL_LEN = 200;

export interface SessionRecord {
  // sha256 of the raw cookie sid. Never store the raw sid here.
  sidHash: string;
  userId: string;
  // Display label for the UI: short user-agent string. Cap so the file
  // cannot be inflated by a hostile UA header.
  userAgent: string;
  ip: string;
  createdAt: number;
  lastSeenAt: number;
  // When set, the session has been revoked and auth must reject it even if
  // the cookie still decrypts. Kept as a tombstone for a window so the user
  // can see "revoked 2 minutes ago" in the UI; pruned by pruneExpired.
  revokedAt?: number;
}

interface RegistryFile {
  version: 1;
  sessions: SessionRecord[];
}

const REVOKED_RETENTION_MS = 24 * 60 * 60 * 1000;

export function hashSid(sid: string): string {
  return createHash('sha256').update(sid).digest('hex');
}

export function shortUserAgent(ua: string | undefined): string {
  if (!ua) return 'unknown client';
  return ua.slice(0, MAX_LABEL_LEN);
}

function registryPath(dataDir: string): string {
  return join(dataDir, 'sessions.json');
}

async function readRegistry(dataDir: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(registryPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return { version: 1, sessions: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, sessions: [] };
    }
    throw err;
  }
}

async function writeRegistry(dataDir: string, file: RegistryFile): Promise<void> {
  const p = registryPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

function pruneExpired(file: RegistryFile, now: number): RegistryFile {
  const cutoff = now - REVOKED_RETENTION_MS;
  const sessions = file.sessions.filter((s) => !s.revokedAt || s.revokedAt >= cutoff);
  return { ...file, sessions };
}

export async function recordLogin(
  dataDir: string,
  args: { sid: string; userId: string; ip: string; userAgent?: string },
): Promise<SessionRecord> {
  const now = Date.now();
  const sidHash = hashSid(args.sid);
  let file = await readRegistry(dataDir);
  file = pruneExpired(file, now);
  const rec: SessionRecord = {
    sidHash,
    userId: args.userId,
    userAgent: shortUserAgent(args.userAgent),
    ip: args.ip,
    createdAt: now,
    lastSeenAt: now,
  };
  // Drop any prior entry for the same sid (re-login on same cookie) then
  // cap per-user to avoid unbounded growth from a runaway client.
  const others = file.sessions.filter((s) => s.sidHash !== sidHash);
  const mine = others.filter((s) => s.userId === args.userId && !s.revokedAt);
  if (mine.length >= MAX_SESSIONS_PER_USER) {
    // Drop the oldest non-revoked session for this user.
    mine.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    const drop = new Set(mine.slice(0, mine.length - MAX_SESSIONS_PER_USER + 1).map((s) => s.sidHash));
    file.sessions = others.filter((s) => !drop.has(s.sidHash));
  } else {
    file.sessions = others;
  }
  file.sessions.push(rec);
  await writeRegistry(dataDir, file);
  return rec;
}

export async function touch(dataDir: string, sid: string): Promise<void> {
  const sidHash = hashSid(sid);
  const file = await readRegistry(dataDir);
  const rec = file.sessions.find((s) => s.sidHash === sidHash);
  if (!rec || rec.revokedAt) return;
  // Throttle disk writes: only persist if the last-seen drift is > 60s.
  const now = Date.now();
  if (now - rec.lastSeenAt < 60_000) return;
  rec.lastSeenAt = now;
  await writeRegistry(dataDir, file);
}

export async function isRevoked(dataDir: string, sid: string): Promise<boolean> {
  const sidHash = hashSid(sid);
  const file = await readRegistry(dataDir);
  const rec = file.sessions.find((s) => s.sidHash === sidHash);
  return Boolean(rec?.revokedAt);
}

export interface SessionView {
  id: string; // first 12 chars of sidHash, stable, safe to put in URLs
  userAgent: string;
  ip: string;
  createdAt: number;
  lastSeenAt: number;
  revokedAt?: number;
  current: boolean;
}

export async function listForUser(
  dataDir: string,
  userId: string,
  currentSid: string | undefined,
): Promise<SessionView[]> {
  const file = await readRegistry(dataDir);
  const currentHash = currentSid ? hashSid(currentSid) : null;
  return file.sessions
    .filter((s) => s.userId === userId)
    .map((s) => ({
      id: s.sidHash.slice(0, 12),
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      revokedAt: s.revokedAt,
      current: currentHash !== null && s.sidHash === currentHash,
    }))
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export async function revokeById(
  dataDir: string,
  userId: string,
  shortId: string,
): Promise<{ revoked: number }> {
  const file = await readRegistry(dataDir);
  let revoked = 0;
  const now = Date.now();
  for (const s of file.sessions) {
    if (s.userId === userId && !s.revokedAt && s.sidHash.startsWith(shortId)) {
      s.revokedAt = now;
      revoked += 1;
    }
  }
  if (revoked > 0) await writeRegistry(dataDir, file);
  return { revoked };
}

export async function revokeAllForUser(
  dataDir: string,
  userId: string,
  exceptSid: string | undefined,
): Promise<{ revoked: number }> {
  const file = await readRegistry(dataDir);
  const keepHash = exceptSid ? hashSid(exceptSid) : null;
  let revoked = 0;
  const now = Date.now();
  for (const s of file.sessions) {
    if (s.userId !== userId || s.revokedAt) continue;
    if (keepHash && s.sidHash === keepHash) continue;
    s.revokedAt = now;
    revoked += 1;
  }
  if (revoked > 0) await writeRegistry(dataDir, file);
  return { revoked };
}

export async function getBySid(
  dataDir: string,
  sid: string,
): Promise<SessionRecord | null> {
  const sidHash = hashSid(sid);
  const file = await readRegistry(dataDir);
  return file.sessions.find((s) => s.sidHash === sidHash) ?? null;
}

// Revoke a specific session by its raw sid. Used by the session-policy
// enforcement plugin so a session that has aged past the workspace cap
// is killed permanently the moment it tries to make a request, not just
// signed out for this one process.
export async function revokeBySid(
  dataDir: string,
  sid: string,
): Promise<{ revoked: boolean }> {
  const sidHash = hashSid(sid);
  const file = await readRegistry(dataDir);
  const rec = file.sessions.find((s) => s.sidHash === sidHash);
  if (!rec || rec.revokedAt) return { revoked: false };
  rec.revokedAt = Date.now();
  await writeRegistry(dataDir, file);
  return { revoked: true };
}

export async function removeBySid(dataDir: string, sid: string): Promise<void> {
  const sidHash = hashSid(sid);
  const file = await readRegistry(dataDir);
  const next = file.sessions.filter((s) => s.sidHash !== sidHash);
  if (next.length !== file.sessions.length) {
    await writeRegistry(dataDir, { ...file, sessions: next });
  }
}
