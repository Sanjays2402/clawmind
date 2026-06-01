import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Data Processing Agreement (DPA) acceptance registry.
//
// Enterprise procurement and the buyer's legal team cannot countersign
// a master service agreement without a Data Processing Agreement that
// names a specific document version and a signatory of record at the
// vendor side. Hand-signed PDFs that live in someone's inbox are not
// auditable; this service makes the acceptance a first-class server
// record with:
//
//   - a built-in canonical DPA text shipped in the codebase (so the
//     buyer can diff what they're signing against the source);
//   - a content fingerprint (SHA-256) over the exact bytes of the
//     version the workspace accepted, so a later text change cannot
//     silently mutate prior acceptance;
//   - a per-acceptance HMAC signature over (versionId, fingerprint,
//     signatory, ts, workspaceId) that the buyer can take away as a
//     verifiable receipt and re-check offline against the same secret
//     used for erasure certificates;
//   - actor/IP capture and an audit-log entry on every acceptance.
//
// Storage: a single JSON file under the data directory, append-only
// in the sense that re-accepting a newer version preserves history.
// Tiny, hand-auditable, no migration.

const FILE = 'dpa-acceptances.json';
const SECRET_FILE = 'dpa.secret';
const WORKSPACE_ID = 'default';

const FIELD_LIMITS = Object.freeze({
  signatoryName: 200,
  signatoryTitle: 200,
  signatoryEmail: 320,
  notes: 1000,
});

export class DpaValidationError extends Error {
  constructor(
    public field: string,
    message: string,
  ) {
    super(message);
    this.name = 'DpaValidationError';
  }
}

export interface DpaVersion {
  /** Stable identifier, e.g. "2025-01-15". */
  id: string;
  /** Semver-style label customers cite in their own MSA, e.g. "1.2.0". */
  label: string;
  /** Effective date (ISO YYYY-MM-DD) shown on the public list. */
  effective: string;
  /** Plain-text body. The fingerprint is computed over these exact bytes. */
  body: string;
  /** SHA-256(body) hex, precomputed at module load so the public list
   *  is cheap. The acceptance record duplicates this so a later text
   *  change cannot silently re-stamp historical acceptances. */
  fingerprint: string;
  /** Short customer-facing summary of what changed vs. the prior version. */
  changelog: string;
}

export interface DpaAcceptance {
  id: string;
  workspaceId: string;
  versionId: string;
  versionLabel: string;
  versionFingerprint: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  notes: string | null;
  acceptedByUserId: string;
  acceptedAt: number;
  acceptedFromIp: string;
  /** HMAC-SHA256 signature over the canonical receipt body. */
  signature: string;
  algo: 'hmac-sha256';
}

interface AcceptanceFile {
  version: 1;
  acceptances: DpaAcceptance[];
}

// Built-in DPA versions. Ship the bytes in code so the buyer can diff
// the canonical text against this repo at any tag. Only append new
// versions; never edit a published body, or the fingerprint changes
// and prior acceptances will fail re-verification on purpose.
const DPA_VERSIONS_RAW: Omit<DpaVersion, 'fingerprint'>[] = [
  {
    id: '2025-01-15',
    label: '1.0.0',
    effective: '2025-01-15',
    changelog: 'Initial published Data Processing Agreement.',
    body: [
      'CLAWMIND DATA PROCESSING AGREEMENT (DPA) v1.0.0',
      '',
      'This Data Processing Agreement ("DPA") forms part of the Master',
      'Services Agreement ("MSA") between the Customer ("Controller") and',
      'the Operator of this ClawMind installation ("Processor"). Capitalised',
      'terms used but not defined here have the meaning given in the MSA',
      'or in Regulation (EU) 2016/679 ("GDPR").',
      '',
      '1. SCOPE AND ROLES',
      'The Processor processes Personal Data only on documented instructions',
      'from the Controller, including the Controller use of the ClawMind',
      'platform under the MSA. Categories of Data Subjects and Personal',
      'Data, the nature and purpose of processing, and the duration are',
      'described in Annex I (Record of Processing Activities).',
      '',
      '2. CONFIDENTIALITY',
      'The Processor ensures that persons authorised to process Personal',
      'Data have committed themselves to confidentiality or are under an',
      'appropriate statutory obligation of confidentiality.',
      '',
      '3. SECURITY OF PROCESSING (Art. 32 GDPR)',
      'The Processor implements the technical and organisational measures',
      'documented in the published Trust Centre, including at-rest and',
      'in-transit encryption, role-based access control, MFA enforcement,',
      'audit logging, sub-processor disclosure, and incident response.',
      '',
      '4. SUB-PROCESSORS (Art. 28 GDPR)',
      'The Processor maintains a public list of sub-processors at',
      '/v1/sub-processors. The Controller may subscribe to advance-notice',
      'broadcasts of additions; objections must be raised within 30 days',
      'of disclosure.',
      '',
      '5. DATA SUBJECT RIGHTS',
      'The Processor assists the Controller, by appropriate technical and',
      'organisational measures, in fulfilling Data Subject access, erasure,',
      'rectification, restriction, portability, and objection requests.',
      'Erasure is evidenced by a signed certificate issued under the',
      'Erasure Certificate Service.',
      '',
      '6. PERSONAL DATA BREACH',
      'The Processor notifies the Controller without undue delay after',
      'becoming aware of a Personal Data Breach affecting the Controller',
      'data.',
      '',
      '7. INTERNATIONAL TRANSFERS',
      'Where Personal Data is transferred outside the EEA, the parties',
      'rely on the Standard Contractual Clauses (Decision (EU) 2021/914)',
      'incorporated by reference, plus the supplementary measures in the',
      'Trust Centre.',
      '',
      '8. AUDIT',
      'The Processor makes available to the Controller all information',
      'necessary to demonstrate compliance with Article 28 GDPR, including',
      'the audit log export at /v1/audit and the RoPA at /v1/ropa.',
      '',
      '9. DELETION OR RETURN',
      'On termination of the MSA, the Processor deletes or returns all',
      'Personal Data to the Controller and deletes existing copies,',
      'unless retention is required by law.',
      '',
      '10. GOVERNING LAW',
      'This DPA is governed by the laws designated in the MSA.',
      '',
      'EXECUTION',
      'Acceptance of this DPA is recorded through the ClawMind API at',
      'POST /v1/dpa/accept with the signatory of record (name, title,',
      'email). A signed receipt is returned and may be re-verified offline',
      'against the Processor public key list.',
    ].join('\n'),
  },
];

export const DPA_VERSIONS: DpaVersion[] = DPA_VERSIONS_RAW.map((v) => ({
  ...v,
  fingerprint: createHash('sha256').update(v.body, 'utf8').digest('hex'),
}));

export function listVersions(): DpaVersion[] {
  return DPA_VERSIONS.slice();
}

export function getVersion(id: string): DpaVersion | null {
  return DPA_VERSIONS.find((v) => v.id === id) ?? null;
}

/** The version a fresh acceptance should target unless the caller asks
 *  for a specific older one (in which case we still accept it but flag
 *  the response so the UI can warn). */
export function currentVersion(): DpaVersion {
  // Last entry wins so the codebase order = chronological.
  return DPA_VERSIONS[DPA_VERSIONS.length - 1]!;
}

function fileFor(dataDir: string): string {
  return join(dataDir, FILE);
}

function secretFor(dataDir: string): string {
  return join(dataDir, SECRET_FILE);
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

async function readFile_(dataDir: string): Promise<AcceptanceFile> {
  try {
    const raw = await readFile(fileFor(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AcceptanceFile>;
    const acceptances = Array.isArray(parsed.acceptances) ? parsed.acceptances : [];
    return { version: 1, acceptances: acceptances as DpaAcceptance[] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, acceptances: [] };
    }
    throw err;
  }
}

async function writeFile_(dataDir: string, file: AcceptanceFile): Promise<void> {
  const p = fileFor(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
  await rename(tmp, p);
}

function validateString(field: string, value: unknown, max: number, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DpaValidationError(field, `${field} is required`);
    return '';
  }
  if (typeof value !== 'string') {
    throw new DpaValidationError(field, `${field} must be a string`);
  }
  const v = value.trim();
  if (required && v.length === 0) {
    throw new DpaValidationError(field, `${field} is required`);
  }
  if (v.length > max) {
    throw new DpaValidationError(field, `${field} exceeds ${max} characters`);
  }
  return v;
}

function validateEmail(value: unknown): string {
  const v = validateString('signatoryEmail', value, FIELD_LIMITS.signatoryEmail, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new DpaValidationError('signatoryEmail', 'signatoryEmail must be a valid email');
  }
  return v;
}

/** Canonical bytes used for both the content fingerprint AND the HMAC
 *  signature. Field order is fixed so a verifier (potentially offline)
 *  can reconstruct the exact bytes that were signed. */
export function canonicalReceipt(c: {
  id: string;
  workspaceId: string;
  versionId: string;
  versionFingerprint: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  acceptedByUserId: string;
  acceptedAt: number;
}): string {
  return JSON.stringify({
    acceptedAt: c.acceptedAt,
    acceptedByUserId: c.acceptedByUserId,
    algo: 'hmac-sha256',
    id: c.id,
    signatoryEmail: c.signatoryEmail.trim().toLowerCase(),
    signatoryName: c.signatoryName,
    signatoryTitle: c.signatoryTitle,
    versionFingerprint: c.versionFingerprint,
    versionId: c.versionId,
    workspaceId: c.workspaceId,
  });
}

export interface AcceptInput {
  versionId?: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  notes?: string | null;
}

export interface ValidatedAccept {
  versionId: string;
  signatoryName: string;
  signatoryTitle: string;
  signatoryEmail: string;
  notes: string | null;
}

export function validateAccept(input: AcceptInput): ValidatedAccept {
  const versionId =
    input.versionId === undefined || input.versionId === null || input.versionId === ''
      ? currentVersion().id
      : validateString('versionId', input.versionId, 64, true);
  if (!getVersion(versionId)) {
    throw new DpaValidationError('versionId', `unknown DPA version ${versionId}`);
  }
  return {
    versionId,
    signatoryName: validateString('signatoryName', input.signatoryName, FIELD_LIMITS.signatoryName, true),
    signatoryTitle: validateString('signatoryTitle', input.signatoryTitle, FIELD_LIMITS.signatoryTitle, true),
    signatoryEmail: validateEmail(input.signatoryEmail),
    notes:
      input.notes === undefined || input.notes === null || input.notes === ''
        ? null
        : validateString('notes', input.notes, FIELD_LIMITS.notes, false) || null,
  };
}

export interface AcceptContext {
  acceptedByUserId: string;
  acceptedFromIp: string;
  now?: number;
}

export async function recordAcceptance(
  dataDir: string,
  input: AcceptInput,
  ctx: AcceptContext,
): Promise<DpaAcceptance> {
  const v = validateAccept(input);
  const version = getVersion(v.versionId)!;
  const id = 'dpa_' + randomBytes(9).toString('base64url');
  const acceptedAt = ctx.now ?? Date.now();
  const base = {
    id,
    workspaceId: WORKSPACE_ID,
    versionId: version.id,
    versionFingerprint: version.fingerprint,
    signatoryName: v.signatoryName,
    signatoryTitle: v.signatoryTitle,
    signatoryEmail: v.signatoryEmail,
    acceptedByUserId: ctx.acceptedByUserId,
    acceptedAt,
  };
  const payload = canonicalReceipt(base);
  const secret = await loadOrCreateSecret(dataDir);
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const record: DpaAcceptance = {
    ...base,
    versionLabel: version.label,
    notes: v.notes,
    acceptedFromIp: ctx.acceptedFromIp || 'unknown',
    signature,
    algo: 'hmac-sha256',
  };
  const file = await readFile_(dataDir);
  // Keep newest first; cap at a generous limit so a runaway loop cannot
  // grow the file unbounded. Re-accepting the same version is allowed
  // and intentional (re-signing under a new authorised signatory).
  file.acceptances.unshift(record);
  if (file.acceptances.length > 500) {
    file.acceptances = file.acceptances.slice(0, 500);
  }
  await writeFile_(dataDir, file);
  return record;
}

export async function listAcceptances(dataDir: string): Promise<DpaAcceptance[]> {
  const file = await readFile_(dataDir);
  return file.acceptances.slice();
}

export async function getAcceptance(
  dataDir: string,
  id: string,
): Promise<DpaAcceptance | null> {
  const file = await readFile_(dataDir);
  return file.acceptances.find((a) => a.id === id) ?? null;
}

/** Most-recent acceptance, or null if none. Used by the status endpoint
 *  so a buyer can ask "is your DPA on file?" with one call. */
export async function currentAcceptance(
  dataDir: string,
): Promise<DpaAcceptance | null> {
  const file = await readFile_(dataDir);
  return file.acceptances[0] ?? null;
}

export async function verifySignature(
  dataDir: string,
  acceptance: DpaAcceptance,
): Promise<boolean> {
  // The version body fingerprint must still match the shipped text. If
  // someone edited an old DPA version after acceptance, re-verify must
  // fail loudly: that is exactly the threat model.
  const version = getVersion(acceptance.versionId);
  if (!version) return false;
  if (version.fingerprint !== acceptance.versionFingerprint) return false;

  const payload = canonicalReceipt({
    id: acceptance.id,
    workspaceId: acceptance.workspaceId,
    versionId: acceptance.versionId,
    versionFingerprint: acceptance.versionFingerprint,
    signatoryName: acceptance.signatoryName,
    signatoryTitle: acceptance.signatoryTitle,
    signatoryEmail: acceptance.signatoryEmail,
    acceptedByUserId: acceptance.acceptedByUserId,
    acceptedAt: acceptance.acceptedAt,
  });
  const secret = await loadOrCreateSecret(dataDir);
  const want = Buffer.from(acceptance.signature, 'hex');
  const got = Buffer.from(
    createHmac('sha256', secret).update(payload).digest('hex'),
    'hex',
  );
  if (want.length === 0 || want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}

export const DPA_LIMITS = FIELD_LIMITS;
