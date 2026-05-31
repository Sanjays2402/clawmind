import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace-wide Legal Hold.
//
// When a legal hold is active, ClawMind must preserve user-generated
// records regardless of any per-user retention policy or self-service
// deletion request. This is a hard SOC2 / e-discovery requirement that
// procurement teams audit before signing: "if your enterprise customer
// is subject to litigation, you must be able to freeze deletion across
// their workspace, document who froze it and why, and demonstrate that
// scheduled erasure was actually suppressed during the hold."
//
// Scope of what this module guards (enforced at the route/service layer
// that imports `assertNotOnHold` / `isLegalHoldActive`):
//
//   * DELETE /v1/me/data                  (self-service GDPR erase)
//   * POST   /v1/retention/apply          (scheduled retention sweep)
//   * Any future bulk-delete admin tools
//
// What it intentionally does NOT do:
//
//   * Block reads, exports, or normal product usage. Holds preserve, they
//     do not lock the workspace.
//   * Truncate or rewrite the immutable audit log. Audit entries are
//     hash-chained elsewhere and are always retained.
//   * Touch single-record user actions like editing a note title; only
//     bulk/destructive deletion is suppressed. Per-message product UX is
//     unaffected so an active hold is invisible to end users until they
//     attempt an erase.
//
// On-disk layout: <dataDir>/legal-hold.json. Atomic rewrite via tmp+rename
// matching the rest of the data layer (members.json, profile.json, etc.).
// Single record per workspace; ClawMind ships as a single-tenant
// deployment so "workspace" == "deployment". Multi-tenant SaaS callers
// pass a stable workspaceId; default is 'default'.

export const MAX_REASON = 500;
export const MAX_TICKET = 200;

export interface LegalHold {
  workspaceId: string;
  active: boolean;
  reason: string | null;
  ticket: string | null; // External case / ticket reference (e.g. JIRA-42)
  imposedBy: string | null; // userId of the owner who activated
  imposedAt: number | null;
  releasedBy: string | null;
  releasedAt: number | null;
  updatedAt: number;
}

export interface LegalHoldFile {
  version: 1;
  holds: LegalHold[];
}

const FILE = 'legal-hold.json';
const DEFAULT_WORKSPACE = 'default';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function emptyHold(workspaceId: string, now: number): LegalHold {
  return {
    workspaceId,
    active: false,
    reason: null,
    ticket: null,
    imposedBy: null,
    imposedAt: null,
    releasedBy: null,
    releasedAt: null,
    updatedAt: now,
  };
}

async function loadAll(dataDir: string): Promise<LegalHoldFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as LegalHoldFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.holds)) {
      return { version: 1, holds: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, holds: [] };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: LegalHoldFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class LegalHoldValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = 'LegalHoldValidationError';
  }
}

export class LegalHoldActiveError extends Error {
  constructor(public hold: LegalHold) {
    super(`Operation blocked: workspace is under a legal hold imposed at ${new Date(hold.imposedAt ?? 0).toISOString()}`);
    this.name = 'LegalHoldActiveError';
  }
}

function normaliseString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new LegalHoldValidationError(field, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new LegalHoldValidationError(field, `${field} must be <= ${max} characters`);
  }
  return trimmed;
}

export async function getHold(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<LegalHold> {
  const all = await loadAll(dataDir);
  const hit = all.holds.find((h) => h.workspaceId === workspaceId);
  return hit ?? emptyHold(workspaceId, Date.now());
}

export async function isLegalHoldActive(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<boolean> {
  const h = await getHold(dataDir, workspaceId);
  return h.active === true;
}

/**
 * Throw LegalHoldActiveError if a workspace-level legal hold is active.
 * Call this at the top of every delete/erase code path.
 */
export async function assertNotOnHold(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<void> {
  const hold = await getHold(dataDir, workspaceId);
  if (hold.active) throw new LegalHoldActiveError(hold);
}

export interface ImposeInput {
  reason?: string | null;
  ticket?: string | null;
}

export async function imposeHold(
  dataDir: string,
  actorUserId: string,
  input: ImposeInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<LegalHold> {
  const reason = normaliseString(input.reason, 'reason', MAX_REASON);
  const ticket = normaliseString(input.ticket, 'ticket', MAX_TICKET);
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.holds.find((h) => h.workspaceId === workspaceId);
  const next: LegalHold = existing
    ? {
        ...existing,
        active: true,
        reason,
        ticket,
        imposedBy: actorUserId,
        imposedAt: existing.active ? existing.imposedAt : now,
        releasedBy: null,
        releasedAt: null,
        updatedAt: now,
      }
    : {
        workspaceId,
        active: true,
        reason,
        ticket,
        imposedBy: actorUserId,
        imposedAt: now,
        releasedBy: null,
        releasedAt: null,
        updatedAt: now,
      };
  const others = all.holds.filter((h) => h.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, holds: [...others, next] });
  return next;
}

export async function releaseHold(
  dataDir: string,
  actorUserId: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<LegalHold> {
  const now = Date.now();
  const all = await loadAll(dataDir);
  const existing = all.holds.find((h) => h.workspaceId === workspaceId);
  if (!existing || !existing.active) {
    // Idempotent: releasing an inactive hold is a no-op and returns
    // the current (inactive) record so the UI can refresh without
    // bouncing a 409 at the operator.
    return existing ?? emptyHold(workspaceId, now);
  }
  const next: LegalHold = {
    ...existing,
    active: false,
    releasedBy: actorUserId,
    releasedAt: now,
    updatedAt: now,
  };
  const others = all.holds.filter((h) => h.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, holds: [...others, next] });
  return next;
}
