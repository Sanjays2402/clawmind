import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';

// API keys for programmatic clients (CLI, scripts, the watcher daemon).
//
// On creation we generate a 256-bit random secret, prefix it with `cm_` so it
// is obvious in logs, and store only its sha256 in keys.json. The plaintext
// secret is shown exactly once. Lookup is constant-time on the digest.
//
// Each key carries a role ('owner' or 'reader'), a label for humans, the user
// it was issued to, and an optional expiry. We track lastUsedAt so dormant
// keys can be reaped.

export const KEY_PREFIX = 'cm_';
export type KeyRole = 'owner' | 'reader';

// Scopes restrict an API key to a subset of resources. The format is a small
// 'resource:action' grammar (e.g. 'search:read', 'ingest:write'), with the
// special wildcard '*' meaning "every scope" so an unscoped key keeps the
// pre-scope behaviour. Scopes compose with the role: a 'reader' key with
// scope ['ingest:write'] still cannot mutate because role gates the verb,
// while an 'owner' key with scope ['search:read'] is restricted to read-only
// search even though its role would otherwise allow more.
export const WILDCARD_SCOPE = '*';
export const SCOPE_RE = /^[a-z][a-z0-9-]*:(read|write|admin)$/;

export function isValidScope(scope: string): boolean {
  return scope === WILDCARD_SCOPE || SCOPE_RE.test(scope);
}

/**
 * Return true if the granted scope list satisfies the requested scope.
 * Empty/missing granted means unscoped (legacy keys) and satisfies
 * everything. Otherwise a key matches when its list contains '*' or the
 * exact requested scope.
 */
export function hasScope(granted: string[] | undefined | null, requested: string): boolean {
  if (!granted || granted.length === 0) return true;
  if (granted.includes(WILDCARD_SCOPE)) return true;
  return granted.includes(requested);
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  label: string;
  role: KeyRole;
  hash: string;            // sha256 hex of the plaintext secret
  scopes?: string[];       // optional allowlist; undefined/empty == unrestricted
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  // Rotation support. When a key is rotated we issue a new secret but keep
  // the previous hash valid for a short grace window so clients can swap the
  // credential without an outage. Cleared once the grace expires.
  rotatedAt?: number | null;
  previousHash?: string | null;
  previousHashExpiresAt?: number | null;
  // Optional per-key rate limit. When set, the auth layer enforces a token
  // bucket of `max` requests per `windowMs` milliseconds keyed on this key
  // id. Returns 429 with standard X-RateLimit-* headers. When undefined the
  // global limiter from server.ts applies unchanged.
  rateLimit?: { max: number; windowMs: number } | null;
}

export const MIN_RATE_WINDOW_MS = 1_000;
export const MAX_RATE_WINDOW_MS = 24 * 60 * 60_000;
export const MIN_RATE_MAX = 1;
export const MAX_RATE_MAX = 1_000_000;

export function isValidRateLimit(r: { max: number; windowMs: number }): boolean {
  return (
    Number.isInteger(r.max) && r.max >= MIN_RATE_MAX && r.max <= MAX_RATE_MAX &&
    Number.isInteger(r.windowMs) && r.windowMs >= MIN_RATE_WINDOW_MS && r.windowMs <= MAX_RATE_WINDOW_MS
  );
}

/**
 * Update or clear the per-key rate limit. Returns the updated record or
 * null if the key is not owned by the user, revoked, or expired. Pass
 * `limit: null` to remove a previously configured limit.
 */
export async function setKeyRateLimit(
  dataDir: string,
  userId: string,
  id: string,
  limit: { max: number; windowMs: number } | null,
  now: number = Date.now(),
): Promise<ApiKeyRecord | null> {
  if (limit && !isValidRateLimit(limit)) throw new Error('invalid rate limit');
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = { ...cur, rateLimit: limit };
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

// Default grace period after rotation during which the old secret still
// verifies. Long enough for a CI run or deploy to catch up, short enough
// that a leaked old secret stops working quickly.
export const DEFAULT_ROTATION_GRACE_MS = 10 * 60_000;

function file(dataDir: string) { return join(dataDir, 'api-keys.json'); }

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export async function loadKeys(dataDir: string): Promise<ApiKeyRecord[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as ApiKeyRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveKeys(dataDir: string, keys: ApiKeyRecord[]): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(keys, null, 2));
}

export interface IssueInput {
  userId: string;
  label: string;
  role?: KeyRole;
  scopes?: string[];
  ttlMs?: number | null;
  now?: number;
}

export interface IssuedKey {
  record: ApiKeyRecord;
  secret: string;          // plaintext, prefix included; only returned here
}

export async function issueKey(dataDir: string, input: IssueInput): Promise<IssuedKey> {
  const now = input.now ?? Date.now();
  const secret = KEY_PREFIX + randomBytes(32).toString('hex');
  let scopes: string[] | undefined;
  if (input.scopes && input.scopes.length > 0) {
    for (const s of input.scopes) {
      if (!isValidScope(s)) throw new Error(`invalid scope: ${s}`);
    }
    // Dedupe and sort so saved records compare cleanly.
    scopes = [...new Set(input.scopes)].sort();
  }
  const record: ApiKeyRecord = {
    id: nanoid(10),
    userId: input.userId,
    label: input.label,
    role: input.role ?? 'owner',
    hash: hashSecret(secret),
    scopes,
    createdAt: now,
    expiresAt: input.ttlMs ? now + input.ttlMs : null,
    lastUsedAt: null,
    revokedAt: null,
  };
  const all = await loadKeys(dataDir);
  all.push(record);
  await saveKeys(dataDir, all);
  return { record, secret };
}

export async function listKeys(dataDir: string, userId: string): Promise<ApiKeyRecord[]> {
  const all = await loadKeys(dataDir);
  return all.filter((k) => k.userId === userId);
}

export async function revokeKey(dataDir: string, userId: string, id: string): Promise<boolean> {
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return false;
  const k = all[idx]!;
  if (k.revokedAt) return true;
  all[idx] = { ...k, revokedAt: Date.now() };
  await saveKeys(dataDir, all);
  return true;
}

export interface VerifyResult {
  ok: true;
  record: ApiKeyRecord;
}
export interface VerifyFail {
  ok: false;
  reason: 'malformed' | 'unknown' | 'revoked' | 'expired';
}
export type VerifyOutcome = VerifyResult | VerifyFail;

export async function verifySecret(
  dataDir: string,
  presented: string | undefined | null,
  now: number = Date.now(),
): Promise<VerifyOutcome> {
  if (!presented || !presented.startsWith(KEY_PREFIX) || presented.length < KEY_PREFIX.length + 32) {
    return { ok: false, reason: 'malformed' };
  }
  const digest = hashSecret(presented);
  const all = await loadKeys(dataDir);
  // Match current hash first, then the previous hash if it is still within
  // its post-rotation grace window. Anything past the grace window is treated
  // as unknown so callers see a clean 401 instead of a stale-key surprise.
  let match = all.find((k) => constantTimeEqualHex(k.hash, digest));
  if (!match) {
    match = all.find(
      (k) =>
        k.previousHash != null &&
        k.previousHashExpiresAt != null &&
        k.previousHashExpiresAt > now &&
        constantTimeEqualHex(k.previousHash, digest),
    );
  }
  if (!match) return { ok: false, reason: 'unknown' };
  if (match.revokedAt) return { ok: false, reason: 'revoked' };
  if (match.expiresAt && now > match.expiresAt) return { ok: false, reason: 'expired' };
  // Fire-and-forget lastUsedAt bump.
  match.lastUsedAt = now;
  void saveKeys(dataDir, all).catch(() => undefined);
  return { ok: true, record: match };
}

export interface RotateInput {
  graceMs?: number;
  now?: number;
}

export interface RotatedKey {
  record: ApiKeyRecord;
  secret: string;          // plaintext, prefix included; only returned here
  previousExpiresAt: number | null;
}

/**
 * Rotate an existing key in place. Generates a new secret, demotes the
 * current hash to `previousHash` for a short grace window so callers can
 * swap the credential without downtime, and returns the new plaintext. The
 * key id, label, role, scopes, and expiry are preserved so consumers can
 * keep their bookkeeping pointing at the same record.
 *
 * Returns null when the key is not owned by the user, was revoked, or has
 * expired. Routes translate that into a 404 or 409 as appropriate.
 */
export async function rotateKey(
  dataDir: string,
  userId: string,
  id: string,
  input: RotateInput = {},
): Promise<RotatedKey | null> {
  const now = input.now ?? Date.now();
  const graceMs = input.graceMs ?? DEFAULT_ROTATION_GRACE_MS;
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const current = all[idx]!;
  if (current.revokedAt) return null;
  if (current.expiresAt && now > current.expiresAt) return null;
  const secret = KEY_PREFIX + randomBytes(32).toString('hex');
  const previousExpiresAt = graceMs > 0 ? now + graceMs : null;
  const rotated: ApiKeyRecord = {
    ...current,
    hash: hashSecret(secret),
    rotatedAt: now,
    previousHash: graceMs > 0 ? current.hash : null,
    previousHashExpiresAt: previousExpiresAt,
  };
  all[idx] = rotated;
  await saveKeys(dataDir, all);
  return { record: rotated, secret, previousExpiresAt };
}

/** Strip the secret out of a record for safe API responses. */
export function redact(rec: ApiKeyRecord) {
  return {
    id: rec.id,
    userId: rec.userId,
    label: rec.label,
    role: rec.role,
    scopes: rec.scopes ?? null,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    lastUsedAt: rec.lastUsedAt,
    revokedAt: rec.revokedAt,
    rotatedAt: rec.rotatedAt ?? null,
    // Surface only whether a grace window is active and when it ends. Never
    // surface the previous hash itself.
    previousHashExpiresAt:
      rec.previousHash && rec.previousHashExpiresAt && rec.previousHashExpiresAt > Date.now()
        ? rec.previousHashExpiresAt
        : null,
    rateLimit: rec.rateLimit ?? null,
  };
}
