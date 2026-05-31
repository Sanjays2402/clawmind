import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace session lifetime policy.
//
// Enterprise buyers ask the same question on every security questionnaire:
// "Can a workspace owner cap how long a signed-in session stays valid
// and how long it can sit idle?" Per-user "sign out" is necessary but
// not sufficient: until the workspace itself can guarantee the property
// for every member, the answer is "we hope so". This module is that
// switch.
//
// What the policy does, in plain terms:
//
//   * maxLifetimeMinutes  -> absolute cap from session creation. A
//                            session older than this is rejected on the
//                            next request and revoked. The user has to
//                            log in again. Caps re-authentication.
//   * idleTimeoutMinutes  -> cap from the session's last seen request.
//                            Idle laptops left in a coffee shop time
//                            out without depending on the cookie's
//                            natural expiry.
//   * 0 means "unset" for that axis, matching the convention used by
//     other policy files in this repo (workspace-freeze, mfa-policy).
//
// API-key callers are exempt by design: their lifetime is governed by
// rotation + revoke + per-key rate limits, all already enforced. The
// policy gates browser cookie sessions only.
//
// Persisted at <dataDir>/session-policy.json, atomic tmp+rename.

const FILE = 'session-policy.json';
const DEFAULT_WORKSPACE = 'default';

export const MAX_LIFETIME_MIN = 60 * 24 * 90;   // 90 days
export const MAX_IDLE_MIN = 60 * 24 * 30;       // 30 days
export const DEFAULT_LIFETIME_MIN = 60 * 24 * 7;  // 7 days
export const DEFAULT_IDLE_MIN = 60 * 8;           // 8 hours
// Hard upper bound on the per-user concurrent-session cap a workspace
// owner can configure. Matches the existing MAX_SESSIONS_PER_USER ceiling
// in services/sessions.ts so the registry never has to grow beyond what
// the cap allows. 0 means "unset" (no per-user cap beyond the hard one).
export const MAX_CONCURRENT_SESSIONS = 50;

export interface SessionPolicy {
  workspaceId: string;
  // 0 disables that axis.
  maxLifetimeMinutes: number;
  idleTimeoutMinutes: number;
  // 0 means "unset" (fall back to the hard registry cap). When > 0, a
  // login that would push a user past the cap evicts that user's oldest
  // active session before recording the new one.
  maxConcurrentSessions: number;
  updatedAt: number;
  updatedBy: string | null;
}

interface SessionPolicyFile {
  version: 1;
  policies: SessionPolicy[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): SessionPolicy {
  return {
    workspaceId,
    maxLifetimeMinutes: 0,
    idleTimeoutMinutes: 0,
    maxConcurrentSessions: 0,
    updatedAt: now,
    updatedBy: null,
  };
}

function normalizePolicy(p: Partial<SessionPolicy> & { workspaceId: string }, now: number): SessionPolicy {
  // Tolerate older policy files written before maxConcurrentSessions
  // existed by defaulting the missing field to 0 (unset).
  return {
    workspaceId: p.workspaceId,
    maxLifetimeMinutes: typeof p.maxLifetimeMinutes === 'number' ? p.maxLifetimeMinutes : 0,
    idleTimeoutMinutes: typeof p.idleTimeoutMinutes === 'number' ? p.idleTimeoutMinutes : 0,
    maxConcurrentSessions: typeof p.maxConcurrentSessions === 'number' ? p.maxConcurrentSessions : 0,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
    updatedBy: typeof p.updatedBy === 'string' ? p.updatedBy : null,
  };
}

async function loadAll(dataDir: string): Promise<SessionPolicyFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as SessionPolicyFile;
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

async function saveAll(dataDir: string, all: SessionPolicyFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class SessionPolicyValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'SessionPolicyValidationError';
  }
}

function normInt(value: unknown, field: string, max: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SessionPolicyValidationError(field, `${field} must be a number`);
  }
  const n = Math.floor(value);
  if (n < 0 || n > max) {
    throw new SessionPolicyValidationError(field, `${field} must be between 0 and ${max}`);
  }
  return n;
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<SessionPolicy> {
  const all = await loadAll(dataDir);
  const found = all.policies.find((p) => p.workspaceId === workspaceId);
  return found ? normalizePolicy(found, Date.now()) : empty(workspaceId, Date.now());
}

export interface UpdateInput {
  maxLifetimeMinutes?: number;
  idleTimeoutMinutes?: number;
  maxConcurrentSessions?: number;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<SessionPolicy> {
  // Partial-update semantics: an absent field preserves the existing
  // value rather than resetting it to 0. The route layer validates that
  // at least one knob was provided.
  const current = await getPolicy(dataDir, workspaceId);
  const maxLifetimeMinutes = input.maxLifetimeMinutes === undefined
    ? current.maxLifetimeMinutes
    : normInt(input.maxLifetimeMinutes, 'maxLifetimeMinutes', MAX_LIFETIME_MIN);
  const idleTimeoutMinutes = input.idleTimeoutMinutes === undefined
    ? current.idleTimeoutMinutes
    : normInt(input.idleTimeoutMinutes, 'idleTimeoutMinutes', MAX_IDLE_MIN);
  const maxConcurrentSessions = input.maxConcurrentSessions === undefined
    ? current.maxConcurrentSessions
    : normInt(input.maxConcurrentSessions, 'maxConcurrentSessions', MAX_CONCURRENT_SESSIONS);
  if (maxLifetimeMinutes > 0 && idleTimeoutMinutes > 0 && idleTimeoutMinutes > maxLifetimeMinutes) {
    throw new SessionPolicyValidationError(
      'idleTimeoutMinutes',
      'idleTimeoutMinutes cannot exceed maxLifetimeMinutes',
    );
  }
  const now = Date.now();
  const all = await loadAll(dataDir);
  const next: SessionPolicy = {
    workspaceId,
    maxLifetimeMinutes,
    idleTimeoutMinutes,
    maxConcurrentSessions,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

// Hot-path cache. The auth preHandler runs on every request; re-reading
// session-policy.json there would dominate the request budget. 1s TTL
// matches the existing mfa-policy + workspace-freeze cache so flipping
// the switch in one tab shows up in another within one second.
let cached: { policy: SessionPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<SessionPolicy> {
  const now = Date.now();
  if (cached && cached.policy.workspaceId === workspaceId && cached.expiresAt > now) {
    return cached.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  cached = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

export type EvalReason = 'lifetime-exceeded' | 'idle-timeout';

export type EvalResult =
  | { ok: true }
  | { ok: false; reason: EvalReason; limitMinutes: number; ageMinutes: number };

// Pure evaluation: no disk, no time-of-day, all inputs explicit so tests
// can pin the clock. Returns the first violation; lifetime wins over
// idle when both trip at the same instant because asking the user to
// log in again is the stronger signal.
export function evaluateSession(
  policy: SessionPolicy,
  session: { createdAt: number; lastSeenAt: number },
  now: number,
): EvalResult {
  if (policy.maxLifetimeMinutes > 0) {
    const ageMs = now - session.createdAt;
    const limitMs = policy.maxLifetimeMinutes * 60_000;
    if (ageMs >= limitMs) {
      return {
        ok: false,
        reason: 'lifetime-exceeded',
        limitMinutes: policy.maxLifetimeMinutes,
        ageMinutes: Math.floor(ageMs / 60_000),
      };
    }
  }
  if (policy.idleTimeoutMinutes > 0) {
    const idleMs = now - session.lastSeenAt;
    const limitMs = policy.idleTimeoutMinutes * 60_000;
    if (idleMs >= limitMs) {
      return {
        ok: false,
        reason: 'idle-timeout',
        limitMinutes: policy.idleTimeoutMinutes,
        ageMinutes: Math.floor(idleMs / 60_000),
      };
    }
  }
  return { ok: true };
}
