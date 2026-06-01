import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Vendor Support Access Lockbox.
//
// Many enterprise procurement reviews ask the same question: "If your
// support engineers can ever read our workspace, prove that we control
// when that happens, that it is time-bound, that it produces an audit
// trail with a human-readable reason, and that the default is OFF."
// This module is that control.
//
// The lockbox is, by default, CLOSED. While closed, any request that
// presents an `X-Vendor-Support-Token` header is rejected with HTTP 403
// regardless of the token's contents. When an owner opens the lockbox,
// they mint a single time-bounded grant that records:
//
//   * actor (which owner granted access)
//   * reason (free-text, required when policy says so)
//   * ticket (external incident/jira ref, required when policy says so)
//   * expiresAt (clamped to policy.maxDurationSec)
//   * tokenHash (sha256 of the raw token; raw token returned once and
//     never persisted, like an API key secret)
//
// While a grant is active:
//   * any request bearing a matching X-Vendor-Support-Token is allowed
//     through, BUT every response carries
//       X-Vendor-Access-Lockbox: open; expires-at=<iso8601>
//     so the customer's SIEM can alert on the literal string.
//   * other requests are unaffected (the lockbox does not gate normal
//     customer traffic, only the vendor-support code path).
//
// Closed-by-default response header:
//     X-Vendor-Access-Lockbox: closed
// is set on every API response. Procurement reviewers can curl any
// public endpoint and verify the workspace is locked down.
//
// On-disk layout: <dataDir>/vendor-access.json, version 1, atomically
// rewritten via tmp+rename. Past grants are kept in an append-only
// `history` array for audit (capped to MAX_HISTORY entries).

export const MAX_REASON = 1000;
export const MAX_TICKET = 200;
export const MAX_HISTORY = 200;
export const DEFAULT_MAX_DURATION_SEC = 3600; // 1 hour
export const ABSOLUTE_MAX_DURATION_SEC = 24 * 3600; // 24h hard ceiling
export const MIN_DURATION_SEC = 60;

const DEFAULT_WORKSPACE = 'default';
const FILE = 'vendor-access.json';

export interface VendorAccessPolicy {
  // When false, no grant can be issued. Workspace is permanently
  // locked down from vendor support access until the owner explicitly
  // re-enables it. Defaults to false so the safe state is "no vendor
  // access ever".
  enabled: boolean;
  maxDurationSec: number;
  requireJustification: boolean;
  requireTicket: boolean;
  updatedAt: number;
  updatedBy: string | null;
}

export interface VendorAccessGrant {
  id: string;
  tokenHash: string; // sha256(token), hex
  grantedBy: string;
  reason: string | null;
  ticket: string | null;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
  lastUsedAt: number | null;
  useCount: number;
}

export interface VendorAccessFile {
  version: 1;
  workspaceId: string;
  policy: VendorAccessPolicy;
  current: VendorAccessGrant | null;
  history: VendorAccessGrant[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function defaultPolicy(now: number): VendorAccessPolicy {
  return {
    enabled: false,
    maxDurationSec: DEFAULT_MAX_DURATION_SEC,
    requireJustification: true,
    requireTicket: false,
    updatedAt: now,
    updatedBy: null,
  };
}

function emptyFile(workspaceId: string, now: number): VendorAccessFile {
  return {
    version: 1,
    workspaceId,
    policy: defaultPolicy(now),
    current: null,
    history: [],
  };
}

async function loadFile(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<VendorAccessFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as VendorAccessFile;
    if (!parsed || parsed.version !== 1 || !parsed.policy) {
      return emptyFile(workspaceId, Date.now());
    }
    // Backfill required fields on older files.
    parsed.workspaceId ??= workspaceId;
    parsed.current ??= null;
    parsed.history ??= [];
    parsed.policy.requireTicket ??= false;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyFile(workspaceId, Date.now());
    }
    throw err;
  }
}

async function saveFile(dataDir: string, data: VendorAccessFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, p);
  invalidateCache();
}

export class VendorAccessValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'VendorAccessValidationError';
  }
}

export class VendorAccessPolicyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'VendorAccessPolicyError';
  }
}

function normaliseString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new VendorAccessValidationError(field, `${field} must be a string or null`);
  }
  const t = value.trim();
  if (t.length === 0) return null;
  if (t.length > max) {
    throw new VendorAccessValidationError(field, `${field} must be <= ${max} characters`);
  }
  return t;
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<VendorAccessPolicy> {
  const f = await loadFile(dataDir, workspaceId);
  return f.policy;
}

export async function getState(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<{ policy: VendorAccessPolicy; current: VendorAccessGrant | null; history: VendorAccessGrant[] }> {
  const f = await loadFile(dataDir, workspaceId);
  return { policy: f.policy, current: f.current, history: f.history };
}

export interface PolicyInput {
  enabled?: boolean;
  maxDurationSec?: number;
  requireJustification?: boolean;
  requireTicket?: boolean;
}

export async function updatePolicy(
  dataDir: string,
  actorUserId: string,
  input: PolicyInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<VendorAccessPolicy> {
  const f = await loadFile(dataDir, workspaceId);
  const policy = { ...f.policy };
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') {
      throw new VendorAccessValidationError('enabled', 'enabled must be a boolean');
    }
    policy.enabled = input.enabled;
  }
  if (input.maxDurationSec !== undefined) {
    if (!Number.isInteger(input.maxDurationSec)) {
      throw new VendorAccessValidationError('maxDurationSec', 'maxDurationSec must be an integer');
    }
    if (input.maxDurationSec < MIN_DURATION_SEC || input.maxDurationSec > ABSOLUTE_MAX_DURATION_SEC) {
      throw new VendorAccessValidationError(
        'maxDurationSec',
        `maxDurationSec must be between ${MIN_DURATION_SEC} and ${ABSOLUTE_MAX_DURATION_SEC}`,
      );
    }
    policy.maxDurationSec = input.maxDurationSec;
  }
  if (input.requireJustification !== undefined) {
    if (typeof input.requireJustification !== 'boolean') {
      throw new VendorAccessValidationError('requireJustification', 'requireJustification must be a boolean');
    }
    policy.requireJustification = input.requireJustification;
  }
  if (input.requireTicket !== undefined) {
    if (typeof input.requireTicket !== 'boolean') {
      throw new VendorAccessValidationError('requireTicket', 'requireTicket must be a boolean');
    }
    policy.requireTicket = input.requireTicket;
  }
  policy.updatedAt = Date.now();
  policy.updatedBy = actorUserId;

  // If the owner just disabled the lockbox, immediately revoke any
  // active grant so flipping the switch off has the obvious effect.
  let current = f.current;
  let history = f.history;
  if (!policy.enabled && current && current.revokedAt === null) {
    const revoked: VendorAccessGrant = {
      ...current,
      revokedAt: policy.updatedAt,
      revokedBy: actorUserId,
    };
    history = [revoked, ...history].slice(0, MAX_HISTORY);
    current = null;
  }

  await saveFile(dataDir, { ...f, policy, current, history });
  return policy;
}

export interface GrantInput {
  durationSec: number;
  reason?: string | null;
  ticket?: string | null;
}

export interface GrantResult {
  grant: VendorAccessGrant;
  token: string; // raw, returned exactly once
}

export async function grantAccess(
  dataDir: string,
  actorUserId: string,
  input: GrantInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<GrantResult> {
  const f = await loadFile(dataDir, workspaceId);
  if (!f.policy.enabled) {
    throw new VendorAccessPolicyError(
      'lockbox-closed',
      'vendor support access is disabled on this workspace',
    );
  }
  if (!Number.isInteger(input.durationSec)) {
    throw new VendorAccessValidationError('durationSec', 'durationSec must be an integer');
  }
  if (input.durationSec < MIN_DURATION_SEC) {
    throw new VendorAccessValidationError('durationSec', `durationSec must be >= ${MIN_DURATION_SEC}`);
  }
  if (input.durationSec > f.policy.maxDurationSec) {
    throw new VendorAccessValidationError(
      'durationSec',
      `durationSec exceeds policy maxDurationSec (${f.policy.maxDurationSec})`,
    );
  }
  const reason = normaliseString(input.reason, 'reason', MAX_REASON);
  const ticket = normaliseString(input.ticket, 'ticket', MAX_TICKET);
  if (f.policy.requireJustification && !reason) {
    throw new VendorAccessValidationError('reason', 'reason is required by policy');
  }
  if (f.policy.requireTicket && !ticket) {
    throw new VendorAccessValidationError('ticket', 'ticket reference is required by policy');
  }

  // Revoke any existing active grant: only one grant can be live at a
  // time. Keeps the audit story simple (one token, one window).
  const now = Date.now();
  let history = f.history;
  if (f.current && f.current.revokedAt === null && f.current.expiresAt > now) {
    history = [{ ...f.current, revokedAt: now, revokedBy: actorUserId }, ...history];
  } else if (f.current) {
    history = [f.current, ...history];
  }
  history = history.slice(0, MAX_HISTORY);

  const tokenBytes = randomBytes(32);
  const token = `cmv_${tokenBytes.toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const grant: VendorAccessGrant = {
    id: randomBytes(8).toString('hex'),
    tokenHash,
    grantedBy: actorUserId,
    reason,
    ticket,
    createdAt: now,
    expiresAt: now + input.durationSec * 1000,
    revokedAt: null,
    revokedBy: null,
    lastUsedAt: null,
    useCount: 0,
  };
  await saveFile(dataDir, { ...f, current: grant, history });
  return { grant, token };
}

export async function revokeAccess(
  dataDir: string,
  actorUserId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<VendorAccessGrant | null> {
  const f = await loadFile(dataDir, workspaceId);
  if (!f.current) return null;
  const now = Date.now();
  const revoked: VendorAccessGrant = {
    ...f.current,
    revokedAt: f.current.revokedAt ?? now,
    revokedBy: f.current.revokedBy ?? actorUserId,
  };
  const history = [revoked, ...f.history].slice(0, MAX_HISTORY);
  await saveFile(dataDir, { ...f, current: null, history });
  return revoked;
}

// Lockbox state used by the request plugin to set response headers.
// Cached for 1s to keep the hot path off disk; invalidated on every
// mutation via saveFile.
let cached: { value: { open: boolean; expiresAt: number | null }; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getLockboxState(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<{ open: boolean; expiresAt: number | null }> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const f = await loadFile(dataDir, workspaceId);
  const c = f.current;
  const open = !!(c && c.revokedAt === null && c.expiresAt > now);
  const value = { open, expiresAt: open ? c!.expiresAt : null };
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

export function lockboxHeaderValue(state: { open: boolean; expiresAt: number | null }): string {
  if (!state.open || !state.expiresAt) return 'closed';
  return `open; expires-at=${new Date(state.expiresAt).toISOString()}`;
}

// Verify a presented X-Vendor-Support-Token against the current grant.
// Returns true on a valid match; bumps lastUsedAt + useCount. Returns
// false in every other case (no current grant, expired, revoked,
// mismatched hash). Constant-time comparison on the digest.
export async function verifyToken(
  dataDir: string,
  token: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0) return false;
  const f = await loadFile(dataDir, workspaceId);
  const c = f.current;
  if (!c || c.revokedAt !== null) return false;
  const now = Date.now();
  if (c.expiresAt <= now) return false;
  const presented = createHash('sha256').update(token).digest();
  const stored = Buffer.from(c.tokenHash, 'hex');
  if (presented.length !== stored.length) return false;
  if (!timingSafeEqual(presented, stored)) return false;
  // Bump usage stats; best-effort, ignore write errors so a transient
  // disk hiccup never bricks valid support access.
  try {
    const updated: VendorAccessGrant = {
      ...c,
      lastUsedAt: now,
      useCount: c.useCount + 1,
    };
    await saveFile(dataDir, { ...f, current: updated });
  } catch {
    // ignore
  }
  return true;
}
