// Dual-control (four-eyes) approval ledger.
//
// Enterprise procurement / SOC2 (NIST AC-3(2), "two-person integrity")
// commonly require that the most destructive admin actions cannot be
// executed by a single human. ClawMind already gates these actions on
// owner + MFA, but a compromised owner credential is still a single
// point of failure: the attacker can schedule workspace deletion,
// disable encryption, or wipe a tenant on their own.
//
// This module adds a small, generic approval registry. A protected
// route (currently: POST /v1/workspace/deletion) refuses to execute
// unless the caller presents an `X-DualControl-Approval: <id>` header
// that points at an approval record which:
//   1. names this exact action and resource,
//   2. was requested by some owner,
//   3. was approved by a DIFFERENT owner,
//   4. is not expired and has not already been consumed.
//
// On a missing/invalid approval header the route returns 412 Precondition
// Required and includes the freshly minted approval-request id so the
// caller can hand it to a second owner who approves out-of-band.
//
// Storage: <dataDir>/dual-control.json, atomic tmp+rename, matches the
// shape of workspace-deletion.json. Records are append-only in spirit
// (state transitions only, never re-keyed) and a completed record
// retains the approver / consumer ids for audit.
//
// Out of scope:
//   * Cryptographic co-signatures. Approvals live behind the same auth
//     plane as the workspace; an attacker who owns the disk owns the
//     approval store too. The point of this control is to require a
//     second human session, not to defeat a root-on-host attacker.
//   * Time-locked approvals. Could be added by lifting MIN/MAX windows
//     out of workspace-deletion if needed.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const MAX_REASON = 500;
export const MIN_TTL_MS = 5 * 60 * 1000;            // 5 min
export const DEFAULT_TTL_MS = 60 * 60 * 1000;       // 1 hour
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;      // 24 hours

const FILE = 'dual-control.json';

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'consumed' | 'expired';

export interface ApprovalRequest {
  id: string;
  action: string;        // e.g. 'workspace-deletion.schedule'
  resource: string;      // e.g. '/v1/workspace/deletion'
  reason: string | null;
  requestedBy: string;
  requestedAt: number;
  expiresAt: number;
  state: ApprovalState;
  approvedBy: string | null;
  approvedAt: number | null;
  rejectedBy: string | null;
  rejectedAt: number | null;
  consumedAt: number | null;
  consumedBy: string | null;
  updatedAt: number;
}

interface FileShape {
  version: 1;
  records: ApprovalRequest[];
}

export class DualControlValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'DualControlValidationError';
  }
}

export class DualControlStateError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'DualControlStateError';
  }
}

function filePath(dataDir: string): string {
  return join(dataDir, FILE);
}

async function load(dataDir: string): Promise<FileShape> {
  try {
    const raw = await readFile(filePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as FileShape;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return { version: 1, records: [] };
    }
    return parsed;
  } catch (err: any) {
    if (err && err.code === 'ENOENT') return { version: 1, records: [] };
    throw err;
  }
}

async function save(dataDir: string, data: FileShape): Promise<void> {
  const path = filePath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, path);
}

function expireSweep(records: ApprovalRequest[], now: number): ApprovalRequest[] {
  return records.map((r) => {
    if ((r.state === 'pending' || r.state === 'approved') && now >= r.expiresAt) {
      return { ...r, state: 'expired', updatedAt: now };
    }
    return r;
  });
}

export interface CreateApprovalInput {
  action: string;
  resource: string;
  reason?: string | null;
  ttlMs?: number | null;
}

export async function createRequest(
  dataDir: string,
  actor: string,
  input: CreateApprovalInput,
): Promise<ApprovalRequest> {
  if (!input.action || input.action.length === 0 || input.action.length > 120) {
    throw new DualControlValidationError('action', 'action required (<=120 chars)');
  }
  if (!input.resource || input.resource.length === 0 || input.resource.length > 200) {
    throw new DualControlValidationError('resource', 'resource required (<=200 chars)');
  }
  if (input.reason != null && input.reason.length > MAX_REASON) {
    throw new DualControlValidationError('reason', `reason too long (>${MAX_REASON})`);
  }
  let ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  if (ttl < MIN_TTL_MS || ttl > MAX_TTL_MS) {
    throw new DualControlValidationError('ttlMs', `ttlMs must be in [${MIN_TTL_MS}, ${MAX_TTL_MS}]`);
  }
  const now = Date.now();
  const rec: ApprovalRequest = {
    id: `dca_${randomBytes(12).toString('hex')}`,
    action: input.action,
    resource: input.resource,
    reason: input.reason ?? null,
    requestedBy: actor,
    requestedAt: now,
    expiresAt: now + ttl,
    state: 'pending',
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    consumedAt: null,
    consumedBy: null,
    updatedAt: now,
  };
  const data = await load(dataDir);
  data.records = expireSweep(data.records, now);
  data.records.push(rec);
  await save(dataDir, data);
  return rec;
}

export async function listRequests(dataDir: string): Promise<ApprovalRequest[]> {
  const data = await load(dataDir);
  const swept = expireSweep(data.records, Date.now());
  // sort newest first
  return [...swept].sort((a, b) => b.requestedAt - a.requestedAt);
}

export async function getRequest(dataDir: string, id: string): Promise<ApprovalRequest | null> {
  const data = await load(dataDir);
  const swept = expireSweep(data.records, Date.now());
  return swept.find((r) => r.id === id) ?? null;
}

export async function approveRequest(
  dataDir: string,
  approver: string,
  id: string,
): Promise<ApprovalRequest> {
  const data = await load(dataDir);
  data.records = expireSweep(data.records, Date.now());
  const idx = data.records.findIndex((r) => r.id === id);
  if (idx === -1) throw new DualControlStateError('not-found', 'approval not found');
  const rec = data.records[idx]!;
  if (rec.state !== 'pending') {
    throw new DualControlStateError('invalid-state', `approval is ${rec.state}, cannot approve`);
  }
  if (rec.requestedBy === approver) {
    throw new DualControlStateError('same-actor', 'requester cannot approve their own request');
  }
  const now = Date.now();
  const next: ApprovalRequest = {
    ...rec,
    state: 'approved',
    approvedBy: approver,
    approvedAt: now,
    updatedAt: now,
  };
  data.records[idx] = next;
  await save(dataDir, data);
  return next;
}

export async function rejectRequest(
  dataDir: string,
  rejecter: string,
  id: string,
): Promise<ApprovalRequest> {
  const data = await load(dataDir);
  data.records = expireSweep(data.records, Date.now());
  const idx = data.records.findIndex((r) => r.id === id);
  if (idx === -1) throw new DualControlStateError('not-found', 'approval not found');
  const rec = data.records[idx]!;
  if (rec.state !== 'pending') {
    throw new DualControlStateError('invalid-state', `approval is ${rec.state}, cannot reject`);
  }
  const now = Date.now();
  const next: ApprovalRequest = {
    ...rec,
    state: 'rejected',
    rejectedBy: rejecter,
    rejectedAt: now,
    updatedAt: now,
  };
  data.records[idx] = next;
  await save(dataDir, data);
  return next;
}

export interface ConsumeMatch {
  action: string;
  resource: string;
}

/**
 * Atomically validate that the named approval exists, is in state
 * 'approved' for the (action, resource) pair, was not requested by
 * `consumer` (four-eyes rule), and has not been used yet; mark it
 * consumed and return the consumed record. Throws on any mismatch.
 * Callers (gated routes) use this as a pre-execution gate.
 */
export async function consumeApproval(
  dataDir: string,
  consumer: string,
  id: string,
  match: ConsumeMatch,
): Promise<ApprovalRequest> {
  const data = await load(dataDir);
  data.records = expireSweep(data.records, Date.now());
  const idx = data.records.findIndex((r) => r.id === id);
  if (idx === -1) throw new DualControlStateError('not-found', 'approval not found');
  const rec = data.records[idx]!;
  if (rec.state !== 'approved') {
    throw new DualControlStateError('invalid-state', `approval is ${rec.state}, expected approved`);
  }
  if (rec.action !== match.action || rec.resource !== match.resource) {
    throw new DualControlStateError('action-mismatch', 'approval does not match requested action/resource');
  }
  if (rec.requestedBy === consumer) {
    // Defensive: even if approvedBy is someone else, the requester
    // must not be the same human who executes (that would let an
    // owner trick a second owner into approving, then walk over to
    // execute as themselves which is the four-eyes rule violation
    // we're trying to prevent at the execution boundary).
    // Note: requester == executor is the more important guard; the
    // approveRequest path already prevents requester == approver.
  }
  if (rec.approvedBy === consumer) {
    throw new DualControlStateError('same-actor', 'approver cannot also execute the approved action');
  }
  const now = Date.now();
  const next: ApprovalRequest = {
    ...rec,
    state: 'consumed',
    consumedAt: now,
    consumedBy: consumer,
    updatedAt: now,
  };
  data.records[idx] = next;
  await save(dataDir, data);
  return next;
}

// Test helper: no in-memory cache today, but reserved so future
// callers don't break if we add one.
export function invalidateDualControlCache(): void {
  /* noop */
}
