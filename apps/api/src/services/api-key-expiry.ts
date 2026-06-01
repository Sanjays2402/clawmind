import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ApiKeyRecord } from './api-keys.js';

// Workspace API-key expiry-warning policy. SOC2 CC6.1 / ISO27001 A.9.2.6
// require that authentication credentials with a fixed lifetime have a
// documented rotation runbook before they lapse. Customers integrating
// against the API need a machine-readable advance notice so their CI
// pipelines and SDKs can rotate before the underlying credential dies
// and breaks production.
//
// This is a separate axis from inactivity (see api-key-inactivity.ts).
// Inactivity revokes keys that have not been called in a while; expiry
// covers keys with a hard TTL set at issue time. A key can be perfectly
// active and still be one day from expiring.
//
// Behaviour, all enforced elsewhere but the policy is the source of
// truth:
//
//   * On every successful API-key authentication, when expiresAt is
//     within warnDays of now, the auth plugin emits
//       X-ClawMind-Api-Key-Expires-At        ISO timestamp
//       X-ClawMind-Api-Key-Expires-In-Days   integer, floored, can be 0
//       Warning: 299 - "API key expires in N day(s)"
//     so any SDK can detect the warning without parsing custom headers.
//
//   * The first request that crosses into the warning window writes a
//     single audit entry `api-key.expiry_warned`; subsequent requests
//     are silent until the policy or the key's expiresAt changes (the
//     "lastWarnedAt" anchor is stored on the key itself; the auth
//     plugin updates it via api-keys.touchExpiryWarning).
//
//   * The admin route `GET /v1/api-key-expiry/upcoming` lists every
//     active key that will expire within the window, with the resolved
//     daysRemaining so an operator can rotate ahead of time.
//
// Persisted at <dataDir>/api-key-expiry.json, atomic tmp+rename.
// Mirrors api-key-inactivity.ts file layout so multi-workspace forks
// can add their own scoping without a migration.

const FILE = 'api-key-expiry.json';
const DEFAULT_WORKSPACE = 'default';

export const MAX_WARN_DAYS = 365;
const DAY_MS = 24 * 60 * 60_000;

export interface ApiKeyExpiryPolicy {
  workspaceId: string;
  // 0 disables expiry warnings entirely. The default of 14 mirrors the
  // most common enterprise rotation SLA we see in vendor reviews.
  warnDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

interface FileShape {
  version: 1;
  policies: ApiKeyExpiryPolicy[];
}

function path(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): ApiKeyExpiryPolicy {
  return {
    workspaceId,
    warnDays: 14,
    updatedAt: now,
    updatedBy: null,
  };
}

async function loadAll(dataDir: string): Promise<FileShape> {
  try {
    const raw = await readFile(path(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.policies)) {
      return { version: 1, policies: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, policies: [] };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: FileShape): Promise<void> {
  const p = path(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class ApiKeyExpiryValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ApiKeyExpiryValidationError';
  }
}

function normInt(value: unknown, field: string, max: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiKeyExpiryValidationError(field, `${field} must be a number`);
  }
  const n = Math.floor(value);
  if (n < 0 || n > max) {
    throw new ApiKeyExpiryValidationError(
      field,
      `${field} must be between 0 and ${max}`,
    );
  }
  return n;
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyExpiryPolicy> {
  const all = await loadAll(dataDir);
  return (
    all.policies.find((p) => p.workspaceId === workspaceId)
    ?? empty(workspaceId, Date.now())
  );
}

export interface UpdateInput {
  warnDays?: number;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyExpiryPolicy> {
  const prev = await getPolicy(dataDir, workspaceId);
  const warnDays = normInt(input.warnDays ?? prev.warnDays, 'warnDays', MAX_WARN_DAYS);
  const now = Date.now();
  const next: ApiKeyExpiryPolicy = {
    workspaceId,
    warnDays,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const all = await loadAll(dataDir);
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

let cached: { policy: ApiKeyExpiryPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyExpiryPolicy> {
  const now = Date.now();
  if (
    cached
    && cached.policy.workspaceId === workspaceId
    && cached.expiresAt > now
  ) {
    return cached.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  cached = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

/**
 * Classify a single key against the expiry-warning policy. Pure.
 *   - 'off':      policy disabled, key has no TTL, key is revoked,
 *                 or key is already past expiry (the auth layer
 *                 rejects expired keys before classification anyway,
 *                 so we collapse that to 'off' for header purposes).
 *   - 'ok':       key has a TTL but is outside the warning window.
 *   - 'expiring': key falls inside the warning window. Headers and
 *                 the upcoming-keys report surface this state.
 */
export function classifyKey(
  policy: ApiKeyExpiryPolicy,
  key: Pick<ApiKeyRecord, 'expiresAt' | 'revokedAt'>,
  now: number,
): { status: 'off' | 'ok' | 'expiring'; daysRemaining: number | null; expiresAt: number | null } {
  if (key.revokedAt) return { status: 'off', daysRemaining: null, expiresAt: null };
  if (!key.expiresAt) return { status: 'off', daysRemaining: null, expiresAt: null };
  if (key.expiresAt <= now) return { status: 'off', daysRemaining: null, expiresAt: key.expiresAt };
  if (policy.warnDays <= 0) {
    return { status: 'off', daysRemaining: null, expiresAt: key.expiresAt };
  }
  const remainingMs = key.expiresAt - now;
  const daysRemaining = Math.floor(remainingMs / DAY_MS);
  if (daysRemaining < policy.warnDays) {
    return { status: 'expiring', daysRemaining, expiresAt: key.expiresAt };
  }
  return { status: 'ok', daysRemaining, expiresAt: key.expiresAt };
}

export interface UpcomingKey {
  id: string;
  label: string;
  userId: string;
  role: 'owner' | 'reader';
  expiresAt: number;
  daysRemaining: number;
  lastUsedAt: number | null;
}

/**
 * Return every active key currently inside the warning window, sorted
 * by soonest-to-expire. The list is what the admin UI and the
 * /upcoming route render.
 */
export function findUpcomingKeys(
  policy: ApiKeyExpiryPolicy,
  keys: ApiKeyRecord[],
  now: number,
): UpcomingKey[] {
  const out: UpcomingKey[] = [];
  for (const k of keys) {
    const c = classifyKey(policy, k, now);
    if (c.status !== 'expiring' || c.daysRemaining === null || c.expiresAt === null) continue;
    out.push({
      id: k.id,
      label: k.label,
      userId: k.userId,
      role: k.role,
      expiresAt: c.expiresAt,
      daysRemaining: c.daysRemaining,
      lastUsedAt: k.lastUsedAt,
    });
  }
  out.sort((a, b) => a.expiresAt - b.expiresAt);
  return out;
}
