// Workspace encryption keys (CMEK / BYOK).
//
// Enterprise procurement reviews increasingly require that the tenant
// controls the key that encrypts their data at rest, not just the
// provider. This module implements the operator-facing surface:
//
//   * A workspace data encryption key (DEK) is a 32-byte AES-256-GCM
//     key. It is generated locally and wrapped (encrypted) by a key
//     encryption key (KEK).
//   * By default the KEK is a server-managed master key derived from
//     CLAWMIND_MASTER_KEK (or, in dev, a deterministic value so the
//     test suite is hermetic). In that mode this is internal KMS.
//   * If the customer uploads a 32-byte KEK (base64) we use theirs.
//     Their KEK never touches disk; only the wrapped DEK is persisted,
//     along with a SHA-256 fingerprint of the KEK so they can prove
//     which key was in force at any rotation. If the operator removes
//     the customer KEK we automatically rewrap the DEK under the
//     internal KEK, so encrypted artifacts produced under the previous
//     wrapping stay decryptable.
//   * Rotating the DEK is a separate first-class operation: it mints
//     a fresh DEK, wraps it under the current KEK, archives the prior
//     wrapped DEK so artifacts created before rotation can still be
//     opened, and bumps the active keyId so freshly written artifacts
//     are clearly tied to the new generation.
//
// What this is NOT: a substitute for a real KMS. There is no HSM, no
// network call to AWS KMS / GCP CMEK / Azure Key Vault. The shape is
// honest about that and uses the same vocabulary so a future drop-in
// adapter for AWS KMS is a thin replacement of wrapKey / unwrapKey.

import { createCipheriv, createDecipheriv, createHash, randomBytes, hkdfSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const ENCRYPTION_SCHEMA = 'clawmind.encryption.v1' as const;

export const ENCRYPTION_LIMITS = {
  maxArchivedDeks: 16,
  kekBytes: 32,
  dekBytes: 32,
} as const;

export type KekKind = 'internal' | 'customer';

export interface WrappedDek {
  /** Stable identifier for this DEK generation. */
  keyId: string;
  /** Base64 of [12-byte iv | ciphertext | 16-byte auth tag]. */
  wrapped: string;
  /** Fingerprint of the KEK that wrapped this DEK at creation time. */
  wrappedByKekFingerprint: string;
  wrappedByKekKind: KekKind;
  createdAt: number;
  createdBy: string;
}

export interface EncryptionRecord {
  schema: typeof ENCRYPTION_SCHEMA;
  /** Which KEK is currently in force. */
  kekKind: KekKind;
  /** SHA-256 fingerprint of the currently active KEK (first 16 hex chars surfaced in UI). */
  kekFingerprint: string;
  /** Currently active wrapped DEK. */
  active: WrappedDek;
  /** Prior wrapped DEKs, newest first. Kept so older ciphertexts decrypt. */
  archived: WrappedDek[];
  /** Monotonic update counter for the UI / etag. */
  version: number;
  updatedAt: number;
  updatedBy: string;
}

export class EncryptionValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'EncryptionValidationError';
  }
}

export class EncryptionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionStateError';
  }
}

function recordPath(dir: string): string {
  return join(dir, 'encryption.json');
}

/**
 * Derive the internal master KEK from an operator-provided seed (env
 * CLAWMIND_MASTER_KEK in prod, deterministic in dev). HKDF gives a
 * 32-byte key suitable for AES-256-GCM regardless of how long the
 * seed is. The seed itself is never persisted; only the fingerprint
 * of the derived key is recorded.
 */
function internalKek(): Buffer {
  const seed = process.env.CLAWMIND_MASTER_KEK?.trim() || 'clawmind-internal-dev-master-kek-do-not-use-in-prod';
  const out = hkdfSync('sha256', Buffer.from(seed, 'utf8'), Buffer.alloc(0), Buffer.from('clawmind/encryption/master-v1'), 32);
  return Buffer.from(out);
}

function decodeCustomerKek(b64: string): Buffer {
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, 'base64');
  } catch {
    throw new EncryptionValidationError('kek', 'kek must be base64');
  }
  if (raw.length !== ENCRYPTION_LIMITS.kekBytes) {
    throw new EncryptionValidationError('kek', `kek must decode to ${ENCRYPTION_LIMITS.kekBytes} bytes`);
  }
  return raw;
}

function fingerprint(kek: Buffer): string {
  return createHash('sha256').update(kek).digest('hex');
}

/**
 * Wrap (encrypt) a raw DEK under the supplied KEK using AES-256-GCM.
 * Layout: 12-byte iv || ciphertext || 16-byte auth tag, base64-encoded.
 */
function wrapKey(dek: Buffer, kek: Buffer): string {
  if (dek.length !== ENCRYPTION_LIMITS.dekBytes) {
    throw new EncryptionStateError('dek must be 32 bytes');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

function unwrapKey(wrapped: string, kek: Buffer): Buffer {
  let raw: Buffer;
  try {
    raw = Buffer.from(wrapped, 'base64');
  } catch {
    throw new EncryptionStateError('wrapped dek is not valid base64');
  }
  if (raw.length < 12 + 16 + 1) {
    throw new EncryptionStateError('wrapped dek is truncated');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new EncryptionStateError('wrapped dek failed authentication: wrong KEK');
  }
}

function newKeyId(): string {
  return `dek_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

async function readRecord(dir: string): Promise<EncryptionRecord | null> {
  try {
    const raw = await readFile(recordPath(dir), 'utf8');
    const parsed = JSON.parse(raw) as EncryptionRecord;
    if (parsed?.schema !== ENCRYPTION_SCHEMA || !parsed.active) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

async function writeRecord(dir: string, rec: EncryptionRecord): Promise<void> {
  await mkdir(dirname(recordPath(dir)), { recursive: true });
  await writeFile(recordPath(dir), JSON.stringify(rec, null, 2), 'utf8');
}

/**
 * Initialise the record if missing. Always uses the internal KEK on
 * first run so the system is encrypted-by-default; the operator can
 * upgrade to a customer KEK at any time.
 */
async function ensureRecord(dir: string, actor: string): Promise<EncryptionRecord> {
  const existing = await readRecord(dir);
  if (existing) return existing;
  const kek = internalKek();
  const dek = randomBytes(ENCRYPTION_LIMITS.dekBytes);
  const fp = fingerprint(kek);
  const wrapped: WrappedDek = {
    keyId: newKeyId(),
    wrapped: wrapKey(dek, kek),
    wrappedByKekFingerprint: fp,
    wrappedByKekKind: 'internal',
    createdAt: Date.now(),
    createdBy: actor,
  };
  const rec: EncryptionRecord = {
    schema: ENCRYPTION_SCHEMA,
    kekKind: 'internal',
    kekFingerprint: fp,
    active: wrapped,
    archived: [],
    version: 1,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  await writeRecord(dir, rec);
  return rec;
}

/** Public projection of the record: never includes wrapped material. */
export interface EncryptionStatus {
  schema: typeof ENCRYPTION_SCHEMA;
  kekKind: KekKind;
  kekFingerprint: string;
  kekFingerprintShort: string;
  activeKeyId: string;
  activeKeyCreatedAt: number;
  activeKeyCreatedBy: string;
  archivedKeyCount: number;
  archivedKeys: Array<{ keyId: string; createdAt: number; wrappedByKekKind: KekKind; wrappedByKekFingerprintShort: string }>;
  version: number;
  updatedAt: number;
  updatedBy: string;
}

function project(rec: EncryptionRecord): EncryptionStatus {
  return {
    schema: rec.schema,
    kekKind: rec.kekKind,
    kekFingerprint: rec.kekFingerprint,
    kekFingerprintShort: rec.kekFingerprint.slice(0, 16),
    activeKeyId: rec.active.keyId,
    activeKeyCreatedAt: rec.active.createdAt,
    activeKeyCreatedBy: rec.active.createdBy,
    archivedKeyCount: rec.archived.length,
    archivedKeys: rec.archived.slice(0, 8).map((a) => ({
      keyId: a.keyId,
      createdAt: a.createdAt,
      wrappedByKekKind: a.wrappedByKekKind,
      wrappedByKekFingerprintShort: a.wrappedByKekFingerprint.slice(0, 16),
    })),
    version: rec.version,
    updatedAt: rec.updatedAt,
    updatedBy: rec.updatedBy,
  };
}

export async function getStatus(dir: string, actor = 'system'): Promise<EncryptionStatus> {
  const rec = await ensureRecord(dir, actor);
  return project(rec);
}

/**
 * Replace the active KEK with a customer-supplied key. The existing
 * DEK is unwrapped under the current KEK and rewrapped under the new
 * KEK; archived DEKs are likewise rewrapped so a future "remove
 * customer KEK" call can still decrypt every prior generation.
 *
 * The plaintext customer KEK is held only for the duration of this
 * call. It is never persisted; the caller is responsible for
 * surfacing it once at upload time so they can re-supply it if the
 * deployment is destroyed and restored from backup.
 */
export async function uploadCustomerKek(dir: string, actor: string, kekB64: string): Promise<EncryptionStatus> {
  const newKek = decodeCustomerKek(kekB64);
  const rec = await ensureRecord(dir, actor);
  const currentKek = rec.kekKind === 'internal' ? internalKek() : null;
  if (rec.kekKind === 'customer') {
    throw new EncryptionStateError('a customer kek is already configured; remove it first');
  }
  const newFp = fingerprint(newKek);
  const internalFp = fingerprint(currentKek!);
  if (timingSafeEqual(Buffer.from(newFp, 'hex'), Buffer.from(internalFp, 'hex'))) {
    throw new EncryptionValidationError('kek', 'customer kek must not equal internal kek');
  }
  // Rewrap active + archived under the new KEK so removal can restore.
  const dek = unwrapKey(rec.active.wrapped, currentKek!);
  const rewrappedActive: WrappedDek = {
    ...rec.active,
    wrapped: wrapKey(dek, newKek),
    wrappedByKekFingerprint: newFp,
    wrappedByKekKind: 'customer',
  };
  const rewrappedArchived: WrappedDek[] = rec.archived.map((a) => {
    const k = unwrapKey(a.wrapped, currentKek!);
    return {
      ...a,
      wrapped: wrapKey(k, newKek),
      wrappedByKekFingerprint: newFp,
      wrappedByKekKind: 'customer',
    };
  });
  const next: EncryptionRecord = {
    ...rec,
    kekKind: 'customer',
    kekFingerprint: newFp,
    active: rewrappedActive,
    archived: rewrappedArchived,
    version: rec.version + 1,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  await writeRecord(dir, next);
  return project(next);
}

/**
 * Drop the customer KEK and rewrap everything under the internal one.
 * Requires the caller to supply the same customer KEK that is in
 * force, both as a tamper check and so we can unwrap. This protects
 * against an attacker with file-system access (but no KEK) silently
 * downgrading the workspace to internal KMS.
 */
export async function removeCustomerKek(dir: string, actor: string, kekB64: string): Promise<EncryptionStatus> {
  const supplied = decodeCustomerKek(kekB64);
  const rec = await ensureRecord(dir, actor);
  if (rec.kekKind !== 'customer') {
    throw new EncryptionStateError('no customer kek is configured');
  }
  const fp = fingerprint(supplied);
  if (!timingSafeEqual(Buffer.from(fp, 'hex'), Buffer.from(rec.kekFingerprint, 'hex'))) {
    throw new EncryptionValidationError('kek', 'supplied kek does not match the active fingerprint');
  }
  const newKek = internalKek();
  const newFp = fingerprint(newKek);
  const dek = unwrapKey(rec.active.wrapped, supplied);
  const rewrappedActive: WrappedDek = {
    ...rec.active,
    wrapped: wrapKey(dek, newKek),
    wrappedByKekFingerprint: newFp,
    wrappedByKekKind: 'internal',
  };
  const rewrappedArchived: WrappedDek[] = rec.archived.map((a) => {
    const k = unwrapKey(a.wrapped, supplied);
    return {
      ...a,
      wrapped: wrapKey(k, newKek),
      wrappedByKekFingerprint: newFp,
      wrappedByKekKind: 'internal',
    };
  });
  const next: EncryptionRecord = {
    ...rec,
    kekKind: 'internal',
    kekFingerprint: newFp,
    active: rewrappedActive,
    archived: rewrappedArchived,
    version: rec.version + 1,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  await writeRecord(dir, next);
  return project(next);
}

/**
 * Mint a fresh DEK and archive the previous one. Wrapped under the
 * currently active KEK. Bounded archive size means very old keys are
 * eventually dropped; callers that need long-term ciphertext recovery
 * should re-encrypt with the active key on access.
 */
export async function rotateDek(dir: string, actor: string, customerKekB64?: string): Promise<EncryptionStatus> {
  const rec = await ensureRecord(dir, actor);
  let kek: Buffer;
  if (rec.kekKind === 'customer') {
    if (!customerKekB64) {
      throw new EncryptionValidationError('kek', 'rotation requires the current customer kek');
    }
    const supplied = decodeCustomerKek(customerKekB64);
    if (!timingSafeEqual(Buffer.from(fingerprint(supplied), 'hex'), Buffer.from(rec.kekFingerprint, 'hex'))) {
      throw new EncryptionValidationError('kek', 'supplied kek does not match the active fingerprint');
    }
    kek = supplied;
  } else {
    kek = internalKek();
  }
  const dek = randomBytes(ENCRYPTION_LIMITS.dekBytes);
  const fresh: WrappedDek = {
    keyId: newKeyId(),
    wrapped: wrapKey(dek, kek),
    wrappedByKekFingerprint: rec.kekFingerprint,
    wrappedByKekKind: rec.kekKind,
    createdAt: Date.now(),
    createdBy: actor,
  };
  const archived = [rec.active, ...rec.archived].slice(0, ENCRYPTION_LIMITS.maxArchivedDeks);
  const next: EncryptionRecord = {
    ...rec,
    active: fresh,
    archived,
    version: rec.version + 1,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  await writeRecord(dir, next);
  return project(next);
}

/**
 * Encrypt a payload using the currently active DEK. Returns a
 * self-describing envelope so a future decryptor can find the right
 * archived DEK without ambient context.
 */
export interface EncryptedEnvelope {
  schema: typeof ENCRYPTION_SCHEMA;
  keyId: string;
  /** base64 of iv || ciphertext || tag */
  payload: string;
}

export async function encryptPayload(dir: string, plaintext: Buffer, customerKekB64?: string): Promise<EncryptedEnvelope> {
  const rec = await ensureRecord(dir, 'system');
  const kek = rec.kekKind === 'customer'
    ? (customerKekB64
      ? decodeCustomerKek(customerKekB64)
      : (() => { throw new EncryptionValidationError('kek', 'customer kek is required to encrypt under a customer-managed key'); })())
    : internalKek();
  if (rec.kekKind === 'customer' && !timingSafeEqual(Buffer.from(fingerprint(kek), 'hex'), Buffer.from(rec.kekFingerprint, 'hex'))) {
    throw new EncryptionValidationError('kek', 'supplied kek does not match the active fingerprint');
  }
  const dek = unwrapKey(rec.active.wrapped, kek);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    schema: ENCRYPTION_SCHEMA,
    keyId: rec.active.keyId,
    payload: Buffer.concat([iv, ct, tag]).toString('base64'),
  };
}

export async function decryptEnvelope(dir: string, env: EncryptedEnvelope, customerKekB64?: string): Promise<Buffer> {
  const rec = await ensureRecord(dir, 'system');
  const candidate = rec.active.keyId === env.keyId ? rec.active : rec.archived.find((a) => a.keyId === env.keyId);
  if (!candidate) {
    throw new EncryptionStateError(`unknown keyId: ${env.keyId}`);
  }
  const kek = candidate.wrappedByKekKind === 'customer'
    ? (customerKekB64
      ? decodeCustomerKek(customerKekB64)
      : (() => { throw new EncryptionValidationError('kek', 'customer kek is required to decrypt'); })())
    : internalKek();
  const dek = unwrapKey(candidate.wrapped, kek);
  const raw = Buffer.from(env.payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
