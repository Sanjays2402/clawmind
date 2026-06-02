import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// Data Subject Request (DSR) queue.
//
// GDPR Article 15 (access), 16 (rectification), 17 (erasure), 20 (portability)
// and CCPA §1798.110 / §1798.105 all require operators to accept
// requests from natural persons whose personal data is processed by the
// service, even when those persons are NOT workspace members. ClawMind
// ingests notes that may quote third parties (emails, names, phone
// numbers), so a downstream subject must have a way to ask "what do you
// hold about me, and please delete it" without an account.
//
// Architecture: the public POST endpoint accepts subjectEmail, kind,
// details, and an optional workspaceId. We immediately mint an
// email-verification token (sha256 stored, plaintext returned exactly
// once in the response so the caller can hand it back via the verify
// link). The record is created in state 'unverified'. When the subject
// hits GET /v1/dsr/verify/:id/:token we move it to 'pending' and surface
// it on the admin queue. Admins (admin+ role, dsr:read/admin scoped)
// triage, set status to acknowledged|fulfilled|rejected, attach an
// internal note, and the resolvedAt timestamp anchors the legally
// required 30-day response window.
//
// On-disk layout: <dataDir>/dsr.json, atomic tmp+rename. One file per
// workspace; ClawMind ships single-tenant so we use 'default'. Multi
// tenant operators pass workspaceId.
//
// What this module does NOT do:
//   * Send the verification email. The plaintext token is returned to
//     the submitter in the POST response so an integrator can wire its
//     own ESP. Operators running the public form behind a notification
//     channel (Slack, ticketing) read the token from the audit entry.
//   * Touch the corpus. Fulfillment is a workflow signal that points an
//     admin at workspace-export + DELETE /v1/me/data + retention sweeps,
//     all of which already exist. We track the decision, not the diff.
//   * Bypass legal hold. An admin fulfilling an erasure request while a
//     hold is active still gets the existing legal-hold 409 from those
//     destructive endpoints.

export const MAX_DETAILS = 4000;
export const MAX_NOTE = 4000;
export const MAX_EMAIL = 320; // RFC 5321
export const MAX_QUEUE = 5000;
export const TOKEN_BYTES = 24;

export type DsrKind = 'access' | 'erasure' | 'rectification' | 'portability' | 'restriction';
export type DsrStatus = 'unverified' | 'pending' | 'acknowledged' | 'fulfilled' | 'rejected';

export const DSR_KINDS: readonly DsrKind[] = [
  'access',
  'erasure',
  'rectification',
  'portability',
  'restriction',
];

export interface DsrRecord {
  id: string;
  workspaceId: string;
  subjectEmail: string;
  kind: DsrKind;
  details: string;
  status: DsrStatus;
  // sha256 of the plaintext verification token. The plaintext is
  // returned to the submitter once at create time and never persisted.
  verifyHash: string;
  verifiedAt: number | null;
  // Operator-facing fields. resolvedAt anchors the 30-day SLA clock and
  // is set whenever status transitions to a terminal state.
  note: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  // Light request fingerprint to help operators correlate spam waves.
  // We intentionally store the truncated IP only (sha256 prefix) so the
  // queue does not become a third-party tracking ledger.
  submitterIpHash: string | null;
}

export interface DsrFile {
  version: 1;
  records: DsrRecord[];
}

const FILE = 'dsr.json';
const DEFAULT_WORKSPACE = 'default';

export class DsrValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'DsrValidationError';
  }
}

function isValidEmail(s: string): boolean {
  if (s.length > MAX_EMAIL) return false;
  // Lightweight: one @, no spaces, dot in domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
  return true;
}

export interface CreateInput {
  subjectEmail: string;
  kind: DsrKind;
  details?: string | null;
  workspaceId?: string | null;
  submitterIp?: string | null;
}

export function validateCreate(input: CreateInput): {
  subjectEmail: string;
  kind: DsrKind;
  details: string;
  workspaceId: string;
} {
  const email = (input.subjectEmail ?? '').trim().toLowerCase();
  if (!email) throw new DsrValidationError('subjectEmail', 'subjectEmail required');
  if (!isValidEmail(email)) throw new DsrValidationError('subjectEmail', 'subjectEmail invalid');

  if (!input.kind || !DSR_KINDS.includes(input.kind)) {
    throw new DsrValidationError('kind', `kind must be one of ${DSR_KINDS.join(', ')}`);
  }

  const details = (input.details ?? '').toString();
  if (details.length > MAX_DETAILS) {
    throw new DsrValidationError('details', `details exceeds ${MAX_DETAILS} chars`);
  }

  const ws = (input.workspaceId ?? DEFAULT_WORKSPACE).trim() || DEFAULT_WORKSPACE;
  if (ws.length > 200) throw new DsrValidationError('workspaceId', 'workspaceId too long');

  return { subjectEmail: email, kind: input.kind, details, workspaceId: ws };
}

function pathFor(dataDir: string): string {
  return join(dataDir, FILE);
}

async function readFile_(dataDir: string): Promise<DsrFile> {
  try {
    const buf = await readFile(pathFor(dataDir), 'utf8');
    const parsed = JSON.parse(buf) as DsrFile;
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

async function writeFileAtomic(dataDir: string, file: DsrFile): Promise<void> {
  const p = pathFor(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  // Truncate IPv4 last octet / IPv6 last 80 bits then hash, so the queue
  // cannot rebuild the source IP from the digest.
  let trimmed = ip;
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.');
    if (parts.length === 4) trimmed = `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  } else if (ip.includes(':')) {
    const parts = ip.split(':');
    trimmed = parts.slice(0, 3).join(':') + '::';
  }
  return createHash('sha256').update(trimmed).digest('hex').slice(0, 16);
}

export interface CreateResult {
  record: DsrRecord;
  verifyToken: string; // plaintext, returned ONCE
}

export async function createRequest(dataDir: string, input: CreateInput): Promise<CreateResult> {
  const v = validateCreate(input);
  const file = await readFile_(dataDir);

  if (file.records.length >= MAX_QUEUE) {
    // Hard cap to prevent disk-fill via unauthenticated submission.
    // Operators reaping fulfilled rows keeps headroom open.
    throw new DsrValidationError('queue', `queue at capacity (${MAX_QUEUE})`);
  }

  const id = 'dsr_' + randomBytes(9).toString('base64url');
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const now = Date.now();

  const record: DsrRecord = {
    id,
    workspaceId: v.workspaceId,
    subjectEmail: v.subjectEmail,
    kind: v.kind,
    details: v.details,
    status: 'unverified',
    verifyHash: hashToken(token),
    verifiedAt: null,
    note: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    submitterIpHash: hashIp(input.submitterIp ?? null),
  };

  file.records.unshift(record);
  await writeFileAtomic(dataDir, file);
  return { record, verifyToken: token };
}

export async function verifyRequest(
  dataDir: string,
  id: string,
  token: string,
): Promise<DsrRecord | null> {
  const file = await readFile_(dataDir);
  const r = file.records.find((x) => x.id === id);
  if (!r) return null;
  // Token MUST match in every case, even on the idempotent re-verify
  // path. Otherwise anyone who learns the request id can pretend to
  // confirm a record they did not submit.
  const want = Buffer.from(r.verifyHash, 'hex');
  const got = Buffer.from(hashToken(token), 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (r.status !== 'unverified') {
    // Re-verifying a previously verified row is a no-op success once the
    // token has been re-confirmed.
    if (r.verifiedAt) return r;
    return null;
  }
  r.status = 'pending';
  r.verifiedAt = Date.now();
  r.updatedAt = r.verifiedAt;
  await writeFileAtomic(dataDir, file);
  return r;
}

export async function listRequests(
  dataDir: string,
  opts?: { status?: DsrStatus; workspaceId?: string; q?: string },
): Promise<DsrRecord[]> {
  const file = await readFile_(dataDir);
  let rows = file.records;
  if (opts?.workspaceId) rows = rows.filter((r) => r.workspaceId === opts.workspaceId);
  if (opts?.status) rows = rows.filter((r) => r.status === opts.status);
  const q = opts?.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) => {
      if (r.id.toLowerCase().includes(q)) return true;
      if (r.subjectEmail.toLowerCase().includes(q)) return true;
      if (r.details && r.details.toLowerCase().includes(q)) return true;
      if (r.workspaceId && r.workspaceId.toLowerCase().includes(q)) return true;
      return false;
    });
  }
  return rows;
}

export async function getRequest(dataDir: string, id: string): Promise<DsrRecord | null> {
  const file = await readFile_(dataDir);
  return file.records.find((r) => r.id === id) ?? null;
}

export interface UpdateInput {
  status?: DsrStatus;
  note?: string | null;
}

const TERMINAL: readonly DsrStatus[] = ['fulfilled', 'rejected'];

export async function updateRequest(
  dataDir: string,
  id: string,
  actorId: string,
  input: UpdateInput,
): Promise<DsrRecord | null> {
  const file = await readFile_(dataDir);
  const r = file.records.find((x) => x.id === id);
  if (!r) return null;

  if (input.status !== undefined) {
    if (r.status === 'unverified') {
      throw new DsrValidationError('status', 'cannot transition an unverified request');
    }
    const allowed: readonly DsrStatus[] = ['pending', 'acknowledged', 'fulfilled', 'rejected'];
    if (!allowed.includes(input.status)) {
      throw new DsrValidationError('status', `status must be one of ${allowed.join(', ')}`);
    }
    r.status = input.status;
    if (TERMINAL.includes(input.status)) {
      r.resolvedBy = actorId;
      r.resolvedAt = Date.now();
    } else {
      r.resolvedBy = null;
      r.resolvedAt = null;
    }
  }

  if (input.note !== undefined) {
    const n = input.note ?? '';
    if (n.length > MAX_NOTE) {
      throw new DsrValidationError('note', `note exceeds ${MAX_NOTE} chars`);
    }
    r.note = n === '' ? null : n;
  }

  r.updatedAt = Date.now();
  await writeFileAtomic(dataDir, file);
  return r;
}

/** Public projection: strips operator-only fields. Used by the verify
 * confirmation endpoint and never sent to unauthenticated callers in
 * any other context. */
export function publicView(r: DsrRecord): {
  id: string;
  kind: DsrKind;
  status: DsrStatus;
  createdAt: number;
  verifiedAt: number | null;
  resolvedAt: number | null;
} {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    createdAt: r.createdAt,
    verifiedAt: r.verifiedAt,
    resolvedAt: r.resolvedAt,
  };
}
