import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// TOTP-based multi-factor authentication for owner-level accounts.
//
// Storage: <dataDir>/mfa/<userId>.json. One file per user so a single
// corrupt blob cannot lock out the whole tenant. Atomic-rewrite via tmp +
// rename, matching the pattern used by sessions.ts and api-keys.ts.
//
// What lives on disk:
//   secret         base32(160-bit) shared with the authenticator app
//   confirmedAt    set after the user proves possession by entering a code
//                  (so a half-finished enrollment cannot lock the account)
//   recoveryHashes sha256 of single-use 10-char recovery codes. Hashed so a
//                  leaked file does not equal a leaked recovery code; each
//                  entry is consumed on first use.
//   stepUpTtlSec   how long a successful verify keeps the session "stepped
//                  up" before MFA is re-required. Per-user override of the
//                  global default.
//
// What never lives on disk: raw recovery codes, raw TOTP codes, or last-
// used TOTP timestamps (we replay-protect within the verify window in
// memory, see usedWindow below).

const STEP_UP_TTL_DEFAULT_SEC = 15 * 60; // 15 minutes
const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1; // accept code in the prior or next 30s slot
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LEN = 10; // chars, base32 alphabet

export interface MfaRecord {
  userId: string;
  secret: string; // base32, never sent to client after enrollment is confirmed
  confirmedAt: number | null;
  createdAt: number;
  recoveryHashes: string[];
  stepUpTtlSec: number;
}

interface MfaFile {
  version: 1;
  record: MfaRecord;
}

function fileFor(dir: string, userId: string): string {
  // userId is taken from the trusted session, but defence-in-depth: only
  // allow a small ascii subset in the path so a future code path that uses
  // user input cannot escape the mfa directory.
  const safe = userId.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return join(dir, 'mfa', `${safe}.json`);
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

export async function loadMfa(dir: string, userId: string): Promise<MfaRecord | null> {
  try {
    const buf = await readFile(fileFor(dir, userId), 'utf8');
    const parsed = JSON.parse(buf) as MfaFile;
    if (!parsed?.record || parsed.version !== 1) return null;
    return parsed.record;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function saveMfa(dir: string, record: MfaRecord): Promise<void> {
  const file: MfaFile = { version: 1, record };
  await atomicWrite(fileFor(dir, record.userId), JSON.stringify(file, null, 2));
}

// ---------- base32 ----------
const B32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHA[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHA[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of cleaned) {
    const idx = B32_ALPHA.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- TOTP ----------
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8);
  // counter fits in 53-bit safe integer for any realistic time window
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(buf).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const bin =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  return (bin % mod).toString().padStart(digits, '0');
}

export function totpAt(secretBase32: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD);
  return hotp(base32Decode(secretBase32), counter);
}

// Replay protection: remember (userId, counter) pairs that have been used
// within the acceptance window. The map is bounded; entries older than the
// window naturally expire by clock advance.
const usedWindow = new Map<string, Set<number>>();
function markUsed(userId: string, counter: number): void {
  const now = Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  const set = usedWindow.get(userId) ?? new Set<number>();
  // Prune anything older than 2 periods
  for (const c of set) if (c < now - 2) set.delete(c);
  set.add(counter);
  usedWindow.set(userId, set);
}
function isUsed(userId: string, counter: number): boolean {
  return usedWindow.get(userId)?.has(counter) ?? false;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'not-enrolled' | 'not-confirmed' | 'invalid' | 'replay';
  method?: 'totp' | 'recovery';
}

export function verifyTotpCode(record: MfaRecord, code: string, nowMs = Date.now()): VerifyResult {
  if (!record.confirmedAt) return { ok: false, reason: 'not-confirmed' };
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return { ok: false, reason: 'invalid' };
  const secret = base32Decode(record.secret);
  const baseCounter = Math.floor(nowMs / 1000 / TOTP_PERIOD);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const counter = baseCounter + drift;
    const expected = hotp(secret, counter);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (isUsed(record.userId, counter)) return { ok: false, reason: 'replay' };
      markUsed(record.userId, counter);
      return { ok: true, method: 'totp' };
    }
  }
  return { ok: false, reason: 'invalid' };
}

// ---------- recovery codes ----------
function generateRecoveryCode(): string {
  // 10 chars from the base32 alphabet, formatted as XXXXX-XXXXX for legibility
  const bytes = randomBytes(8); // 64 bits -> 13 chars base32; we slice to 10
  const raw = base32Encode(bytes).slice(0, RECOVERY_CODE_LEN);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function hashRecoveryCode(code: string): string {
  const normalised = code.replace(/[-\s]/g, '').toUpperCase();
  return createHash('sha256').update(normalised).digest('hex');
}

export function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateRecoveryCode();
    plain.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { plain, hashes };
}

export function consumeRecoveryCode(record: MfaRecord, code: string): boolean {
  if (!record.confirmedAt) return false;
  const target = hashRecoveryCode(code);
  const idx = record.recoveryHashes.findIndex((h) => {
    const a = Buffer.from(h, 'hex');
    const b = Buffer.from(target, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (idx < 0) return false;
  record.recoveryHashes.splice(idx, 1);
  return true;
}

// ---------- public API ----------
export interface EnrollmentResult {
  secret: string; // base32, shown ONCE during enrollment
  otpauthUrl: string; // for QR
  recoveryCodes: string[]; // shown ONCE
}

export async function startEnrollment(
  dir: string,
  userId: string,
  opts: { issuer?: string; accountLabel?: string } = {},
): Promise<EnrollmentResult> {
  // Generate fresh material. If an unconfirmed enrollment already exists we
  // overwrite it (the user is restarting). A confirmed enrollment is left
  // untouched: callers must disable first, by policy.
  const existing = await loadMfa(dir, userId);
  if (existing?.confirmedAt) {
    throw new Error('mfa already enrolled; disable first');
  }
  const secretBytes = randomBytes(20); // 160-bit per RFC 6238
  const secret = base32Encode(secretBytes);
  const recovery = generateRecoveryCodes();
  const record: MfaRecord = {
    userId,
    secret,
    confirmedAt: null,
    createdAt: Date.now(),
    recoveryHashes: recovery.hashes,
    stepUpTtlSec: STEP_UP_TTL_DEFAULT_SEC,
  };
  await saveMfa(dir, record);
  const issuer = encodeURIComponent(opts.issuer ?? 'ClawMind');
  const label = encodeURIComponent(opts.accountLabel ?? userId);
  const otpauthUrl =
    `otpauth://totp/${issuer}:${label}?secret=${secret}` +
    `&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
  return { secret, otpauthUrl, recoveryCodes: recovery.plain };
}

export async function confirmEnrollment(
  dir: string,
  userId: string,
  code: string,
): Promise<{ ok: boolean; reason?: string }> {
  const record = await loadMfa(dir, userId);
  if (!record) return { ok: false, reason: 'not-enrolled' };
  if (record.confirmedAt) return { ok: true };
  // Reuse verifyTotpCode logic but bypass the confirmedAt guard.
  const probe: MfaRecord = { ...record, confirmedAt: Date.now() };
  const result = verifyTotpCode(probe, code);
  if (!result.ok) return { ok: false, reason: result.reason };
  record.confirmedAt = Date.now();
  await saveMfa(dir, record);
  return { ok: true };
}

export async function verifyForStepUp(
  dir: string,
  userId: string,
  code: string,
): Promise<VerifyResult> {
  const record = await loadMfa(dir, userId);
  if (!record) return { ok: false, reason: 'not-enrolled' };
  if (!record.confirmedAt) return { ok: false, reason: 'not-confirmed' };
  const totp = verifyTotpCode(record, code);
  if (totp.ok) return totp;
  // Fall back to recovery codes when input is not a 6-digit TOTP
  if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
    if (consumeRecoveryCode(record, code)) {
      await saveMfa(dir, record);
      return { ok: true, method: 'recovery' };
    }
  }
  return { ok: false, reason: 'invalid' };
}

export async function disableMfa(dir: string, userId: string): Promise<void> {
  try {
    await unlink(fileFor(dir, userId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function regenerateRecoveryCodes(
  dir: string,
  userId: string,
): Promise<string[] | null> {
  const record = await loadMfa(dir, userId);
  if (!record || !record.confirmedAt) return null;
  const recovery = generateRecoveryCodes();
  record.recoveryHashes = recovery.hashes;
  await saveMfa(dir, record);
  return recovery.plain;
}

export interface MfaStatus {
  enrolled: boolean;
  confirmed: boolean;
  createdAt: number | null;
  confirmedAt: number | null;
  recoveryCodesRemaining: number;
  stepUpTtlSec: number;
}

export async function getStatus(dir: string, userId: string): Promise<MfaStatus> {
  const record = await loadMfa(dir, userId);
  if (!record) {
    return {
      enrolled: false,
      confirmed: false,
      createdAt: null,
      confirmedAt: null,
      recoveryCodesRemaining: 0,
      stepUpTtlSec: STEP_UP_TTL_DEFAULT_SEC,
    };
  }
  return {
    enrolled: true,
    confirmed: !!record.confirmedAt,
    createdAt: record.createdAt,
    confirmedAt: record.confirmedAt,
    recoveryCodesRemaining: record.recoveryHashes.length,
    stepUpTtlSec: record.stepUpTtlSec,
  };
}

export function stepUpExpiresAt(record: MfaRecord, stepUpAtMs: number): number {
  return stepUpAtMs + record.stepUpTtlSec * 1000;
}

export { STEP_UP_TTL_DEFAULT_SEC };
