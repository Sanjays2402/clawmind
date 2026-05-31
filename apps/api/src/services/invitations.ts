import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  inviteMember,
  meetsMinRole,
  type MemberRole,
  MEMBER_ROLES,
} from './members.js';

// Email-token workspace invitations.
//
// The existing members service only accepted invites keyed on a known
// `userId`, which assumed the admin already knew the OIDC subject of the
// invitee. Real enterprise onboarding looks like: "send an email link
// to alice@acme.com, pre-bind her to the `member` role, expire the link
// in 7 days, and let our security team revoke unused invites." That is
// what this module backs.
//
// Storage: <dataDir>/invitations.json, atomic rewrite.
// Tokens are 32 random bytes, base64url. We never store the raw token,
// only its sha256 digest, exactly the same way api-keys are kept, so a
// disk leak does not let an attacker walk in through a pending invite.

export const MAX_EMAIL_LEN = 320;
export const MAX_LABEL_LEN = 200;
export const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationRecord {
  id: string;
  tokenHash: string;
  email: string;
  role: MemberRole;
  label: string | null;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  acceptedByUserId: string | null;
  revokedAt: number | null;
  revokedBy: string | null;
}

export type InvitationView = Omit<InvitationRecord, 'tokenHash'> & {
  status: InvitationStatus;
};

interface RegistryFile {
  version: 1;
  invitations: InvitationRecord[];
}

function regPath(dataDir: string): string {
  return join(dataDir, 'invitations.json');
}

async function readReg(dataDir: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(regPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.invitations)) {
      return { version: 1, invitations: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, invitations: [] };
    }
    throw err;
  }
}

async function writeReg(dataDir: string, file: RegistryFile): Promise<void> {
  const p = regPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function constantEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function statusOf(rec: InvitationRecord, now: number): InvitationStatus {
  if (rec.revokedAt) return 'revoked';
  if (rec.acceptedAt) return 'accepted';
  if (rec.expiresAt <= now) return 'expired';
  return 'pending';
}

export function toView(rec: InvitationRecord, now = Date.now()): InvitationView {
  const { tokenHash: _omit, ...rest } = rec;
  return { ...rest, status: statusOf(rec, now) };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s;
}

export interface CreateInvitationInput {
  email: string;
  role: MemberRole;
  invitedBy: string;
  invitedByRole: MemberRole;
  label?: string | null;
  ttlMs?: number;
}

export type CreateResult =
  | { ok: true; record: InvitationRecord; token: string }
  | { ok: false; code: 'forbidden-role'; message: string }
  | { ok: false; code: 'invalid-email' }
  | { ok: false; code: 'duplicate'; existingId: string };

// Only let the caller mint an invitation that grants a role at or below
// their own rank, mirroring members.canActOn(). Admins cannot create
// owner invites; viewers and members cannot mint anything.
function canMint(actor: MemberRole, target: MemberRole): boolean {
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'owner';
  return false;
}

export async function createInvitation(
  dataDir: string,
  input: CreateInvitationInput,
): Promise<CreateResult> {
  if (!MEMBER_ROLES.includes(input.role)) {
    return { ok: false, code: 'forbidden-role', message: `unknown role ${input.role}` };
  }
  if (!canMint(input.invitedByRole, input.role)) {
    return {
      ok: false,
      code: 'forbidden-role',
      message: `role ${input.invitedByRole} cannot invite ${input.role}`,
    };
  }
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > MAX_EMAIL_LEN) {
    return { ok: false, code: 'invalid-email' };
  }
  const now = Date.now();
  const ttl = Math.max(60_000, Math.min(input.ttlMs ?? DEFAULT_TTL_MS, MAX_TTL_MS));
  const file = await readReg(dataDir);
  // Reject if there's already an active (pending) invite for this email.
  const dup = file.invitations.find(
    (i) => i.email === email && statusOf(i, now) === 'pending',
  );
  if (dup) return { ok: false, code: 'duplicate', existingId: dup.id };
  const token = randomBytes(32).toString('base64url');
  const rec: InvitationRecord = {
    id: `inv_${randomBytes(8).toString('hex')}`,
    tokenHash: hashToken(token),
    email,
    role: input.role,
    label: input.label ? clip(input.label, MAX_LABEL_LEN) : null,
    invitedBy: input.invitedBy,
    createdAt: now,
    expiresAt: now + ttl,
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    revokedBy: null,
  };
  file.invitations.push(rec);
  await writeReg(dataDir, file);
  return { ok: true, record: rec, token };
}

export async function listInvitations(dataDir: string): Promise<InvitationView[]> {
  const file = await readReg(dataDir);
  const now = Date.now();
  return file.invitations
    .map((r) => toView(r, now))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export type RevokeResult =
  | { ok: true; record: InvitationView }
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'already-final' };

export async function revokeInvitation(
  dataDir: string,
  id: string,
  actor: { userId: string; role: MemberRole },
): Promise<RevokeResult> {
  const file = await readReg(dataDir);
  const idx = file.invitations.findIndex((i) => i.id === id);
  if (idx === -1) return { ok: false, code: 'not-found' };
  const rec = file.invitations[idx]!;
  const now = Date.now();
  const s = statusOf(rec, now);
  if (s !== 'pending') return { ok: false, code: 'already-final' };
  // Admins cannot revoke an owner-issued invite that grants owner.
  if (!canMint(actor.role, rec.role)) {
    return { ok: false, code: 'already-final' };
  }
  rec.revokedAt = now;
  rec.revokedBy = actor.userId;
  await writeReg(dataDir, file);
  return { ok: true, record: toView(rec, now) };
}

export interface PeekResult {
  email: string;
  role: MemberRole;
  label: string | null;
  expiresAt: number;
  status: InvitationStatus;
}

// Lookup by raw token without consuming it. Used by the accept-page so
// the recipient sees what role they are about to claim before clicking
// Accept. Returns null on unknown / non-pending tokens so we do not leak
// information about revoked or accepted invitations.
export async function peekByToken(
  dataDir: string,
  token: string,
): Promise<PeekResult | null> {
  if (!token || token.length < 16) return null;
  const hash = hashToken(token);
  const file = await readReg(dataDir);
  const now = Date.now();
  for (const inv of file.invitations) {
    if (constantEq(inv.tokenHash, hash)) {
      const status = statusOf(inv, now);
      if (status !== 'pending') return null;
      return {
        email: inv.email,
        role: inv.role,
        label: inv.label,
        expiresAt: inv.expiresAt,
        status,
      };
    }
  }
  return null;
}

export type AcceptResult =
  | { ok: true; record: InvitationView; assignedRole: MemberRole }
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'expired' }
  | { ok: false; code: 'revoked' }
  | { ok: false; code: 'consumed' }
  | { ok: false; code: 'email-mismatch'; expected: string };

export interface AcceptInput {
  token: string;
  userId: string;
  userEmail: string | null;
  requireEmailMatch?: boolean;
}

// Atomically:
//   1. Verify the token against a pending, unexpired invitation.
//   2. Optionally enforce that the authenticated user's email matches
//      the one the invite was issued to (defence against link forwarding).
//   3. Mark the invitation as accepted (single-use).
//   4. Pre-register the userId in the members service at the invited role
//      via inviteMember(). The first OIDC login picks it up.
export async function acceptInvitation(
  dataDir: string,
  input: AcceptInput,
): Promise<AcceptResult> {
  const hash = hashToken(input.token);
  const file = await readReg(dataDir);
  const idx = file.invitations.findIndex((i) => constantEq(i.tokenHash, hash));
  if (idx === -1) return { ok: false, code: 'not-found' };
  const rec = file.invitations[idx]!;
  const now = Date.now();
  if (rec.revokedAt) return { ok: false, code: 'revoked' };
  if (rec.acceptedAt) return { ok: false, code: 'consumed' };
  if (rec.expiresAt <= now) return { ok: false, code: 'expired' };
  if (input.requireEmailMatch !== false) {
    const actual = (input.userEmail ?? '').trim().toLowerCase();
    if (!actual || actual !== rec.email) {
      return { ok: false, code: 'email-mismatch', expected: rec.email };
    }
  }
  rec.acceptedAt = now;
  rec.acceptedByUserId = input.userId;
  await writeReg(dataDir, file);
  // Bind the role into the members registry. If the user record already
  // exists at a higher rank, inviteMember is a no-op for the role (it
  // never demotes), which is the conservative behaviour we want.
  await inviteMember(dataDir, {
    userId: input.userId,
    role: rec.role,
    email: rec.email,
    label: rec.label,
    invitedBy: rec.invitedBy,
  });
  return { ok: true, record: toView(rec, now), assignedRole: rec.role };
}
