// Erasure certificates (GDPR Article 17 attestations).
//
// Why this exists: when a workspace fulfils a Data Subject erasure
// request the subject (and, more importantly, the subject's auditor or
// regulator) has no portable artefact proving the deletion ever
// happened. Procurement teams at regulated buyers (healthcare, finance,
// EU public sector) explicitly ask "can your platform issue a
// machine-verifiable destruction certificate after an Article 17
// request?" on every vendor questionnaire. Until now ClawMind tracked
// the workflow internally but produced no signed receipt.
//
// What this module does:
//   - When DSR `kind === 'erasure'` transitions to status `fulfilled`,
//     `issueOnFulfilment()` mints a one-shot certificate row with an
//     HMAC-SHA256 signature over the canonical content using a
//     per-workspace secret persisted next to the certificate file.
//   - The certificate stores a sha256 fingerprint of the subject email
//     instead of the plaintext address so the public projection cannot
//     be used to harvest the email of a deletion requester. The subject
//     proves they are the rightful holder by replaying their email
//     through `verifyCertificate(certId, email)`; the comparison is
//     constant-time.
//   - Storage is append-only. A certificate cannot be amended or
//     deleted; that's the whole point of an erasure attestation. We
//     expose `revoke()` which writes a revocation note ALONGSIDE the
//     original record (admin reviewers see both halves) but the signed
//     content stays bit-for-bit.
//
// What this module does NOT do:
//   - Send the certificate to the subject. The DSR submitter knows
//     their request id; the public `GET /v1/erasure-certificates/by-dsr/:dsrId`
//     surface lets them pull the certificate without an account.
//   - Touch the corpus. The workspace-deletion + retention + DSR
//     services already do the real destruction work; this module only
//     records that an admin attested to it.
//   - Replace the audit log. Every issuance writes an audit row via the
//     caller; the certificate is the externally-verifiable receipt, the
//     audit chain is the internal forensic trail.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const FILE = 'erasure-certificates.json';
const SECRET_FILE = 'erasure-certificates.secret';
const MAX_CERTIFICATES = 50_000;
const MAX_SCOPE = 4000;

export interface ErasureCertificate {
  id: string;
  dsrId: string;
  workspaceId: string;
  /** sha256 of the lowercased, trimmed subject email. */
  subjectEmailFingerprint: string;
  /** Free-text description of what was destroyed; comes from the admin
   *  note on the DSR row at fulfilment time. */
  scope: string;
  fulfilledBy: string;
  fulfilledAt: number;
  /** sha256 over the canonical JSON of the signed payload. Stable
   *  identifier a procurement team can pin in their vendor record. */
  contentFingerprint: string;
  /** HMAC-SHA256(secret, canonicalPayload) hex. */
  signature: string;
  algo: 'hmac-sha256';
  issuedAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
  revokedReason: string | null;
}

export interface CertificateFile {
  version: 1;
  certificates: ErasureCertificate[];
}

export class CertificateValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'CertificateValidationError';
  }
}

function fileFor(dataDir: string): string {
  return join(dataDir, FILE);
}

function secretFor(dataDir: string): string {
  return join(dataDir, SECRET_FILE);
}

async function readCertificateFile(dataDir: string): Promise<CertificateFile> {
  try {
    const raw = await readFile(fileFor(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as CertificateFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.certificates)) {
      return { version: 1, certificates: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, certificates: [] };
    }
    throw err;
  }
}

async function writeCertificateFile(dataDir: string, file: CertificateFile): Promise<void> {
  const p = fileFor(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

async function loadOrCreateSecret(dataDir: string): Promise<string> {
  const p = secretFor(dataDir);
  try {
    const buf = await readFile(p, 'utf8');
    const trimmed = buf.trim();
    if (trimmed.length >= 32) return trimmed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const fresh = randomBytes(32).toString('hex');
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, fresh, { encoding: 'utf8', mode: 0o600 });
  return fresh;
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Canonical JSON used for both the content fingerprint AND the signed
 *  body. Field order is fixed so a re-issued certificate signs exactly
 *  the same bytes a verifier will reconstruct. */
export function canonicalPayload(c: {
  id: string;
  dsrId: string;
  workspaceId: string;
  subjectEmailFingerprint: string;
  scope: string;
  fulfilledBy: string;
  fulfilledAt: number;
  issuedAt: number;
}): string {
  return JSON.stringify({
    algo: 'hmac-sha256',
    dsrId: c.dsrId,
    fulfilledAt: c.fulfilledAt,
    fulfilledBy: c.fulfilledBy,
    id: c.id,
    issuedAt: c.issuedAt,
    scope: c.scope,
    subjectEmailFingerprint: c.subjectEmailFingerprint,
    workspaceId: c.workspaceId,
  });
}

export interface IssueInput {
  dsrId: string;
  workspaceId: string;
  subjectEmail: string;
  scope: string;
  fulfilledBy: string;
  fulfilledAt: number;
}

/** Find an existing certificate for a DSR row (one-per-row invariant). */
export async function findByDsr(
  dataDir: string,
  dsrId: string,
): Promise<ErasureCertificate | null> {
  const file = await readCertificateFile(dataDir);
  return file.certificates.find((c) => c.dsrId === dsrId) ?? null;
}

export async function issueCertificate(
  dataDir: string,
  input: IssueInput,
): Promise<ErasureCertificate> {
  const dsrId = (input.dsrId ?? '').trim();
  if (!dsrId) throw new CertificateValidationError('dsrId', 'dsrId required');
  const subjectEmail = (input.subjectEmail ?? '').trim().toLowerCase();
  if (!subjectEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subjectEmail)) {
    throw new CertificateValidationError('subjectEmail', 'subjectEmail invalid');
  }
  const scope = (input.scope ?? '').toString();
  if (scope.length > MAX_SCOPE) {
    throw new CertificateValidationError('scope', `scope exceeds ${MAX_SCOPE} chars`);
  }
  const workspaceId = (input.workspaceId ?? '').trim();
  if (!workspaceId) throw new CertificateValidationError('workspaceId', 'workspaceId required');
  const fulfilledBy = (input.fulfilledBy ?? '').trim();
  if (!fulfilledBy) throw new CertificateValidationError('fulfilledBy', 'fulfilledBy required');

  const file = await readCertificateFile(dataDir);

  const existing = file.certificates.find((c) => c.dsrId === dsrId);
  if (existing) return existing;

  if (file.certificates.length >= MAX_CERTIFICATES) {
    throw new CertificateValidationError('store', `certificate store at capacity`);
  }

  const id = 'erc_' + randomBytes(9).toString('base64url');
  const issuedAt = Date.now();
  const subjectEmailFingerprint = hashEmail(subjectEmail);

  const payloadFields = {
    id,
    dsrId,
    workspaceId,
    subjectEmailFingerprint,
    scope,
    fulfilledBy,
    fulfilledAt: Math.floor(input.fulfilledAt),
    issuedAt,
  };
  const payload = canonicalPayload(payloadFields);
  const contentFingerprint = createHash('sha256').update(payload).digest('hex');
  const secret = await loadOrCreateSecret(dataDir);
  const signature = createHmac('sha256', secret).update(payload).digest('hex');

  const record: ErasureCertificate = {
    ...payloadFields,
    contentFingerprint,
    signature,
    algo: 'hmac-sha256',
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
  };
  file.certificates.unshift(record);
  await writeCertificateFile(dataDir, file);
  return record;
}

export async function listCertificates(
  dataDir: string,
  opts?: { workspaceId?: string },
): Promise<ErasureCertificate[]> {
  const file = await readCertificateFile(dataDir);
  let rows = file.certificates;
  if (opts?.workspaceId) rows = rows.filter((c) => c.workspaceId === opts.workspaceId);
  return rows;
}

export async function getCertificate(
  dataDir: string,
  id: string,
): Promise<ErasureCertificate | null> {
  const file = await readCertificateFile(dataDir);
  return file.certificates.find((c) => c.id === id) ?? null;
}

/** Verify a certificate's signature against the persisted secret. Returns
 *  false if the row is tampered or the secret cannot be loaded. */
export async function verifySignature(
  dataDir: string,
  cert: ErasureCertificate,
): Promise<boolean> {
  const payload = canonicalPayload({
    id: cert.id,
    dsrId: cert.dsrId,
    workspaceId: cert.workspaceId,
    subjectEmailFingerprint: cert.subjectEmailFingerprint,
    scope: cert.scope,
    fulfilledBy: cert.fulfilledBy,
    fulfilledAt: cert.fulfilledAt,
    issuedAt: cert.issuedAt,
  });
  const fp = createHash('sha256').update(payload).digest('hex');
  if (fp !== cert.contentFingerprint) return false;
  const secret = await loadOrCreateSecret(dataDir);
  const want = Buffer.from(cert.signature, 'hex');
  const got = Buffer.from(
    createHmac('sha256', secret).update(payload).digest('hex'),
    'hex',
  );
  if (want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}

/** Constant-time check that `email` matches the subject the certificate
 *  was issued for. Used by the public verify endpoint so a subject can
 *  prove ownership without the operator revealing the address publicly. */
export function subjectEmailMatches(cert: ErasureCertificate, email: string): boolean {
  const want = Buffer.from(cert.subjectEmailFingerprint, 'hex');
  const got = Buffer.from(hashEmail(email), 'hex');
  if (want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}

/** Public projection: never leaks the subject email or any operator
 *  metadata. Safe to return on the unauthenticated GET. */
export function publicView(cert: ErasureCertificate): {
  id: string;
  dsrId: string;
  workspaceId: string;
  subjectEmailFingerprint: string;
  scope: string;
  fulfilledAt: number;
  issuedAt: number;
  contentFingerprint: string;
  signature: string;
  algo: 'hmac-sha256';
  revokedAt: number | null;
  revokedReason: string | null;
} {
  return {
    id: cert.id,
    dsrId: cert.dsrId,
    workspaceId: cert.workspaceId,
    subjectEmailFingerprint: cert.subjectEmailFingerprint,
    scope: cert.scope,
    fulfilledAt: cert.fulfilledAt,
    issuedAt: cert.issuedAt,
    contentFingerprint: cert.contentFingerprint,
    signature: cert.signature,
    algo: cert.algo,
    revokedAt: cert.revokedAt,
    revokedReason: cert.revokedReason,
  };
}

export async function revokeCertificate(
  dataDir: string,
  id: string,
  actorId: string,
  reason: string,
): Promise<ErasureCertificate | null> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) throw new CertificateValidationError('reason', 'reason required');
  if (trimmed.length > 500) {
    throw new CertificateValidationError('reason', 'reason exceeds 500 chars');
  }
  const file = await readCertificateFile(dataDir);
  const cert = file.certificates.find((c) => c.id === id);
  if (!cert) return null;
  if (cert.revokedAt) return cert;
  cert.revokedAt = Date.now();
  cert.revokedBy = actorId;
  cert.revokedReason = trimmed;
  await writeCertificateFile(dataDir, file);
  return cert;
}
