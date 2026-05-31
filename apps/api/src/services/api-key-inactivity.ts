import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { revokeKeysWhere, type ApiKeyRecord } from './api-keys.js';

// Workspace API-key inactivity sweep policy. SOC2 CC6.1 / ISO27001 A.9.2.5:
// "credentials not used for an extended period are reviewed and revoked."
//
// Knobs (idleDays == 0 disables the policy entirely):
//   * idleDays    revoke active keys with no successful use in this window.
//                 Anchor is lastUsedAt, falling back to rotatedAt or
//                 createdAt for keys that were issued but never called.
//   * warnDays    surface keys that are this many days from breaching the
//                 idleDays threshold. Read-only signal for the admin UI;
//                 does not revoke. Must be <= idleDays.
// Sweeping is operator-triggered: POST /v1/api-key-inactivity/sweep
// with `{"dryRun":true}` to preview, then again without to actually
// revoke. Wire a Helm CronJob or systemd timer to call the sweep
// endpoint on a schedule once you have validated the thresholds.
//
// Persisted at <dataDir>/api-key-inactivity.json, atomic tmp+rename.

const FILE = 'api-key-inactivity.json';
const DEFAULT_WORKSPACE = 'default';

export const MAX_IDLE_DAYS = 365 * 2;
export const MAX_WARN_DAYS = 365 * 2;
const DAY_MS = 24 * 60 * 60_000;

export interface ApiKeyInactivityPolicy {
  workspaceId: string;
  idleDays: number;
  warnDays: number;
  updatedAt: number;
  updatedBy: string | null;
  lastSweepAt: number | null;
  lastSweepCount: number;
}

interface FileShape {
  version: 1;
  policies: ApiKeyInactivityPolicy[];
}

function path(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): ApiKeyInactivityPolicy {
  return {
    workspaceId,
    idleDays: 0,
    warnDays: 0,
    updatedAt: now,
    updatedBy: null,
    lastSweepAt: null,
    lastSweepCount: 0,
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

export class ApiKeyInactivityValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ApiKeyInactivityValidationError';
  }
}

function normInt(value: unknown, field: string, max: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiKeyInactivityValidationError(field, `${field} must be a number`);
  }
  const n = Math.floor(value);
  if (n < 0 || n > max) {
    throw new ApiKeyInactivityValidationError(
      field,
      `${field} must be between 0 and ${max}`,
    );
  }
  return n;
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyInactivityPolicy> {
  const all = await loadAll(dataDir);
  return (
    all.policies.find((p) => p.workspaceId === workspaceId)
    ?? empty(workspaceId, Date.now())
  );
}

export interface UpdateInput {
  idleDays?: number;
  warnDays?: number;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyInactivityPolicy> {
  const prev = await getPolicy(dataDir, workspaceId);
  const idleDays = normInt(input.idleDays ?? prev.idleDays, 'idleDays', MAX_IDLE_DAYS);
  const warnDays = normInt(input.warnDays ?? prev.warnDays, 'warnDays', MAX_WARN_DAYS);
  if (idleDays === 0 && warnDays > 0) {
    throw new ApiKeyInactivityValidationError(
      'warnDays',
      'warnDays requires a non-zero idleDays so there is a threshold to warn before',
    );
  }
  if (warnDays > idleDays) {
    throw new ApiKeyInactivityValidationError(
      'warnDays',
      'warnDays must be less than or equal to idleDays',
    );
  }
  const now = Date.now();
  const next: ApiKeyInactivityPolicy = {
    workspaceId,
    idleDays,
    warnDays,
    updatedAt: now,
    updatedBy: actorUserId,
    lastSweepAt: prev.lastSweepAt,
    lastSweepCount: prev.lastSweepCount,
  };
  const all = await loadAll(dataDir);
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

let cached: { policy: ApiKeyInactivityPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyInactivityPolicy> {
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
 * Anchor used to score a key for inactivity. Falls back through
 * lastUsedAt -> rotatedAt -> createdAt so a freshly minted-but-unused
 * key is never assumed eternally fresh.
 */
export function inactivityAnchor(key: Pick<ApiKeyRecord, 'lastUsedAt' | 'rotatedAt' | 'createdAt'>): number {
  if (key.lastUsedAt && key.lastUsedAt > 0) return key.lastUsedAt;
  if (key.rotatedAt && key.rotatedAt > 0) return key.rotatedAt;
  return key.createdAt;
}

/**
 * Classify a single active key against the policy. Pure, no disk.
 *   - 'expired': older than idleDays, eligible for revocation
 *   - 'warn':    within warnDays of breaching idleDays
 *   - 'fresh':   within bounds, no action
 *   - 'off':     policy disabled or already revoked/expired
 */
export function classifyKey(
  policy: ApiKeyInactivityPolicy,
  key: ApiKeyRecord,
  now: number,
): { status: 'off' | 'fresh' | 'warn' | 'expired'; ageDays: number; willRevokeAt: number | null } {
  if (key.revokedAt) return { status: 'off', ageDays: 0, willRevokeAt: null };
  if (key.expiresAt && key.expiresAt <= now) {
    return { status: 'off', ageDays: 0, willRevokeAt: null };
  }
  if (policy.idleDays <= 0) {
    return { status: 'off', ageDays: 0, willRevokeAt: null };
  }
  const anchor = inactivityAnchor(key);
  const ageMs = Math.max(0, now - anchor);
  const ageDays = Math.floor(ageMs / DAY_MS);
  const willRevokeAt = anchor + policy.idleDays * DAY_MS;
  if (ageDays >= policy.idleDays) {
    return { status: 'expired', ageDays, willRevokeAt };
  }
  if (policy.warnDays > 0 && policy.idleDays - ageDays <= policy.warnDays) {
    return { status: 'warn', ageDays, willRevokeAt };
  }
  return { status: 'fresh', ageDays, willRevokeAt };
}

export interface AtRiskKey {
  id: string;
  userId: string;
  label: string;
  role: ApiKeyRecord['role'];
  createdAt: number;
  lastUsedAt: number | null;
  ageDays: number;
  status: 'warn' | 'expired';
  willRevokeAt: number | null;
}

/**
 * Find every active key whose inactivity status is 'warn' or 'expired'.
 * Pure read; no mutation. Useful for the admin UI and for a cron job
 * preview before invoking sweep().
 */
export function findAtRiskKeys(
  policy: ApiKeyInactivityPolicy,
  keys: ApiKeyRecord[],
  now: number,
): AtRiskKey[] {
  if (policy.idleDays <= 0) return [];
  const out: AtRiskKey[] = [];
  for (const k of keys) {
    const c = classifyKey(policy, k, now);
    if (c.status !== 'warn' && c.status !== 'expired') continue;
    out.push({
      id: k.id,
      userId: k.userId,
      label: k.label,
      role: k.role,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      ageDays: c.ageDays,
      status: c.status,
      willRevokeAt: c.willRevokeAt,
    });
  }
  // Most-overdue first so the UI lists the worst offenders at the top.
  out.sort((a, b) => b.ageDays - a.ageDays);
  return out;
}

export interface SweepResult {
  revokedIds: string[];
  scannedAt: number;
  dryRun: boolean;
}

/**
 * Revoke every active key whose status is 'expired' under the current
 * policy. Updates lastSweepAt/lastSweepCount on the policy file so the
 * admin UI can prove the control is live. When dryRun is true, returns
 * the list that would be revoked without touching disk.
 */
export async function sweep(
  dataDir: string,
  loadKeys: () => Promise<ApiKeyRecord[]>,
  options: { dryRun?: boolean; workspaceId?: string } = {},
): Promise<SweepResult> {
  const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE;
  const dryRun = options.dryRun === true;
  const now = Date.now();
  const policy = await getPolicy(dataDir, workspaceId);
  if (policy.idleDays <= 0) {
    return { revokedIds: [], scannedAt: now, dryRun };
  }
  const keys = await loadKeys();
  const expired = new Set(
    keys
      .filter((k) => classifyKey(policy, k, now).status === 'expired')
      .map((k) => k.id),
  );
  if (expired.size === 0) {
    if (!dryRun) {
      await recordSweep(dataDir, workspaceId, now, 0);
    }
    return { revokedIds: [], scannedAt: now, dryRun };
  }
  if (dryRun) {
    return { revokedIds: Array.from(expired), scannedAt: now, dryRun };
  }
  const { ids } = await revokeKeysWhere(dataDir, (k) => expired.has(k.id));
  await recordSweep(dataDir, workspaceId, now, ids.length);
  return { revokedIds: ids, scannedAt: now, dryRun };
}

async function recordSweep(
  dataDir: string,
  workspaceId: string,
  ts: number,
  count: number,
): Promise<void> {
  const all = await loadAll(dataDir);
  const existing = all.policies.find((p) => p.workspaceId === workspaceId);
  if (!existing) return;
  const updated: ApiKeyInactivityPolicy = {
    ...existing,
    lastSweepAt: ts,
    lastSweepCount: count,
  };
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, updated] });
  invalidateCache();
}
