import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace API-key issuance policy.
//
// Enterprise security teams ask: "Can the workspace owner force every
// API key to expire, cap the maximum TTL, cap how many keys one user can
// hold, and block scope-wildcards?" Per-key revoke is necessary but not
// sufficient. Until the workspace itself enforces these properties on
// the issue path, the answer is "we hope so". This module is that
// switch.
//
// Knobs (0/false means "unset"):
//   * maxTtlMinutes       hard ceiling on ttlMs at issuance. 0 disables.
//   * requireExpiry       reject never-expire keys; only respected when
//                         maxTtlMinutes > 0 (so callers always have a
//                         legal value to pick).
//   * maxActiveKeysPerUser cap on non-revoked, non-expired keys one user
//                         may hold at once. 0 disables.
//   * maxScopesPerKey     cap on scope array length at issuance.
//                         0 disables. Wildcard counts as one scope.
//   * allowWildcardScope  when false, '*' is rejected at issue.
//   * forcedRotationDays  when > 0, keys older than this are reported as
//                         needing rotation; the UI surfaces it and the
//                         /keys list endpoint can include the flag.
//
// Persisted at <dataDir>/api-key-policy.json, atomic tmp+rename.
// Default for a fresh deployment is fully permissive to preserve
// backwards compatibility; owners opt in.

const FILE = 'api-key-policy.json';
const DEFAULT_WORKSPACE = 'default';

// 365d ceiling matches the IssueBody upper bound on ttlMs.
export const MAX_TTL_MIN = 60 * 24 * 365;
export const MAX_KEYS_PER_USER = 200;
export const MAX_SCOPES_PER_KEY = 64;
export const MAX_FORCED_ROTATION_DAYS = 365;

export interface ApiKeyPolicy {
  workspaceId: string;
  maxTtlMinutes: number;
  requireExpiry: boolean;
  maxActiveKeysPerUser: number;
  maxScopesPerKey: number;
  allowWildcardScope: boolean;
  forcedRotationDays: number;
  updatedAt: number;
  updatedBy: string | null;
}

interface FileShape {
  version: 1;
  policies: ApiKeyPolicy[];
}

function path(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): ApiKeyPolicy {
  return {
    workspaceId,
    maxTtlMinutes: 0,
    requireExpiry: false,
    maxActiveKeysPerUser: 0,
    maxScopesPerKey: 0,
    allowWildcardScope: true,
    forcedRotationDays: 0,
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

export class ApiKeyPolicyValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ApiKeyPolicyValidationError';
  }
}

function normInt(value: unknown, field: string, max: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiKeyPolicyValidationError(field, `${field} must be a number`);
  }
  const n = Math.floor(value);
  if (n < 0 || n > max) {
    throw new ApiKeyPolicyValidationError(field, `${field} must be between 0 and ${max}`);
  }
  return n;
}

function normBool(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    throw new ApiKeyPolicyValidationError(field, `${field} must be a boolean`);
  }
  return value;
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyPolicy> {
  const all = await loadAll(dataDir);
  return all.policies.find((p) => p.workspaceId === workspaceId)
    ?? empty(workspaceId, Date.now());
}

export interface UpdateInput {
  maxTtlMinutes?: number;
  requireExpiry?: boolean;
  maxActiveKeysPerUser?: number;
  maxScopesPerKey?: number;
  allowWildcardScope?: boolean;
  forcedRotationDays?: number;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyPolicy> {
  const prev = await getPolicy(dataDir, workspaceId);
  const maxTtlMinutes = normInt(
    input.maxTtlMinutes ?? prev.maxTtlMinutes,
    'maxTtlMinutes',
    MAX_TTL_MIN,
  );
  const requireExpiry = normBool(
    input.requireExpiry ?? prev.requireExpiry,
    'requireExpiry',
    false,
  );
  const maxActiveKeysPerUser = normInt(
    input.maxActiveKeysPerUser ?? prev.maxActiveKeysPerUser,
    'maxActiveKeysPerUser',
    MAX_KEYS_PER_USER,
  );
  const maxScopesPerKey = normInt(
    input.maxScopesPerKey ?? prev.maxScopesPerKey,
    'maxScopesPerKey',
    MAX_SCOPES_PER_KEY,
  );
  const allowWildcardScope = normBool(
    input.allowWildcardScope ?? prev.allowWildcardScope,
    'allowWildcardScope',
    true,
  );
  const forcedRotationDays = normInt(
    input.forcedRotationDays ?? prev.forcedRotationDays,
    'forcedRotationDays',
    MAX_FORCED_ROTATION_DAYS,
  );

  if (requireExpiry && maxTtlMinutes === 0) {
    throw new ApiKeyPolicyValidationError(
      'requireExpiry',
      'requireExpiry needs a non-zero maxTtlMinutes so callers have an upper bound to pick',
    );
  }

  const now = Date.now();
  const next: ApiKeyPolicy = {
    workspaceId,
    maxTtlMinutes,
    requireExpiry,
    maxActiveKeysPerUser,
    maxScopesPerKey,
    allowWildcardScope,
    forcedRotationDays,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const all = await loadAll(dataDir);
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

// 1s cache shared with the other workspace policy modules.
let cached: { policy: ApiKeyPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ApiKeyPolicy> {
  const now = Date.now();
  if (cached && cached.policy.workspaceId === workspaceId && cached.expiresAt > now) {
    return cached.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  cached = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

export type EvalIssueReason =
  | 'ttl-required'
  | 'ttl-too-large'
  | 'too-many-active-keys'
  | 'too-many-scopes'
  | 'wildcard-scope-blocked';

export type EvalIssueResult =
  | { ok: true }
  | { ok: false; reason: EvalIssueReason; limit?: number; field: string; message: string };

export interface EvalIssueInput {
  ttlMs: number | null | undefined;
  scopes: string[] | undefined;
  activeKeyCount: number;
}

// Pure evaluation, no disk. Called from the keys route at issue time and
// from the policy unit test. Returns the first violation so the user
// gets one clear error to fix rather than a list.
export function evaluateIssue(
  policy: ApiKeyPolicy,
  input: EvalIssueInput,
): EvalIssueResult {
  if (policy.maxTtlMinutes > 0) {
    const ttlMs = input.ttlMs ?? null;
    if (policy.requireExpiry && (ttlMs === null || ttlMs <= 0)) {
      return {
        ok: false,
        reason: 'ttl-required',
        field: 'ttlMs',
        limit: policy.maxTtlMinutes,
        message: `workspace policy requires an expiry of at most ${policy.maxTtlMinutes} minutes`,
      };
    }
    if (ttlMs !== null && ttlMs > 0) {
      const limitMs = policy.maxTtlMinutes * 60_000;
      if (ttlMs > limitMs) {
        return {
          ok: false,
          reason: 'ttl-too-large',
          field: 'ttlMs',
          limit: policy.maxTtlMinutes,
          message: `ttl exceeds workspace cap of ${policy.maxTtlMinutes} minutes`,
        };
      }
    }
  }
  if (policy.maxActiveKeysPerUser > 0 && input.activeKeyCount >= policy.maxActiveKeysPerUser) {
    return {
      ok: false,
      reason: 'too-many-active-keys',
      field: 'count',
      limit: policy.maxActiveKeysPerUser,
      message: `user already holds ${input.activeKeyCount} active keys, workspace cap is ${policy.maxActiveKeysPerUser}`,
    };
  }
  const scopes = input.scopes ?? [];
  if (policy.maxScopesPerKey > 0 && scopes.length > policy.maxScopesPerKey) {
    return {
      ok: false,
      reason: 'too-many-scopes',
      field: 'scopes',
      limit: policy.maxScopesPerKey,
      message: `scope list of ${scopes.length} exceeds workspace cap of ${policy.maxScopesPerKey}`,
    };
  }
  if (!policy.allowWildcardScope && scopes.includes('*')) {
    return {
      ok: false,
      reason: 'wildcard-scope-blocked',
      field: 'scopes',
      message: 'workspace policy forbids wildcard scope; enumerate explicit scopes',
    };
  }
  return { ok: true };
}

// Reporting helper for the /keys list view: a key needs rotation if
// the workspace sets forcedRotationDays > 0 and the key was created
// (or last rotated) more than that many days ago. Pure, no disk.
export function needsRotation(
  policy: ApiKeyPolicy,
  key: { createdAt: number; rotatedAt?: number | null },
  now: number,
): boolean {
  if (policy.forcedRotationDays <= 0) return false;
  const anchor = key.rotatedAt && key.rotatedAt > 0 ? key.rotatedAt : key.createdAt;
  const ageMs = now - anchor;
  return ageMs >= policy.forcedRotationDays * 24 * 60 * 60_000;
}

// Enforcement helper used at the auth boundary: when the workspace owner
// has set forcedRotationDays > 0, any API key whose age exceeds the cap
// is rejected at verify time so an auditor's request ("prove that an
// over-age credential cannot transact") has a single-line answer. Pure;
// the auth plugin layers the audit write and 401 response on top.
export interface RotationDecision {
  ok: boolean;
  ageDays: number;
  maxAgeDays: number;
}

export function evaluateRotation(
  policy: ApiKeyPolicy,
  key: { createdAt: number; rotatedAt?: number | null },
  now: number,
): RotationDecision {
  const maxAgeDays = policy.forcedRotationDays;
  const anchor = key.rotatedAt && key.rotatedAt > 0 ? key.rotatedAt : key.createdAt;
  const ageMs = Math.max(0, now - anchor);
  const ageDays = Math.floor(ageMs / (24 * 60 * 60_000));
  if (maxAgeDays <= 0) return { ok: true, ageDays, maxAgeDays };
  return { ok: ageDays < maxAgeDays, ageDays, maxAgeDays };
}
