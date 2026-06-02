import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Per-user role registry. ClawMind defaults to a single-owner deployment,
// but enterprise buyers expect to delegate administrative work without
// handing out full owner credentials. This service backs a 4-role RBAC
// model on top of the existing auth plugin:
//
//   owner   - all administrative power, ultimate deployment authority,
//             can promote/demote anyone including other owners. Cannot be
//             demoted while they are the last owner standing.
//   admin   - can manage members, sessions, keys, webhooks, retention,
//             but cannot remove or demote an owner.
//   member  - regular product usage. Can read/write their own data.
//   viewer  - read-only product access. Cannot mutate.
//
// On-disk layout: <dataDir>/members.json, atomic-rewrite, schema below.
// First user who logs into a fresh deployment is auto-bootstrapped as
// owner so the deployment is never role-less. Subsequent users get the
// default role (member) until an owner or admin promotes them.

export const MEMBER_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

export const MAX_EMAIL_LEN = 320;
export const MAX_LABEL_LEN = 200;

export interface MemberRecord {
  userId: string;
  role: MemberRole;
  email: string | null;
  label: string | null;
  invitedBy: string | null;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
}

interface RegistryFile {
  version: 1;
  members: MemberRecord[];
}

function registryPath(dataDir: string): string {
  return join(dataDir, 'members.json');
}

async function readRegistry(dataDir: string): Promise<RegistryFile> {
  try {
    const raw = await readFile(registryPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.members)) {
      return { version: 1, members: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, members: [] };
    }
    throw err;
  }
}

async function writeRegistry(dataDir: string, file: RegistryFile): Promise<void> {
  const p = registryPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

export function isMemberRole(x: unknown): x is MemberRole {
  return typeof x === 'string' && (MEMBER_ROLES as readonly string[]).includes(x);
}

export function roleRank(role: MemberRole): number {
  return ROLE_RANK[role];
}

export function meetsMinRole(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export async function listMembers(dataDir: string): Promise<MemberRecord[]> {
  const file = await readRegistry(dataDir);
  return [...file.members].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.userId.localeCompare(b.userId));
}

/**
 * Filter a list of member records by a case-insensitive substring that
 * matches the member's userId, email, or label. Empty/whitespace `q`
 * returns the input unchanged. Mirrors the `q` filter on /keys, /mutes,
 * /pins, and /query-blocklist so an admin scrolling a long Members
 * page can search by what they remember (a partial email, a userId
 * prefix from an audit row, or a free-form label).
 */
export function filterMembers(
  members: MemberRecord[],
  q: string | undefined,
): MemberRecord[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return members;
  return members.filter((m) => {
    const hay = `${m.userId}\n${m.email ?? ''}\n${m.label ?? ''}`.toLowerCase();
    return hay.includes(needle);
  });
}

export async function getMember(dataDir: string, userId: string): Promise<MemberRecord | null> {
  const file = await readRegistry(dataDir);
  return file.members.find((m) => m.userId === userId) ?? null;
}

function countOwners(file: RegistryFile): number {
  return file.members.reduce((n, m) => (m.role === 'owner' ? n + 1 : n), 0);
}

export interface BootstrapInput {
  userId: string;
  email?: string | null;
  label?: string | null;
  defaultRole?: MemberRole;
}

// Called from the auth preHandler. If the registry is empty, the very
// first authenticated user becomes the owner so the deployment is never
// orphaned. If the user is already registered, lastSeenAt is bumped.
// Returns the registered role (which the caller should overlay onto
// req.user.role).
export async function recordSeenAndBootstrap(
  dataDir: string,
  input: BootstrapInput,
): Promise<MemberRecord> {
  const file = await readRegistry(dataDir);
  const now = Date.now();
  const existing = file.members.find((m) => m.userId === input.userId);
  if (existing) {
    existing.lastSeenAt = now;
    if (input.email && !existing.email) existing.email = clip(input.email, MAX_EMAIL_LEN);
    if (input.label && !existing.label) existing.label = clip(input.label, MAX_LABEL_LEN);
    await writeRegistry(dataDir, file);
    return existing;
  }
  const role: MemberRole = file.members.length === 0 ? 'owner' : (input.defaultRole ?? 'member');
  const rec: MemberRecord = {
    userId: input.userId,
    role,
    email: input.email ? clip(input.email, MAX_EMAIL_LEN) : null,
    label: input.label ? clip(input.label, MAX_LABEL_LEN) : null,
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
  };
  file.members.push(rec);
  await writeRegistry(dataDir, file);
  return rec;
}

export interface InviteInput {
  userId: string;
  role: MemberRole;
  email?: string | null;
  label?: string | null;
  invitedBy: string;
}

// Pre-register a userId so the next time they log in (via OIDC or
// otherwise) they are bound to the role the admin chose, rather than
// dropping in as the default. If the user already exists this is a no-op
// for the role (use updateRole for that) but the email/label hints are
// merged in when missing.
export async function inviteMember(
  dataDir: string,
  input: InviteInput,
): Promise<{ created: boolean; record: MemberRecord }> {
  const file = await readRegistry(dataDir);
  const existing = file.members.find((m) => m.userId === input.userId);
  const now = Date.now();
  if (existing) {
    if (input.email && !existing.email) existing.email = clip(input.email, MAX_EMAIL_LEN);
    if (input.label && !existing.label) existing.label = clip(input.label, MAX_LABEL_LEN);
    existing.updatedAt = now;
    await writeRegistry(dataDir, file);
    return { created: false, record: existing };
  }
  const rec: MemberRecord = {
    userId: input.userId,
    role: input.role,
    email: input.email ? clip(input.email, MAX_EMAIL_LEN) : null,
    label: input.label ? clip(input.label, MAX_LABEL_LEN) : null,
    invitedBy: input.invitedBy,
    createdAt: now,
    updatedAt: now,
    lastSeenAt: null,
  };
  file.members.push(rec);
  await writeRegistry(dataDir, file);
  return { created: true, record: rec };
}

export type UpdateRoleError =
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'last-owner' }
  | { ok: false; code: 'forbidden-target'; message: string };

export type UpdateRoleResult =
  | { ok: true; before: MemberRecord; after: MemberRecord }
  | UpdateRoleError;

// Change a member's role. Enforces:
//   - The last owner cannot be demoted (the deployment must always have
//     at least one owner).
//   - The caller must be at least as powerful as both the current role
//     and the new role of the target. (An admin cannot touch an owner
//     and cannot promote anyone to owner.)
export async function updateRole(
  dataDir: string,
  targetUserId: string,
  newRole: MemberRole,
  actor: { userId: string; role: MemberRole },
): Promise<UpdateRoleResult> {
  const file = await readRegistry(dataDir);
  const idx = file.members.findIndex((m) => m.userId === targetUserId);
  if (idx === -1) return { ok: false, code: 'not-found' };
  const before = { ...file.members[idx]! };
  if (!canActOn(actor.role, before.role)) {
    return { ok: false, code: 'forbidden-target', message: `role ${actor.role} cannot modify ${before.role}` };
  }
  if (!canActOn(actor.role, newRole)) {
    return { ok: false, code: 'forbidden-target', message: `role ${actor.role} cannot assign ${newRole}` };
  }
  if (before.role === 'owner' && newRole !== 'owner' && countOwners(file) <= 1) {
    return { ok: false, code: 'last-owner' };
  }
  file.members[idx] = {
    ...before,
    role: newRole,
    updatedAt: Date.now(),
  };
  await writeRegistry(dataDir, file);
  return { ok: true, before, after: file.members[idx]! };
}

export type RemoveResult =
  | { ok: true; removed: MemberRecord }
  | { ok: false; code: 'not-found' }
  | { ok: false; code: 'last-owner' }
  | { ok: false; code: 'forbidden-target'; message: string }
  | { ok: false; code: 'self-remove' };

export async function removeMember(
  dataDir: string,
  targetUserId: string,
  actor: { userId: string; role: MemberRole },
): Promise<RemoveResult> {
  const file = await readRegistry(dataDir);
  const idx = file.members.findIndex((m) => m.userId === targetUserId);
  if (idx === -1) return { ok: false, code: 'not-found' };
  if (targetUserId === actor.userId) return { ok: false, code: 'self-remove' };
  const target = file.members[idx]!;
  if (!canActOn(actor.role, target.role)) {
    return { ok: false, code: 'forbidden-target', message: `role ${actor.role} cannot remove ${target.role}` };
  }
  if (target.role === 'owner' && countOwners(file) <= 1) {
    return { ok: false, code: 'last-owner' };
  }
  file.members.splice(idx, 1);
  await writeRegistry(dataDir, file);
  return { ok: true, removed: target };
}

// An actor can only act on a target whose role rank is strictly less
// than or equal to the actor's own rank. Owners can act on owners (to
// promote/demote each other), but admins cannot.
function canActOn(actor: MemberRole, target: MemberRole): boolean {
  if (actor === 'owner') return true;
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}
