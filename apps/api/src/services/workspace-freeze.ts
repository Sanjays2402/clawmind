import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace Freeze (a.k.a. workspace kill switch / suspension).
//
// When a workspace is frozen, all mutating endpoints are rejected with
// HTTP 423 Locked. Reads, exports, and audit access remain available so
// the customer can still pull their data while the workspace is paused.
// Owners can lift the freeze themselves; ops can also automate freeze
// from an off-platform admin tool by calling the same endpoint.
//
// Typical enterprise reasons for using freeze:
//
//   * Security incident: a credential leak suspected. Freeze stops new
//     writes / new outbound webhooks while incident response runs.
//   * Billing failure or contract termination grace period. The buyer
//     wants their data to remain accessible for export, but no new
//     ingestion or queries-with-side-effects should accrue.
//   * Customer offboarding wind-down before a scheduled erase.
//
// This is distinct from Legal Hold (which BLOCKS deletion to preserve
// data) and from per-user GDPR erase (which targets a single user).
// Freeze is the broad pause button: "nothing here changes until I say".
//
// On-disk layout: <dataDir>/workspace-freeze.json. Atomic rewrite via
// tmp+rename matching legal-hold.json and members.json.

export const MAX_REASON = 500;
export const MAX_TICKET = 200;
const DEFAULT_WORKSPACE = 'default';
const FILE = 'workspace-freeze.json';

export interface WorkspaceFreeze {
  workspaceId: string;
  active: boolean;
  reason: string | null;
  ticket: string | null;
  frozenBy: string | null;
  frozenAt: number | null;
  releasedBy: string | null;
  releasedAt: number | null;
  updatedAt: number;
}

export interface WorkspaceFreezeFile {
  version: 1;
  freezes: WorkspaceFreeze[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): WorkspaceFreeze {
  return {
    workspaceId,
    active: false,
    reason: null,
    ticket: null,
    frozenBy: null,
    frozenAt: null,
    releasedBy: null,
    releasedAt: null,
    updatedAt: now,
  };
}

async function loadAll(dataDir: string): Promise<WorkspaceFreezeFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as WorkspaceFreezeFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.freezes)) {
      return { version: 1, freezes: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, freezes: [] };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: WorkspaceFreezeFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class WorkspaceFreezeValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'WorkspaceFreezeValidationError';
  }
}

function normaliseString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new WorkspaceFreezeValidationError(field, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new WorkspaceFreezeValidationError(field, `${field} must be <= ${max} characters`);
  }
  return trimmed;
}

export async function getFreeze(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceFreeze> {
  const all = await loadAll(dataDir);
  return all.freezes.find((f) => f.workspaceId === workspaceId) ?? empty(workspaceId, Date.now());
}

// In-process memoisation. The freeze middleware fires on every request,
// so re-reading workspace-freeze.json each time would add a stat+read to
// the hot path. We cache the boolean for a short window and invalidate
// on any mutating call from the routes module. TTL is intentionally
// small (1s) so freeze changes propagate quickly across worker processes
// even without an explicit invalidation channel.
let cached: { active: boolean; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateFreezeCache(): void {
  cached = null;
}

export async function isFrozen(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.active;
  const f = await getFreeze(dataDir, workspaceId);
  cached = { active: f.active === true, expiresAt: now + CACHE_TTL_MS };
  return cached.active;
}

export interface FreezeInput {
  reason?: string | null;
  ticket?: string | null;
}

export async function freezeWorkspace(
  dataDir: string,
  actorUserId: string,
  input: FreezeInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceFreeze> {
  const reason = normaliseString(input.reason, 'reason', MAX_REASON);
  const ticket = normaliseString(input.ticket, 'ticket', MAX_TICKET);
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.freezes.find((f) => f.workspaceId === workspaceId);
  const next: WorkspaceFreeze = existing
    ? {
        ...existing,
        active: true,
        reason,
        ticket,
        frozenBy: actorUserId,
        frozenAt: existing.active ? existing.frozenAt : now,
        releasedBy: null,
        releasedAt: null,
        updatedAt: now,
      }
    : {
        workspaceId,
        active: true,
        reason,
        ticket,
        frozenBy: actorUserId,
        frozenAt: now,
        releasedBy: null,
        releasedAt: null,
        updatedAt: now,
      };
  const others = all.freezes.filter((f) => f.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, freezes: [...others, next] });
  invalidateFreezeCache();
  return next;
}

export async function releaseFreeze(
  dataDir: string,
  actorUserId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceFreeze> {
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.freezes.find((f) => f.workspaceId === workspaceId);
  if (!existing || !existing.active) {
    const e = existing ?? empty(workspaceId, now);
    return e;
  }
  const next: WorkspaceFreeze = {
    ...existing,
    active: false,
    releasedBy: actorUserId,
    releasedAt: now,
    updatedAt: now,
  };
  const others = all.freezes.filter((f) => f.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, freezes: [...others, next] });
  invalidateFreezeCache();
  return next;
}

// Methods that never mutate workspace state. Anything outside this set
// is treated as a write and blocked when the workspace is frozen.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Routes (by exact URL or prefix) that remain available even when the
// workspace is frozen. The freeze endpoint itself MUST be reachable so
// owners can unfreeze. Auth/session/MFA endpoints stay open so users can
// still sign in to perform recovery actions. GDPR export stays open so
// the customer can retrieve their data during the pause.
const FREEZE_ALLOWLIST_EXACT = new Set<string>([
  '/v1/workspace/freeze',
  '/v1/auth/logout',
  '/v1/sessions/logout',
]);

const FREEZE_ALLOWLIST_PREFIXES: readonly string[] = [
  '/v1/auth/', // login, oidc callback, github callback
  '/v1/me/data/export', // GDPR export bundle download
  '/v1/mfa/', // step-up still works so an owner can unfreeze
  '/v1/sessions/', // sign out / revoke
];

export function isFreezeAllowedPath(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  // Strip query string for matching.
  const path = url.split('?')[0] ?? url;
  if (FREEZE_ALLOWLIST_EXACT.has(path)) return true;
  for (const prefix of FREEZE_ALLOWLIST_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}
