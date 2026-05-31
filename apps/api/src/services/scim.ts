import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  inviteMember,
  listMembers,
  removeMember,
  updateRole,
  getMember,
  isMemberRole,
  type MemberRecord,
  type MemberRole,
} from './members.js';
import { sweepUser } from './offboarding.js';

// SCIM 2.0 token + adapter layer.
//
// Enterprise IdPs (Okta, Azure AD, Google Workspace, OneLogin) expect a
// SCIM 2.0 endpoint to push user provisioning and de-provisioning instead
// of the customer's admin clicking invite links by hand. This service is
// the deliberately small bridge between ClawMind's member registry and
// that protocol:
//
//   * One workspace-wide bearer token, issued and rotated by an owner
//     with MFA. The plaintext is shown exactly once; only its sha256
//     digest is persisted on disk.
//   * SCIM User resources are projected one-to-one from the existing
//     members.json registry. We do not introduce a parallel user table,
//     so role changes from the in-app UI and from the IdP land in the
//     same place and stay consistent.
//   * `active=false` from the IdP demotes the member to the viewer role
//     (soft deactivation) rather than deleting, so audit history is not
//     orphaned. A DELETE removes the row outright, mirroring the in-app
//     remove-member flow.
//
// The token store lives next to api-keys.json at <dataDir>/scim.json.

const TOKEN_PREFIX = 'scim_';
const TOKEN_BYTES = 32;
const STORE_FILENAME = 'scim.json';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_SP_CONFIG = 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';

interface TokenFile {
  version: 1;
  token: {
    id: string;
    digest: string; // sha256 hex
    createdAt: number;
    createdBy: string;
    lastUsedAt: number | null;
  } | null;
}

function storePath(dataDir: string): string {
  return join(dataDir, STORE_FILENAME);
}

async function readStore(dataDir: string): Promise<TokenFile> {
  try {
    const raw = await readFile(storePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as TokenFile;
    if (!parsed || parsed.version !== 1) return { version: 1, token: null };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, token: null };
    }
    throw err;
  }
}

async function writeStore(dataDir: string, file: TokenFile): Promise<void> {
  const p = storePath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function ctEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export interface ScimTokenView {
  present: boolean;
  id: string | null;
  createdAt: number | null;
  createdBy: string | null;
  lastUsedAt: number | null;
}

export async function getTokenView(dataDir: string): Promise<ScimTokenView> {
  const file = await readStore(dataDir);
  if (!file.token) return { present: false, id: null, createdAt: null, createdBy: null, lastUsedAt: null };
  return {
    present: true,
    id: file.token.id,
    createdAt: file.token.createdAt,
    createdBy: file.token.createdBy,
    lastUsedAt: file.token.lastUsedAt,
  };
}

export interface MintedScimToken {
  id: string;
  token: string; // plaintext, returned once
  createdAt: number;
}

export async function rotateToken(dataDir: string, actorUserId: string): Promise<MintedScimToken> {
  const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
  const id = `scim_${randomBytes(6).toString('hex')}`;
  const now = Date.now();
  await writeStore(dataDir, {
    version: 1,
    token: {
      id,
      digest: sha256Hex(token),
      createdAt: now,
      createdBy: actorUserId,
      lastUsedAt: null,
    },
  });
  return { id, token, createdAt: now };
}

export async function revokeToken(dataDir: string): Promise<{ revoked: boolean }> {
  const file = await readStore(dataDir);
  if (!file.token) return { revoked: false };
  await writeStore(dataDir, { version: 1, token: null });
  return { revoked: true };
}

/**
 * Verify a presented bearer token against the stored digest in constant
 * time. On a match, the lastUsedAt timestamp is bumped (best effort).
 * Returns the token id on success or null on miss.
 */
export async function verifyToken(dataDir: string, presented: string): Promise<string | null> {
  if (!presented || !presented.startsWith(TOKEN_PREFIX)) return null;
  const file = await readStore(dataDir);
  if (!file.token) return null;
  const presentedDigest = sha256Hex(presented);
  if (!ctEqHex(presentedDigest, file.token.digest)) return null;
  file.token.lastUsedAt = Date.now();
  try {
    await writeStore(dataDir, file);
  } catch {
    // non-fatal; auth still succeeded
  }
  return file.token.id;
}

// ---------- SCIM User projection ----------

export interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  active: boolean;
  meta: { resourceType: 'User'; created: string; lastModified: string; location?: string };
  name?: { formatted?: string };
  displayName?: string;
  emails: Array<{ value: string; primary: boolean; type?: string }>;
  // Non-standard but widely used: surface the workspace role so the IdP
  // can confirm what was applied. Mappable through a SCIM enterprise
  // extension by integrators that need it.
  ['urn:ietf:params:scim:schemas:extension:clawmind:2.0:User']: {
    role: MemberRole;
  };
}

function iso(ms: number | null): string {
  return new Date(ms ?? 0).toISOString();
}

export function memberToScimUser(m: MemberRecord, baseUrl?: string): ScimUser {
  const userName = m.email ?? m.userId;
  const u: ScimUser = {
    schemas: [SCIM_USER_SCHEMA, 'urn:ietf:params:scim:schemas:extension:clawmind:2.0:User'],
    id: m.userId,
    userName,
    active: m.role !== 'viewer' ? true : true, // viewer is still active in SCIM terms
    meta: {
      resourceType: 'User',
      created: iso(m.createdAt),
      lastModified: iso(m.updatedAt),
    },
    displayName: m.label ?? userName,
    name: { formatted: m.label ?? userName },
    emails: m.email ? [{ value: m.email, primary: true, type: 'work' }] : [],
    'urn:ietf:params:scim:schemas:extension:clawmind:2.0:User': { role: m.role },
  };
  if (baseUrl) u.meta.location = `${baseUrl.replace(/\/$/, '')}/Users/${encodeURIComponent(m.userId)}`;
  return u;
}

// Very small subset of SCIM filter syntax: `userName eq "x"` and
// `emails.value eq "x"`. Anything else is ignored (returns full list)
// rather than throwing, which is how most production SCIM consumers
// expect unknown filters to be handled.
export function applyFilter(members: MemberRecord[], filter?: string | null): MemberRecord[] {
  if (!filter) return members;
  const m = /^(userName|emails\.value|email)\s+eq\s+"([^"]+)"$/i.exec(filter.trim());
  if (!m) return members;
  const needle = m[2]!.toLowerCase();
  return members.filter((mem) => {
    if (m[1]!.toLowerCase() === 'username') {
      const u = (mem.email ?? mem.userId).toLowerCase();
      return u === needle;
    }
    return (mem.email ?? '').toLowerCase() === needle;
  });
}

export interface ScimListResponse {
  schemas: [typeof SCIM_LIST_RESPONSE];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimUser[];
}

export async function listScimUsers(
  dataDir: string,
  opts: { filter?: string | null; startIndex?: number; count?: number; baseUrl?: string },
): Promise<ScimListResponse> {
  const all = await listMembers(dataDir);
  const filtered = applyFilter(all, opts.filter);
  const startIndex = Math.max(1, opts.startIndex ?? 1);
  const count = Math.min(200, Math.max(0, opts.count ?? 100));
  const slice = filtered.slice(startIndex - 1, startIndex - 1 + count);
  return {
    schemas: [SCIM_LIST_RESPONSE],
    totalResults: filtered.length,
    startIndex,
    itemsPerPage: slice.length,
    Resources: slice.map((m) => memberToScimUser(m, opts.baseUrl)),
  };
}

export type ScimError =
  | { code: 'not-found' }
  | { code: 'bad-request'; detail: string }
  | { code: 'conflict'; detail: string }
  | { code: 'last-owner' }
  | { code: 'forbidden'; detail: string };

export interface ScimCreateInput {
  userName?: string;
  externalId?: string;
  emails?: Array<{ value: string; primary?: boolean }>;
  name?: { formatted?: string; givenName?: string; familyName?: string };
  displayName?: string;
  active?: boolean;
  role?: string; // optional clawmind extension hint
}

const SCIM_ACTOR = 'scim:provisioner';

function deriveUserId(input: ScimCreateInput): string | null {
  // Prefer externalId so the IdP's stable handle drives our row key,
  // which keeps later PATCH/DELETE idempotent even if the email changes.
  if (input.externalId && input.externalId.trim()) return input.externalId.trim();
  if (input.userName && input.userName.trim()) return input.userName.trim();
  const primary = (input.emails ?? []).find((e) => e.primary) ?? (input.emails ?? [])[0];
  if (primary?.value) return primary.value.trim();
  return null;
}

function primaryEmail(input: ScimCreateInput): string | null {
  const primary = (input.emails ?? []).find((e) => e.primary) ?? (input.emails ?? [])[0];
  return primary?.value?.trim().toLowerCase() ?? null;
}

function deriveLabel(input: ScimCreateInput): string | null {
  return (
    input.displayName?.trim() ||
    input.name?.formatted?.trim() ||
    [input.name?.givenName, input.name?.familyName].filter(Boolean).join(' ').trim() ||
    null
  );
}

export async function createScimUser(
  dataDir: string,
  input: ScimCreateInput,
): Promise<{ ok: true; user: ScimUser; created: boolean } | { ok: false; err: ScimError }> {
  const userId = deriveUserId(input);
  if (!userId) return { ok: false, err: { code: 'bad-request', detail: 'userName, externalId, or primary email required' } };
  const email = primaryEmail(input);
  // Provisioning may not include role; default to member which matches the
  // in-app invite default. An IdP that wants a different floor can pass
  // the clawmind role hint.
  let role: MemberRole = 'member';
  if (input.role && isMemberRole(input.role)) role = input.role;
  if (input.active === false) role = 'viewer';

  const existing = await getMember(dataDir, userId);
  if (existing) {
    // SCIM POST on an existing user is a 409 conflict by spec.
    return { ok: false, err: { code: 'conflict', detail: 'user already exists' } };
  }
  const result = await inviteMember(dataDir, {
    userId,
    role,
    email,
    label: deriveLabel(input),
    invitedBy: SCIM_ACTOR,
  });
  return { ok: true, user: memberToScimUser(result.record), created: result.created };
}

export interface ScimPatchOp {
  op: 'add' | 'replace' | 'Add' | 'Replace' | 'remove' | 'Remove';
  path?: string;
  value?: unknown;
}

/**
 * Minimal PATCH support: enough for Okta/Azure AD deprovisioning, which
 * sends `{op: replace, path: active, value: false}` to suspend a user,
 * and the same with `true` to reactivate. Other paths return the
 * unchanged user so the IdP does not see a 4xx and disable the
 * integration.
 */
export async function patchScimUser(
  dataDir: string,
  userId: string,
  ops: ScimPatchOp[],
  actorUserId: string,
): Promise<{ ok: true; user: ScimUser; changed: boolean } | { ok: false; err: ScimError }> {
  const existing = await getMember(dataDir, userId);
  if (!existing) return { ok: false, err: { code: 'not-found' } };

  let nextActive: boolean | null = null;
  let nextRole: MemberRole | null = null;

  for (const raw of ops) {
    const op = (raw.op || '').toLowerCase();
    if (op !== 'replace' && op !== 'add') continue;
    const path = (raw.path ?? '').trim();
    if (!path && raw.value && typeof raw.value === 'object') {
      const v = raw.value as Record<string, unknown>;
      if (typeof v.active === 'boolean') nextActive = v.active;
    } else if (path.toLowerCase() === 'active') {
      if (typeof raw.value === 'boolean') nextActive = raw.value;
    } else if (path.toLowerCase().endsWith(':user:role') || path.toLowerCase() === 'role') {
      if (typeof raw.value === 'string' && isMemberRole(raw.value)) nextRole = raw.value;
    }
  }

  if (nextActive === false) nextRole = 'viewer';
  if (nextActive === true && existing.role === 'viewer' && !nextRole) nextRole = 'member';

  if (!nextRole || nextRole === existing.role) {
    return { ok: true, user: memberToScimUser(existing), changed: false };
  }

  const r = await updateRole(dataDir, userId, nextRole, { userId: actorUserId, role: 'owner' });
  if (!r.ok) {
    if (r.code === 'last-owner') return { ok: false, err: { code: 'last-owner' } };
    if (r.code === 'not-found') return { ok: false, err: { code: 'not-found' } };
    return { ok: false, err: { code: 'forbidden', detail: r.message ?? 'forbidden' } };
  }
  return { ok: true, user: memberToScimUser(r.after), changed: true };
}

export async function deleteScimUser(
  dataDir: string,
  userId: string,
  actorUserId: string,
): Promise<
  | { ok: true; removed: MemberRecord; offboarding: { keysRevoked: number; sessionsRevoked: number; keyIds: string[] } }
  | { ok: false; err: ScimError }
> {
  const r = await removeMember(dataDir, userId, { userId: actorUserId, role: 'owner' });
  if (!r.ok) {
    if (r.code === 'not-found') return { ok: false, err: { code: 'not-found' } };
    if (r.code === 'last-owner') return { ok: false, err: { code: 'last-owner' } };
    if (r.code === 'self-remove') return { ok: false, err: { code: 'forbidden', detail: 'cannot remove self' } };
    return { ok: false, err: { code: 'forbidden', detail: r.message ?? 'forbidden' } };
  }
  // SCIM deprovisioning must terminate every long-lived credential atomically
  // with the membership removal, otherwise an IdP-driven offboarding leaves
  // working API keys behind: precisely the gap enterprise reviewers check.
  const swept = await sweepUser(dataDir, userId);
  return { ok: true, removed: r.removed, offboarding: swept };
}

export async function getScimUserById(dataDir: string, userId: string, baseUrl?: string): Promise<ScimUser | null> {
  const m = await getMember(dataDir, userId);
  return m ? memberToScimUser(m, baseUrl) : null;
}

export function serviceProviderConfig(baseUrl?: string): Record<string, unknown> {
  return {
    schemas: [SCIM_SP_CONFIG],
    documentationUri: 'https://github.com/Sanjays2402/clawmind/blob/main/docs/SCIM.md',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Workspace SCIM token, issued from /settings/scim',
        specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      location: baseUrl ? `${baseUrl.replace(/\/$/, '')}/ServiceProviderConfig` : undefined,
    },
  };
}

export function scimErrorBody(status: number, detail: string, scimType?: string): Record<string, unknown> {
  return {
    schemas: [SCIM_ERROR],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  };
}
