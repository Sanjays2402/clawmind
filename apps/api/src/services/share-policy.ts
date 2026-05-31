import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace-wide public-share policy.
//
// Per-user share TTLs already exist in services/share.ts (clampTtlMs) and
// the route accepts an explicit ttlDays. That covers the "this one link
// is sensitive" case. It does NOT cover the enterprise procurement case:
// "as a workspace owner, can I guarantee that no member ever mints a
// non-expiring link, never lets a link live longer than 7 days, or can I
// turn public sharing off entirely while we investigate a leak?"
//
// This module is that switch. It is gated at POST /v1/share before the
// link is minted and audit-logged on every denial so security teams can
// see who tried what under which policy.
//
// Knobs:
//   * disableShares   -> reject every POST /v1/share. Reads and revokes
//                        still work (members can still revoke leaked
//                        links). Useful as an incident kill switch.
//   * requireExpiry   -> reject ttlDays=null ("no expiry") even though
//                        the per-share clamp would silently substitute
//                        MAX. Forces every link to have a wall-clock
//                        expiry visible to the user.
//   * maxTtlDays      -> hard cap on the TTL a member can request.
//                        Members can still pick a shorter window;
//                        anything longer or null (when not paired with
//                        requireExpiry) is clamped to this value before
//                        createShare runs. 0 means "use the package
//                        default ceiling" (MAX_SHARE_TTL_MS).
//
// Persisted at <dataDir>/share-policy.json with the same atomic
// tmp+rename pattern used by session-policy / mfa-policy.

const FILE = 'share-policy.json';
const DEFAULT_WORKSPACE = 'default';

// Package-level hard ceiling on what the policy can demand. Mirrors
// MAX_SHARE_TTL_MS in services/share.ts so the policy can never request
// a TTL the share writer would refuse to honour.
export const MAX_POLICY_TTL_DAYS = 365;

export interface SharePolicy {
  workspaceId: string;
  disableShares: boolean;
  requireExpiry: boolean;
  // 0 means "use the package default ceiling" (no extra workspace cap).
  // Otherwise a positive integer in [1, MAX_POLICY_TTL_DAYS].
  maxTtlDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

interface SharePolicyFile {
  version: 1;
  policies: SharePolicy[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): SharePolicy {
  return {
    workspaceId,
    disableShares: false,
    requireExpiry: false,
    maxTtlDays: 0,
    updatedAt: now,
    updatedBy: null,
  };
}

function normalize(
  p: Partial<SharePolicy> & { workspaceId: string },
  now: number,
): SharePolicy {
  return {
    workspaceId: p.workspaceId,
    disableShares: typeof p.disableShares === 'boolean' ? p.disableShares : false,
    requireExpiry: typeof p.requireExpiry === 'boolean' ? p.requireExpiry : false,
    maxTtlDays: typeof p.maxTtlDays === 'number' ? p.maxTtlDays : 0,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
    updatedBy: typeof p.updatedBy === 'string' ? p.updatedBy : null,
  };
}

async function loadAll(dataDir: string): Promise<SharePolicyFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as SharePolicyFile;
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

async function saveAll(dataDir: string, all: SharePolicyFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class SharePolicyValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'SharePolicyValidationError';
  }
}

function normInt(value: unknown, field: string, min: number, max: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SharePolicyValidationError(field, `${field} must be a number`);
  }
  const n = Math.floor(value);
  if (n < min || n > max) {
    throw new SharePolicyValidationError(
      field,
      `${field} must be between ${min} and ${max}`,
    );
  }
  return n;
}

function normBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new SharePolicyValidationError(field, `${field} must be boolean`);
  }
  return value;
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<SharePolicy> {
  const all = await loadAll(dataDir);
  const found = all.policies.find((p) => p.workspaceId === workspaceId);
  return found ? normalize(found, Date.now()) : empty(workspaceId, Date.now());
}

export interface UpdateInput {
  disableShares?: boolean;
  requireExpiry?: boolean;
  maxTtlDays?: number;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<SharePolicy> {
  // Partial-update semantics: an undefined field preserves the current
  // value rather than resetting it. Matches every other workspace policy
  // file in this repo.
  const current = await getPolicy(dataDir, workspaceId);
  const disableShares =
    normBool(input.disableShares, 'disableShares') ?? current.disableShares;
  const requireExpiry =
    normBool(input.requireExpiry, 'requireExpiry') ?? current.requireExpiry;
  const maxTtlDays =
    input.maxTtlDays === undefined
      ? current.maxTtlDays
      : normInt(input.maxTtlDays, 'maxTtlDays', 0, MAX_POLICY_TTL_DAYS);
  const now = Date.now();
  const next: SharePolicy = {
    workspaceId,
    disableShares,
    requireExpiry,
    maxTtlDays,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const all = await loadAll(dataDir);
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

// 1s hot-path cache, matching session-policy / mfa-policy. The share
// route is not on the per-request critical path, but the policy can be
// read on every POST /v1/share and a flipped switch should propagate in
// under a second.
let cached: { policy: SharePolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<SharePolicy> {
  const now = Date.now();
  if (cached && cached.policy.workspaceId === workspaceId && cached.expiresAt > now) {
    return cached.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  cached = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

// --- Enforcement -------------------------------------------------------------

export type SharePolicyDenialReason =
  | 'shares-disabled'
  | 'expiry-required'
  | 'ttl-exceeds-cap';

export interface SharePolicyDecision {
  ok: boolean;
  reason?: SharePolicyDenialReason;
  message?: string;
  // The TTL in days that the route should honour after policy
  // adjustment. undefined means "fall through to per-share default".
  // null means "no expiry" (only returned when the policy permits it).
  ttlDays?: number | null;
}

// Evaluate a member's requested TTL against the workspace policy.
// Three outcomes:
//   * deny  -> reason set, route returns 403
//   * accept and adjust -> ttlDays returned (possibly clamped)
//   * accept unchanged  -> ttlDays mirrors the input
export function evaluate(
  policy: SharePolicy,
  requested: { ttlDays?: number | null },
): SharePolicyDecision {
  if (policy.disableShares) {
    return {
      ok: false,
      reason: 'shares-disabled',
      message: 'public sharing is disabled by workspace policy',
    };
  }
  // "no expiry" requested.
  if (requested.ttlDays === null) {
    if (policy.requireExpiry) {
      return {
        ok: false,
        reason: 'expiry-required',
        message: 'workspace policy requires every share to expire',
      };
    }
    if (policy.maxTtlDays > 0) {
      // Owner allows non-expiring shares but caps the absolute window.
      return { ok: true, ttlDays: policy.maxTtlDays };
    }
    return { ok: true, ttlDays: null };
  }
  // Default TTL requested (ttlDays undefined).
  if (requested.ttlDays === undefined) {
    if (policy.maxTtlDays > 0) {
      return { ok: true, ttlDays: policy.maxTtlDays };
    }
    return { ok: true, ttlDays: undefined };
  }
  // Explicit positive TTL requested.
  if (policy.maxTtlDays > 0 && requested.ttlDays > policy.maxTtlDays) {
    return {
      ok: false,
      reason: 'ttl-exceeds-cap',
      message: `requested ttl ${requested.ttlDays}d exceeds workspace cap of ${policy.maxTtlDays}d`,
    };
  }
  return { ok: true, ttlDays: requested.ttlDays };
}
