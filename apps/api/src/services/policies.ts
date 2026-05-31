import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

// Workspace policy acceptance tracking (TOS / DPA / AUP).
//
// Procurement and SOC2 / ISO 27001 reviewers consistently ask for proof
// that every user of a workspace has been presented with the current
// Terms of Service, Data Processing Addendum, and Acceptable Use Policy,
// and has affirmatively accepted the version that was in force when they
// were active. Without this record, every privacy / e-discovery request
// becomes a "we believe everyone agreed" handwave that does not survive
// audit. This module is the system of record:
//
//   * Owner publishes a Policy with a kind ('tos' | 'dpa' | 'aup'), a
//     human-readable title, a fully rendered body (markdown), and an
//     optional effectiveAt timestamp. We hash the body so we can detect
//     accidental in-place mutation, and the hash is the version id that
//     acceptance records pin to. Publishing a changed body produces a
//     new Policy with a new id; the old one is preserved so historic
//     acceptances remain verifiable.
//
//   * Every authenticated user has a list of Acceptance records, one per
//     accepted policy id. Acceptances are append-only: you cannot
//     "un-accept", you can only accept a newer version. The record
//     captures policyId, userId, acceptedAt, ip, and userAgent so a
//     regulator can reconstruct exactly what was shown when.
//
//   * A policy is "required" when required === true. Required policies
//     gate normal product use: if the current user has not accepted the
//     latest required version of every kind, the policy-gate plugin
//     returns 451 Unavailable For Legal Reasons with the unmet policy
//     ids so the UI can render an accept screen.
//
// On-disk layout: <dataDir>/policies.json. Atomic rewrite via tmp+rename
// matching the rest of the data layer.

export const MAX_TITLE = 200;
export const MAX_BODY = 200_000; // 200 KB markdown cap
export const MAX_POLICIES_PER_KIND = 50;
export const MAX_ACCEPTANCES_PER_USER = 500;

export type PolicyKind = 'tos' | 'dpa' | 'aup';
export const POLICY_KINDS: readonly PolicyKind[] = Object.freeze(['tos', 'dpa', 'aup']);

export function isPolicyKind(s: string): s is PolicyKind {
  return (POLICY_KINDS as readonly string[]).includes(s);
}

export interface Policy {
  id: string;           // sha256(kind + body) truncated; deterministic for body
  kind: PolicyKind;
  title: string;
  body: string;
  bodyHash: string;     // full sha256 of body for tamper detection
  required: boolean;    // when true, all users must accept before normal API use
  publishedBy: string;
  publishedAt: number;
  effectiveAt: number;  // when this version becomes the "current" one
  supersededAt: number | null; // set when a newer version of same kind is published
}

export interface Acceptance {
  policyId: string;
  userId: string;
  acceptedAt: number;
  ip: string;
  userAgent: string;
}

export interface PoliciesFile {
  version: 1;
  policies: Policy[];
  acceptances: Acceptance[];
}

const FILE = 'policies.json';

export class PolicyValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'PolicyValidationError';
  }
}

function filePath(dataDir: string): string {
  return join(dataDir, FILE);
}

function emptyFile(): PoliciesFile {
  return { version: 1, policies: [], acceptances: [] };
}

async function readAll(dataDir: string): Promise<PoliciesFile> {
  try {
    const raw = await readFile(filePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as PoliciesFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.policies) || !Array.isArray(parsed.acceptances)) {
      return emptyFile();
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile();
    throw err;
  }
}

async function writeAll(dataDir: string, file: PoliciesFile): Promise<void> {
  const p = filePath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function policyId(kind: PolicyKind, body: string): string {
  return `${kind}_${shortHash(`${kind}\n${body}`).slice(0, 16)}`;
}

export interface PublishInput {
  kind: PolicyKind;
  title: string;
  body: string;
  required?: boolean;
  effectiveAt?: number | null;
}

export async function publishPolicy(
  dataDir: string,
  actorUserId: string,
  input: PublishInput,
  now: number = Date.now(),
): Promise<Policy> {
  if (!isPolicyKind(input.kind)) {
    throw new PolicyValidationError('kind', `kind must be one of ${POLICY_KINDS.join(', ')}`);
  }
  const title = (input.title ?? '').trim();
  if (!title) throw new PolicyValidationError('title', 'title is required');
  if (title.length > MAX_TITLE) {
    throw new PolicyValidationError('title', `title exceeds ${MAX_TITLE} chars`);
  }
  const body = input.body ?? '';
  if (!body.trim()) throw new PolicyValidationError('body', 'body is required');
  if (body.length > MAX_BODY) {
    throw new PolicyValidationError('body', `body exceeds ${MAX_BODY} chars`);
  }
  const file = await readAll(dataDir);
  const id = policyId(input.kind, body);
  const existing = file.policies.find((p) => p.id === id);
  if (existing) {
    // Re-publishing the same body is a no-op rather than an error so a
    // careful operator can confirm a policy is in force without surprise.
    return existing;
  }
  const bodyHash = shortHash(body);
  const effectiveAt = typeof input.effectiveAt === 'number' && input.effectiveAt > 0
    ? input.effectiveAt
    : now;
  const required = input.required !== false; // default true
  const next: Policy = {
    id,
    kind: input.kind,
    title,
    body,
    bodyHash,
    required,
    publishedBy: actorUserId,
    publishedAt: now,
    effectiveAt,
    supersededAt: null,
  };
  // Mark any previously-current policy of the same kind as superseded
  // once `next` becomes effective. If next.effectiveAt is in the future,
  // the prior version remains current until then.
  for (const p of file.policies) {
    if (p.kind === next.kind && p.supersededAt === null && p.id !== next.id) {
      if (effectiveAt <= now) {
        p.supersededAt = now;
      }
    }
  }
  file.policies.push(next);
  // Cap retention per kind so a misbehaving operator cannot blow up the
  // file. We keep the latest N by publishedAt.
  const byKind: Record<PolicyKind, Policy[]> = { tos: [], dpa: [], aup: [] };
  for (const p of file.policies) byKind[p.kind].push(p);
  for (const k of POLICY_KINDS) {
    byKind[k].sort((a, b) => b.publishedAt - a.publishedAt);
    if (byKind[k].length > MAX_POLICIES_PER_KIND) {
      const drop = new Set(byKind[k].slice(MAX_POLICIES_PER_KIND).map((p) => p.id));
      file.policies = file.policies.filter((p) => !drop.has(p.id));
      // Also drop acceptances for dropped policies so the file does not
      // accumulate dangling references.
      file.acceptances = file.acceptances.filter((a) => !drop.has(a.policyId));
    }
  }
  await writeAll(dataDir, file);
  return next;
}

export async function listPolicies(
  dataDir: string,
  opts?: { kind?: PolicyKind; includeSuperseded?: boolean },
): Promise<Policy[]> {
  const file = await readAll(dataDir);
  let out = file.policies.slice();
  if (opts?.kind) out = out.filter((p) => p.kind === opts.kind);
  if (!opts?.includeSuperseded) out = out.filter((p) => p.supersededAt === null);
  out.sort((a, b) => b.publishedAt - a.publishedAt);
  return out;
}

// Returns the currently-in-force policy per kind: latest published whose
// effectiveAt <= now and not superseded. May return fewer than 3 entries
// if the workspace has not published every kind yet.
export async function getCurrentPolicies(
  dataDir: string,
  now: number = Date.now(),
): Promise<Policy[]> {
  const file = await readAll(dataDir);
  const out: Policy[] = [];
  for (const k of POLICY_KINDS) {
    const candidates = file.policies
      .filter((p) => p.kind === k && p.effectiveAt <= now && p.supersededAt === null)
      .sort((a, b) => b.effectiveAt - a.effectiveAt);
    if (candidates[0]) out.push(candidates[0]);
  }
  return out;
}

export interface AcceptInput {
  policyId: string;
  userId: string;
  ip: string;
  userAgent: string;
}

export async function acceptPolicy(
  dataDir: string,
  input: AcceptInput,
  now: number = Date.now(),
): Promise<Acceptance> {
  const file = await readAll(dataDir);
  const policy = file.policies.find((p) => p.id === input.policyId);
  if (!policy) throw new PolicyValidationError('policyId', 'unknown policy');
  // Idempotent: re-accepting returns the existing acceptance, so a UI
  // that re-submits never produces duplicate audit noise.
  const existing = file.acceptances.find(
    (a) => a.policyId === input.policyId && a.userId === input.userId,
  );
  if (existing) return existing;
  const ua = (input.userAgent ?? '').slice(0, 500);
  const ip = (input.ip ?? '').slice(0, 64);
  const rec: Acceptance = {
    policyId: input.policyId,
    userId: input.userId,
    acceptedAt: now,
    ip,
    userAgent: ua,
  };
  file.acceptances.push(rec);
  // Cap per-user acceptances to keep the file bounded. We drop the
  // oldest acceptances for this user beyond the cap; we never drop the
  // acceptance for a currently-required policy.
  const userAccepts = file.acceptances.filter((a) => a.userId === input.userId);
  if (userAccepts.length > MAX_ACCEPTANCES_PER_USER) {
    const required = new Set(
      file.policies.filter((p) => p.required && p.supersededAt === null).map((p) => p.id),
    );
    const sorted = userAccepts.slice().sort((a, b) => a.acceptedAt - b.acceptedAt);
    const drop = new Set<string>();
    let toDrop = userAccepts.length - MAX_ACCEPTANCES_PER_USER;
    for (const a of sorted) {
      if (toDrop <= 0) break;
      if (required.has(a.policyId)) continue;
      drop.add(`${a.userId}:${a.policyId}`);
      toDrop -= 1;
    }
    file.acceptances = file.acceptances.filter(
      (a) => !drop.has(`${a.userId}:${a.policyId}`),
    );
  }
  await writeAll(dataDir, file);
  return rec;
}

export async function listAcceptances(
  dataDir: string,
  opts?: { userId?: string; policyId?: string },
): Promise<Acceptance[]> {
  const file = await readAll(dataDir);
  let out = file.acceptances.slice();
  if (opts?.userId) out = out.filter((a) => a.userId === opts.userId);
  if (opts?.policyId) out = out.filter((a) => a.policyId === opts.policyId);
  out.sort((a, b) => b.acceptedAt - a.acceptedAt);
  return out;
}

// Returns the list of currently-required policy ids that the given user
// has NOT accepted. Empty array means the user is in good standing.
export async function unmetPolicies(
  dataDir: string,
  userId: string,
  now: number = Date.now(),
): Promise<Policy[]> {
  const current = await getCurrentPolicies(dataDir, now);
  const required = current.filter((p) => p.required);
  if (required.length === 0) return [];
  const file = await readAll(dataDir);
  const acceptedIds = new Set(
    file.acceptances.filter((a) => a.userId === userId).map((a) => a.policyId),
  );
  return required.filter((p) => !acceptedIds.has(p.id));
}

// Aggregate per-user acceptance status for the current required policies.
// Used by the admin console to drive a "10 of 12 users accepted DPA v3"
// summary without exposing per-user activity history.
export interface AcceptanceSummary {
  policy: Policy;
  acceptedUserIds: string[];
  acceptedCount: number;
}

export async function acceptanceSummary(
  dataDir: string,
  now: number = Date.now(),
): Promise<AcceptanceSummary[]> {
  const current = await getCurrentPolicies(dataDir, now);
  const file = await readAll(dataDir);
  return current.map((policy) => {
    const acceptedUserIds = Array.from(
      new Set(
        file.acceptances
          .filter((a) => a.policyId === policy.id)
          .map((a) => a.userId),
      ),
    );
    return { policy, acceptedUserIds, acceptedCount: acceptedUserIds.length };
  });
}
