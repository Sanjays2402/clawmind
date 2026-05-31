import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { MEMBER_ROLES, type MemberRole } from './members.js';

// Break-glass / time-bound role elevation.
//
// Enterprise procurement (SOC2 CC6.3, ISO 27001 A.9.2.3, NIST AC-6(2)) asks
// the same question every time: "how do you grant temporary privileged
// access without giving people standing owner credentials?". ClawMind's
// answer is this service. A member or admin files a request to elevate
// to a higher role for a bounded window with a written reason; an owner
// (other than themselves) approves it; the auth plugin overlays the
// elevated role on req.user for the duration of the window; every
// elevated mutation is tagged in the audit log via the elevation id.
//
// Rules enforced here, not at the route, so a future SCIM/cron path
// cannot accidentally skip them:
//   - duration is bounded to [MIN_DURATION_MIN, MAX_DURATION_MIN]
//   - reason is required and length-bounded (compliance evidence)
//   - elevated role must be strictly higher than the requester's base role
//   - the approver cannot be the requester (4-eyes)
//   - already-active grants for the same user must be revoked before a
//     new one can start (no stacking of windows, predictable expiry)
//
// Storage matches the per-workspace settings family: single JSON document
// at <dataDir>/role-elevation.json, atomic rewrite, schema version 1.

export const MIN_DURATION_MIN = 5;
export const MAX_DURATION_MIN = 240; // 4 hours hard cap
export const MAX_REASON_LEN = 1000;
export const MAX_RECORDS = 500; // history cap; older pruned on write

export type ElevationStatus = 'pending' | 'approved' | 'revoked' | 'expired' | 'denied';

export interface ElevationRequest {
  id: string;
  userId: string;
  fromRole: MemberRole;
  toRole: MemberRole;
  reason: string;
  requestedAt: number;
  durationMinutes: number;
  status: ElevationStatus;
  approvedBy: string | null;
  approvedAt: number | null;
  expiresAt: number | null; // set once approved
  revokedBy: string | null;
  revokedAt: number | null;
  decisionReason: string | null;
}

interface RegistryFile {
  version: 1;
  records: ElevationRequest[];
}

const FILE = 'role-elevation.json';
const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(): RegistryFile {
  return { version: 1, records: [] };
}

async function read(dataDir: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) return empty();
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw err;
  }
}

async function write(dataDir: string, reg: RegistryFile): Promise<void> {
  await mkdir(dirname(file(dataDir)), { recursive: true });
  // Cap retained history.
  if (reg.records.length > MAX_RECORDS) {
    reg.records = reg.records.slice(-MAX_RECORDS);
  }
  const tmp = `${file(dataDir)}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(reg, null, 2), 'utf8');
  await rename(tmp, file(dataDir));
}

export class RoleElevationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'RoleElevationError';
  }
}

function normaliseRole(r: string): MemberRole | null {
  const v = r === 'reader' ? 'viewer' : r;
  return (MEMBER_ROLES as readonly string[]).includes(v) ? (v as MemberRole) : null;
}

export interface CreateInput {
  userId: string;
  fromRole: MemberRole;
  toRole: string;
  reason: string;
  durationMinutes: number;
}

export async function createRequest(
  dataDir: string,
  input: CreateInput,
  now: number = Date.now(),
): Promise<ElevationRequest> {
  const reason = (input.reason ?? '').trim();
  if (!reason) throw new RoleElevationError('reason is required', 'reason');
  if (reason.length > MAX_REASON_LEN) {
    throw new RoleElevationError(`reason exceeds ${MAX_REASON_LEN} chars`, 'reason');
  }
  if (
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes < MIN_DURATION_MIN ||
    input.durationMinutes > MAX_DURATION_MIN
  ) {
    throw new RoleElevationError(
      `durationMinutes must be ${MIN_DURATION_MIN}..${MAX_DURATION_MIN}`,
      'durationMinutes',
    );
  }
  const to = normaliseRole(input.toRole);
  if (!to) throw new RoleElevationError('toRole is not a known role', 'toRole');
  const from = input.fromRole;
  if (ROLE_RANK[to] <= ROLE_RANK[from]) {
    throw new RoleElevationError('toRole must be strictly higher than current role', 'toRole');
  }

  const reg = await read(dataDir);
  // Refuse stacking pending or active requests for the same user.
  for (const r of reg.records) {
    if (r.userId !== input.userId) continue;
    if (r.status === 'pending') {
      throw new RoleElevationError('a pending request already exists for this user');
    }
    if (r.status === 'approved' && r.expiresAt && r.expiresAt > now) {
      throw new RoleElevationError('an active elevation already exists for this user');
    }
  }

  const rec: ElevationRequest = {
    id: randomBytes(8).toString('hex'),
    userId: input.userId,
    fromRole: from,
    toRole: to,
    reason,
    requestedAt: now,
    durationMinutes: input.durationMinutes,
    status: 'pending',
    approvedBy: null,
    approvedAt: null,
    expiresAt: null,
    revokedBy: null,
    revokedAt: null,
    decisionReason: null,
  };
  reg.records.push(rec);
  await write(dataDir, reg);
  return rec;
}

export async function listRequests(dataDir: string): Promise<ElevationRequest[]> {
  const reg = await read(dataDir);
  return reg.records.slice().sort((a, b) => b.requestedAt - a.requestedAt);
}

export async function getRequest(dataDir: string, id: string): Promise<ElevationRequest | null> {
  const reg = await read(dataDir);
  return reg.records.find((r) => r.id === id) ?? null;
}

export async function approveRequest(
  dataDir: string,
  id: string,
  approverId: string,
  now: number = Date.now(),
): Promise<ElevationRequest> {
  const reg = await read(dataDir);
  const rec = reg.records.find((r) => r.id === id);
  if (!rec) throw new RoleElevationError('request not found');
  if (rec.status !== 'pending') {
    throw new RoleElevationError(`request is ${rec.status}, not pending`);
  }
  if (rec.userId === approverId) {
    throw new RoleElevationError('requester cannot approve their own elevation');
  }
  rec.status = 'approved';
  rec.approvedBy = approverId;
  rec.approvedAt = now;
  rec.expiresAt = now + rec.durationMinutes * 60_000;
  await write(dataDir, reg);
  return rec;
}

export async function denyRequest(
  dataDir: string,
  id: string,
  approverId: string,
  reason: string | null,
  now: number = Date.now(),
): Promise<ElevationRequest> {
  const reg = await read(dataDir);
  const rec = reg.records.find((r) => r.id === id);
  if (!rec) throw new RoleElevationError('request not found');
  if (rec.status !== 'pending') {
    throw new RoleElevationError(`request is ${rec.status}, not pending`);
  }
  if (rec.userId === approverId) {
    throw new RoleElevationError('requester cannot deny their own elevation');
  }
  rec.status = 'denied';
  rec.approvedBy = approverId;
  rec.approvedAt = now;
  rec.decisionReason = (reason ?? '').trim().slice(0, MAX_REASON_LEN) || null;
  await write(dataDir, reg);
  return rec;
}

export async function revokeRequest(
  dataDir: string,
  id: string,
  revokerId: string,
  now: number = Date.now(),
): Promise<ElevationRequest> {
  const reg = await read(dataDir);
  const rec = reg.records.find((r) => r.id === id);
  if (!rec) throw new RoleElevationError('request not found');
  if (rec.status !== 'approved') {
    throw new RoleElevationError(`request is ${rec.status}, not active`);
  }
  rec.status = 'revoked';
  rec.revokedBy = revokerId;
  rec.revokedAt = now;
  await write(dataDir, reg);
  return rec;
}

// Returns the active grant for a user, if any. An "active" grant is one
// that is approved, not revoked, and whose expiresAt is in the future.
// Read on the hot path (every authenticated request), so it does the
// minimum possible work and never throws on a missing file.
export async function getActiveGrant(
  dataDir: string,
  userId: string,
  now: number = Date.now(),
): Promise<ElevationRequest | null> {
  const reg = await read(dataDir).catch(() => empty());
  for (const r of reg.records) {
    if (r.userId !== userId) continue;
    if (r.status !== 'approved') continue;
    if (!r.expiresAt || r.expiresAt <= now) continue;
    if (r.revokedAt) continue;
    return r;
  }
  return null;
}

// Lazily mark expired grants. Called from the listing endpoint so the
// dashboard never shows "approved" for something that has timed out.
// Returns true if any record changed.
export async function sweepExpired(dataDir: string, now: number = Date.now()): Promise<boolean> {
  const reg = await read(dataDir);
  let changed = false;
  for (const r of reg.records) {
    if (r.status === 'approved' && r.expiresAt && r.expiresAt <= now) {
      r.status = 'expired';
      changed = true;
    }
  }
  if (changed) await write(dataDir, reg);
  return changed;
}

export const __test__ = { ROLE_RANK };
