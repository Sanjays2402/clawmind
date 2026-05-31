import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadMfa } from './mfa.js';

// Workspace MFA enforcement policy.
//
// When an owner turns this on, every signed-in human is required to have
// confirmed TOTP MFA enrolled before they can hit any mutating route.
// Sessions without MFA receive HTTP 412 Precondition Failed and a stable
// machine-readable error (mfa_enrollment_required) so the web UI can
// redirect to /settings/mfa and a scripted client knows exactly why the
// call failed.
//
// Buyer-side framing: SOC 2 CC6.6 and most procurement security
// questionnaires ask "can you require MFA workspace-wide?" Per-user MFA
// is necessary but not sufficient: until a workspace-level switch
// guarantees the property for every member, the answer is "we hope so".
// This module is the switch.
//
// Design points:
//
//   * Single workspace per deployment for now (matches the rest of the
//     codebase). Stored as a singleton record so introducing real
//     multi-tenancy later just wraps this in a workspaceId map.
//   * Grace period (days) gives existing users time to enrol after the
//     policy is flipped on, so flipping the switch never bricks a live
//     workspace. The grace clock starts at enforcedAt for each user.
//   * API-key callers are exempt by design. Their security model is
//     scope minimisation plus per-key IP allowlist plus per-key rate
//     limits, all already enforced elsewhere. There is no interactive
//     surface to prompt for a TOTP code mid-API-call.
//   * The mfa-policy endpoint itself, /v1/auth/*, /v1/mfa/*, /v1/sessions/*
//     and GDPR self-service export must remain reachable so a user gated
//     by the policy can still finish enrolment, sign out, or pull their
//     data on the way out.
//
// Persisted at <dataDir>/mfa-policy.json with atomic tmp+rename writes,
// matching workspace-freeze.json and legal-hold.json.

const FILE = 'mfa-policy.json';
const DEFAULT_WORKSPACE = 'default';

export const MAX_GRACE_DAYS = 90;
export const DEFAULT_GRACE_DAYS = 7;

export interface MfaPolicy {
  workspaceId: string;
  enforced: boolean;
  graceDays: number;
  // When the policy was last switched on. The grace window is measured
  // from this timestamp against the per-user "first seen" hint we record
  // below, so flipping enforcement back off and on resets the clock.
  enforcedAt: number | null;
  enforcedBy: string | null;
  disabledAt: number | null;
  disabledBy: string | null;
  updatedAt: number;
}

interface MfaPolicyFile {
  version: 1;
  policies: MfaPolicy[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): MfaPolicy {
  return {
    workspaceId,
    enforced: false,
    graceDays: DEFAULT_GRACE_DAYS,
    enforcedAt: null,
    enforcedBy: null,
    disabledAt: null,
    disabledBy: null,
    updatedAt: now,
  };
}

async function loadAll(dataDir: string): Promise<MfaPolicyFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as MfaPolicyFile;
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

async function saveAll(dataDir: string, all: MfaPolicyFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class MfaPolicyValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'MfaPolicyValidationError';
  }
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<MfaPolicy> {
  const all = await loadAll(dataDir);
  return all.policies.find((p) => p.workspaceId === workspaceId)
    ?? empty(workspaceId, Date.now());
}

export interface EnforceInput {
  graceDays?: number;
}

function normaliseGrace(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_GRACE_DAYS;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MfaPolicyValidationError('graceDays', 'graceDays must be a number');
  }
  const n = Math.floor(value);
  if (n < 0 || n > MAX_GRACE_DAYS) {
    throw new MfaPolicyValidationError(
      'graceDays',
      `graceDays must be between 0 and ${MAX_GRACE_DAYS}`,
    );
  }
  return n;
}

export async function enablePolicy(
  dataDir: string,
  actorUserId: string,
  input: EnforceInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<MfaPolicy> {
  const graceDays = normaliseGrace(input.graceDays);
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.policies.find((p) => p.workspaceId === workspaceId);
  const next: MfaPolicy = {
    workspaceId,
    enforced: true,
    graceDays,
    // Reset enforcement timestamp on every enable so flipping the policy
    // off and back on gives users a fresh grace window.
    enforcedAt: now,
    enforcedBy: actorUserId,
    disabledAt: existing?.disabledAt ?? null,
    disabledBy: existing?.disabledBy ?? null,
    updatedAt: now,
  };
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

export async function disablePolicy(
  dataDir: string,
  actorUserId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<MfaPolicy> {
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.policies.find((p) => p.workspaceId === workspaceId)
    ?? empty(workspaceId, now);
  const next: MfaPolicy = {
    ...existing,
    enforced: false,
    disabledAt: now,
    disabledBy: actorUserId,
    updatedAt: now,
  };
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

// Hot-path cache so the enforcement plugin can fire on every request
// without re-reading mfa-policy.json. TTL matches workspace-freeze (1s)
// so flipping the switch in one tab is visible in another within a
// second even without an explicit invalidation channel.
let cached: { policy: MfaPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<MfaPolicy> {
  const now = Date.now();
  if (cached && cached.policy.workspaceId === workspaceId && cached.expiresAt > now) {
    return cached.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  cached = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

// Routes that remain reachable for a session user who has not yet
// enrolled MFA. Anything outside this list is what the policy actually
// protects. The list is deliberately conservative: everything a gated
// user needs to finish enrolment, sign out cleanly, or pull their own
// data on the way out.
const ALLOW_PREFIXES: readonly string[] = Object.freeze([
  '/healthz',
  '/livez',
  '/readyz',
  '/metrics',
  '/auth',          // login / OIDC / GitHub / logout
  '/v1/mfa',        // enrol, confirm, verify, status
  '/v1/sessions',   // sign out, list devices, revoke
  '/v1/policies',   // accept any pending TOS/DPA before MFA blocks them
  '/v1/profile',    // see who you are
  '/v1/me',         // GDPR self-export / erase
  '/v1/onboarding', // first-run guidance
  '/v1/mfa-policy', // owners viewing the policy itself
]);

// HTTP methods that never change server state. Reading data is safe to
// allow even for a non-MFA user; the policy is about preventing writes
// from credentials that have not been hardened with a second factor.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMfaPolicyAllowedPath(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const path = (url.split('?')[0] ?? url);
  for (const p of ALLOW_PREFIXES) {
    if (path === p || path.startsWith(p + '/')) return true;
  }
  return false;
}

export interface EvaluationContext {
  // Milliseconds since epoch to evaluate "are we still inside the grace
  // window" against. Exposed for tests; production passes Date.now().
  now: number;
}

export type EvaluationResult =
  | { allowed: true }
  | { allowed: false; reason: 'not-enrolled'; graceEndsAt: number };

// Returns the gate decision for a single session-based user. API-key
// callers should not reach this; they are exempt at the plugin layer.
export async function evaluateUser(
  dataDir: string,
  userId: string,
  ctx: EvaluationContext = { now: Date.now() },
): Promise<EvaluationResult> {
  const policy = await getPolicyCached(dataDir);
  if (!policy.enforced) return { allowed: true };
  const mfa = await loadMfa(dataDir, userId).catch(() => null);
  if (mfa && mfa.confirmedAt) return { allowed: true };
  const enforcedAt = policy.enforcedAt ?? ctx.now;
  const graceEndsAt = enforcedAt + policy.graceDays * 24 * 60 * 60 * 1000;
  if (ctx.now < graceEndsAt) return { allowed: true };
  return { allowed: false, reason: 'not-enrolled', graceEndsAt };
}
