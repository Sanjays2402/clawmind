import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace Scheduled Deletion (GDPR Article 17 "right to erasure" at the
// tenant level).
//
// Per-user data lifecycle already lives in services/lifecycle.ts. This
// module covers the contractual exit clause every procurement security
// review demands of a vendor: "we, the customer, can wipe the entire
// workspace on a documented timer, see the countdown, and pull the plug
// (or change our minds) before it runs".
//
// State machine:
//
//   none       (default, no file or { state: 'none' })
//      |  POST /v1/workspace/deletion   owner + MFA
//      v
//   pending    countdown running; every mutating request is blocked
//      |        (auth + read + export + the deletion endpoint stay open
//      |         so the customer can still pull a final export and the
//      |         owner can cancel)
//      |
//      +--  DELETE /v1/workspace/deletion   owner + MFA  -->  cancelled
//      |    (history of frozenAt / scheduledFor preserved for audit)
//      |
//      +--  scheduledFor reached, operator runs the wipe job (out of
//           band) and POSTs /v1/workspace/deletion/complete -->  completed
//           Service exposes isPastDue() so the doctor route + alerts can
//           surface a pending deletion that has slipped its window.
//
// The minimum grace window is intentionally clamped at one hour so a
// fat-finger from the owner can always be reversed; the maximum (90
// days) caps liability for stale "soft deleted" data that procurement
// auditors otherwise flag as a residency / retention violation. The
// default of 7 days matches what SaaS exit clauses commonly cite.
//
// What this module does NOT do:
//   * Actually delete the workspace data. The wipe itself is operator
//     responsibility (out-of-band script that rm -rf's the dataDir
//     after final export). Coupling the wipe to an in-process timer
//     would lose the schedule on every restart and would make a panic
//     "cancel" race the deletion thread.
//   * Touch legal hold. A scheduled deletion does NOT bypass legal
//     hold. The operator wipe script must check legal-hold.json and
//     refuse to run if active, same as every other destructive path.
//
// On-disk layout: <dataDir>/workspace-deletion.json. Atomic tmp+rename
// matching workspace-freeze.json / legal-hold.json conventions.

export const MAX_REASON = 500;
export const MAX_TICKET = 200;

// Grace window guardrails (milliseconds). The clamp is enforced server
// side so a malicious or misconfigured client cannot schedule a wipe
// that runs in the next millisecond.
export const MIN_GRACE_MS = 60 * 60 * 1000;            // 1 hour
export const DEFAULT_GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_GRACE_MS = 90 * 24 * 60 * 60 * 1000;  // 90 days

const DEFAULT_WORKSPACE = 'default';
const FILE = 'workspace-deletion.json';

export type DeletionState = 'none' | 'pending' | 'cancelled' | 'completed';

export interface WorkspaceDeletion {
  workspaceId: string;
  state: DeletionState;
  reason: string | null;
  ticket: string | null;
  /** Milliseconds in the configured grace window. Null when state=none. */
  graceMs: number | null;
  /** Epoch ms the owner scheduled the wipe. */
  scheduledAt: number | null;
  /** Epoch ms the wipe is allowed to run. */
  scheduledFor: number | null;
  scheduledBy: string | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  completedAt: number | null;
  completedBy: string | null;
  updatedAt: number;
}

interface DeletionFile {
  version: 1;
  records: WorkspaceDeletion[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(workspaceId: string, now: number): WorkspaceDeletion {
  return {
    workspaceId,
    state: 'none',
    reason: null,
    ticket: null,
    graceMs: null,
    scheduledAt: null,
    scheduledFor: null,
    scheduledBy: null,
    cancelledAt: null,
    cancelledBy: null,
    completedAt: null,
    completedBy: null,
    updatedAt: now,
  };
}

async function loadAll(dataDir: string): Promise<DeletionFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as DeletionFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return { version: 1, records: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, records: [] };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: DeletionFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class WorkspaceDeletionValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'WorkspaceDeletionValidationError';
  }
}

export class WorkspaceDeletionStateError extends Error {
  constructor(public state: DeletionState, message: string) {
    super(message);
    this.name = 'WorkspaceDeletionStateError';
  }
}

function normaliseString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new WorkspaceDeletionValidationError(field, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new WorkspaceDeletionValidationError(field, `${field} must be <= ${max} characters`);
  }
  return trimmed;
}

function clampGrace(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_GRACE_MS;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkspaceDeletionValidationError('graceMs', 'graceMs must be a finite number');
  }
  if (value < MIN_GRACE_MS) {
    throw new WorkspaceDeletionValidationError(
      'graceMs',
      `graceMs must be >= ${MIN_GRACE_MS} (1 hour minimum)`,
    );
  }
  if (value > MAX_GRACE_MS) {
    throw new WorkspaceDeletionValidationError(
      'graceMs',
      `graceMs must be <= ${MAX_GRACE_MS} (90 day maximum)`,
    );
  }
  return Math.floor(value);
}

export async function getDeletion(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceDeletion> {
  const all = await loadAll(dataDir);
  return all.records.find((d) => d.workspaceId === workspaceId) ?? empty(workspaceId, Date.now());
}

// In-process memoisation. The gating middleware fires on every mutating
// request so a stat+read per call would add measurable latency. Mirror
// the workspace-freeze cache: 1s TTL plus explicit invalidation on
// every write through this module.
let cached: { pending: boolean; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateDeletionCache(): void {
  cached = null;
}

export async function isPending(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.pending;
  const d = await getDeletion(dataDir, workspaceId);
  cached = { pending: d.state === 'pending', expiresAt: now + CACHE_TTL_MS };
  return cached.pending;
}

export function isPastDue(d: WorkspaceDeletion, now: number = Date.now()): boolean {
  return d.state === 'pending' && d.scheduledFor !== null && d.scheduledFor <= now;
}

export interface ScheduleInput {
  reason?: string | null;
  ticket?: string | null;
  graceMs?: number | null;
}

export async function scheduleDeletion(
  dataDir: string,
  actorUserId: string,
  input: ScheduleInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceDeletion> {
  const reason = normaliseString(input.reason, 'reason', MAX_REASON);
  const ticket = normaliseString(input.ticket, 'ticket', MAX_TICKET);
  const graceMs = clampGrace(input.graceMs ?? null);
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.records.find((d) => d.workspaceId === workspaceId);
  if (existing && existing.state === 'pending') {
    throw new WorkspaceDeletionStateError(
      'pending',
      'A deletion is already scheduled. Cancel it first to reschedule.',
    );
  }
  if (existing && existing.state === 'completed') {
    throw new WorkspaceDeletionStateError(
      'completed',
      'This workspace has already been deleted.',
    );
  }
  const next: WorkspaceDeletion = {
    workspaceId,
    state: 'pending',
    reason,
    ticket,
    graceMs,
    scheduledAt: now,
    scheduledFor: now + graceMs,
    scheduledBy: actorUserId,
    cancelledAt: null,
    cancelledBy: null,
    completedAt: null,
    completedBy: null,
    updatedAt: now,
  };
  const others = all.records.filter((d) => d.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, records: [...others, next] });
  invalidateDeletionCache();
  return next;
}

export async function cancelDeletion(
  dataDir: string,
  actorUserId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceDeletion> {
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.records.find((d) => d.workspaceId === workspaceId);
  if (!existing || existing.state !== 'pending') {
    throw new WorkspaceDeletionStateError(
      existing?.state ?? 'none',
      'No pending deletion to cancel.',
    );
  }
  const next: WorkspaceDeletion = {
    ...existing,
    state: 'cancelled',
    cancelledAt: now,
    cancelledBy: actorUserId,
    updatedAt: now,
  };
  const others = all.records.filter((d) => d.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, records: [...others, next] });
  invalidateDeletionCache();
  return next;
}

export async function markCompleted(
  dataDir: string,
  actorUserId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<WorkspaceDeletion> {
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.records.find((d) => d.workspaceId === workspaceId);
  if (!existing || existing.state !== 'pending') {
    throw new WorkspaceDeletionStateError(
      existing?.state ?? 'none',
      'Cannot mark completed: no pending deletion.',
    );
  }
  if (!isPastDue(existing, now)) {
    throw new WorkspaceDeletionStateError(
      'pending',
      'Cannot mark completed before scheduledFor.',
    );
  }
  const next: WorkspaceDeletion = {
    ...existing,
    state: 'completed',
    completedAt: now,
    completedBy: actorUserId,
    updatedAt: now,
  };
  const others = all.records.filter((d) => d.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, records: [...others, next] });
  invalidateDeletionCache();
  return next;
}

// Read-method + allowlist gating: identical philosophy to workspace-freeze.
// The customer must always be able to (a) read their data, (b) pull a final
// export, (c) authenticate to cancel the deletion, and (d) hit the
// deletion endpoint itself. Anything else returns 423 Locked while a
// deletion is pending so no fresh writes accrue during the wind-down.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const DELETION_ALLOWLIST_EXACT = new Set<string>([
  '/v1/workspace/deletion',
  '/v1/workspace/deletion/complete',
  '/v1/auth/logout',
  '/v1/sessions/logout',
]);

const DELETION_ALLOWLIST_PREFIXES: readonly string[] = [
  '/v1/auth/',
  '/v1/mfa/',
  '/v1/sessions/',
  '/v1/me/data/export',
  '/v1/workspace/export',
];

export function isDeletionAllowedPath(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const path = url.split('?')[0] ?? url;
  if (DELETION_ALLOWLIST_EXACT.has(path)) return true;
  for (const prefix of DELETION_ALLOWLIST_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}
