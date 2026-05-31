import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { MemberRole } from './members.js';

// Domain auto-join policies.
//
// Lets owners/admins say: "anyone signing in with an @acme.com email should
// be auto-enrolled as a member (or viewer) instead of waiting for an
// individual invitation." This is the standard onboarding-for-orgs feature
// enterprise buyers expect when they roll out SSO to a 500-person org.
//
// Rules:
//   - The policy table is a flat JSON file, atomically rewritten.
//   - Only `member` and `viewer` roles are assignable by policy. We never
//     auto-grant `admin` or `owner` from a domain match: those still
//     require an explicit invitation from a human owner. This keeps the
//     blast radius of a compromised email provider strictly bounded.
//   - Matching is case-insensitive on the domain part of the email.
//   - Disabled policies never match; they are kept so an operator can
//     toggle without losing the row.
//   - Only NEW users are auto-enrolled. Existing members keep whatever
//     role they already have; a domain policy never silently demotes or
//     promotes anyone.
//
// The auth preHandler calls `resolveDefaultRoleByEmail` BEFORE
// `recordSeenAndBootstrap`, and passes the resolved role through
// `defaultRole`. Domain policy changes are audit-logged with a
// before/after diff so a SOC2 reviewer can prove who opened the door
// for which domain.

export const AUTO_JOIN_ROLES = ['member', 'viewer'] as const satisfies readonly MemberRole[];
export type AutoJoinRole = (typeof AUTO_JOIN_ROLES)[number];

export const MAX_DOMAIN_LEN = 253; // RFC 1035 max FQDN length
export const MAX_POLICIES = 50;

export interface DomainPolicy {
  domain: string;        // lowercased, no leading '@'
  role: AutoJoinRole;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface PoliciesFile {
  version: 1;
  policies: DomainPolicy[];
}

function policiesPath(dataDir: string): string {
  return join(dataDir, 'domain-policies.json');
}

async function readPolicies(dataDir: string): Promise<PoliciesFile> {
  try {
    const raw = await readFile(policiesPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as PoliciesFile;
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

async function writePolicies(dataDir: string, file: PoliciesFile): Promise<void> {
  const p = policiesPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

// Strict-ish domain validator. We accept labels of letters/digits/hyphens,
// 1..63 chars each, separated by dots, total length <= 253, no trailing dot,
// and require at least one dot (we are not auto-joining bare hostnames).
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?!-)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;

export function normalizeDomain(input: string): string | null {
  const trimmed = (input ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!trimmed || trimmed.length > MAX_DOMAIN_LEN) return null;
  if (!DOMAIN_RE.test(trimmed)) return null;
  return trimmed;
}

export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  const dom = email.slice(at + 1).trim().toLowerCase();
  return normalizeDomain(dom);
}

export function isAutoJoinRole(x: unknown): x is AutoJoinRole {
  return typeof x === 'string' && (AUTO_JOIN_ROLES as readonly string[]).includes(x);
}

export async function listPolicies(dataDir: string): Promise<DomainPolicy[]> {
  const file = await readPolicies(dataDir);
  return [...file.policies].sort((a, b) => a.domain.localeCompare(b.domain));
}

export type ReplaceInput = ReadonlyArray<{
  domain: string;
  role: AutoJoinRole;
  enabled?: boolean;
}>;

export type ReplaceError =
  | { ok: false; code: 'too-many'; max: number }
  | { ok: false; code: 'invalid-domain'; value: string }
  | { ok: false; code: 'invalid-role'; value: string }
  | { ok: false; code: 'duplicate'; value: string };

export type ReplaceResult =
  | {
      ok: true;
      before: DomainPolicy[];
      after: DomainPolicy[];
    }
  | ReplaceError;

// Atomic replace. Validates the entire input first so a malformed entry
// cannot leave the file half-written. Preserves createdAt for any domain
// that already existed; refreshes updatedAt when anything about a row
// changed (role flip, enabled toggle).
export async function replacePolicies(
  dataDir: string,
  input: ReplaceInput,
): Promise<ReplaceResult> {
  if (input.length > MAX_POLICIES) return { ok: false, code: 'too-many', max: MAX_POLICIES };

  const seen = new Set<string>();
  const normalised: Array<{ domain: string; role: AutoJoinRole; enabled: boolean }> = [];
  for (const raw of input) {
    const domain = normalizeDomain(raw.domain);
    if (!domain) return { ok: false, code: 'invalid-domain', value: String(raw.domain ?? '') };
    if (!isAutoJoinRole(raw.role)) return { ok: false, code: 'invalid-role', value: String(raw.role ?? '') };
    if (seen.has(domain)) return { ok: false, code: 'duplicate', value: domain };
    seen.add(domain);
    normalised.push({ domain, role: raw.role, enabled: raw.enabled !== false });
  }

  const file = await readPolicies(dataDir);
  const before = [...file.policies];
  const byDomain = new Map(before.map((p) => [p.domain, p] as const));
  const now = Date.now();
  const after: DomainPolicy[] = normalised.map((entry) => {
    const prev = byDomain.get(entry.domain);
    if (!prev) {
      return {
        domain: entry.domain,
        role: entry.role,
        enabled: entry.enabled,
        createdAt: now,
        updatedAt: now,
      };
    }
    const changed = prev.role !== entry.role || prev.enabled !== entry.enabled;
    return {
      domain: entry.domain,
      role: entry.role,
      enabled: entry.enabled,
      createdAt: prev.createdAt,
      updatedAt: changed ? now : prev.updatedAt,
    };
  });

  await writePolicies(dataDir, { version: 1, policies: after });
  return { ok: true, before, after };
}

// Returns the role to assign to a brand-new user with this email, or null
// if no enabled policy matches (caller should fall back to its own
// default). Safe to call on every login because reads are cheap and the
// auth path already touches the filesystem for sessions/members.
export async function resolveDefaultRoleByEmail(
  dataDir: string,
  email: string | null | undefined,
): Promise<AutoJoinRole | null> {
  const dom = domainOfEmail(email ?? null);
  if (!dom) return null;
  const file = await readPolicies(dataDir);
  const match = file.policies.find((p) => p.enabled && p.domain === dom);
  return match ? match.role : null;
}
