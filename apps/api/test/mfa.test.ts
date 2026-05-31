import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startEnrollment,
  confirmEnrollment,
  verifyForStepUp,
  disableMfa,
  regenerateRecoveryCodes,
  getStatus,
  loadMfa,
  totpAt,
  hotp,
  base32Encode,
  base32Decode,
  generateRecoveryCodes,
  consumeRecoveryCode,
  verifyTotpCode,
} from '../src/services/mfa.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-mfa-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('mfa base32', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33, 0x44]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('matches RFC 6238 reference for the all-12345678901234567890 secret', () => {
    // RFC 6238 appendix B: T0=0, T=59 (counter=1), SHA1, 6 digits, expected "94287082"... but
    // the reference uses an 8-digit form. For 6 digits we recompute and pin the result so
    // the implementation never silently changes.
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, 1, 6)).toBe('287082');
  });
});

describe('mfa enrollment + step-up', () => {
  it('rejects step-up before enrollment', async () => {
    const r = await verifyForStepUp(dir, 'alice', '000000');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not-enrolled');
  });

  it('start, confirm with valid code, step-up succeeds, replay rejected', async () => {
    const enrol = await startEnrollment(dir, 'alice', { accountLabel: 'alice@example.com' });
    expect(enrol.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrol.otpauthUrl).toContain('otpauth://totp/');
    expect(enrol.recoveryCodes).toHaveLength(10);
    enrol.recoveryCodes.forEach((c) => expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/));

    // unconfirmed status
    const before = await getStatus(dir, 'alice');
    expect(before.enrolled).toBe(true);
    expect(before.confirmed).toBe(false);

    // bad code rejected
    const bad = await confirmEnrollment(dir, 'alice', '000000');
    // 000000 is astronomically unlikely to match a fresh random secret; treat
    // either invalid or replay (if it happened to collide) as a non-pass.
    if (bad.ok) {
      // Re-enroll until we get a distinct shape so the rest of the test is meaningful.
    }
    expect(bad.ok).toBe(false);

    // correct code
    const code = totpAt(enrol.secret, Date.now());
    const ok = await confirmEnrollment(dir, 'alice', code);
    expect(ok.ok).toBe(true);

    const after = await getStatus(dir, 'alice');
    expect(after.confirmed).toBe(true);

    // step-up with a NEW code (next time slot) so we are not hitting replay
    const future = Date.now() + 30_000;
    const next = totpAt(enrol.secret, future);
    // Patch the verifier to "now=future" by passing through verifyTotpCode directly
    const rec = await loadMfa(dir, 'alice');
    const step = verifyTotpCode(rec!, next, future);
    expect(step.ok).toBe(true);
    expect(step.method).toBe('totp');

    // replay of the same counter in the same window must fail
    const replay = verifyTotpCode(rec!, next, future);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('replay');
  });

  it('cannot re-enroll while a confirmed MFA exists', async () => {
    const enrol = await startEnrollment(dir, 'bob');
    await confirmEnrollment(dir, 'bob', totpAt(enrol.secret, Date.now()));
    await expect(startEnrollment(dir, 'bob')).rejects.toThrow(/already enrolled/);
  });

  it('recovery code works once, then is consumed', async () => {
    const enrol = await startEnrollment(dir, 'carol');
    await confirmEnrollment(dir, 'carol', totpAt(enrol.secret, Date.now()));
    const code = enrol.recoveryCodes[0]!;
    const first = await verifyForStepUp(dir, 'carol', code);
    expect(first.ok).toBe(true);
    expect(first.method).toBe('recovery');
    const second = await verifyForStepUp(dir, 'carol', code);
    expect(second.ok).toBe(false);
    const status = await getStatus(dir, 'carol');
    expect(status.recoveryCodesRemaining).toBe(9);
  });

  it('regenerate replaces all recovery codes', async () => {
    const enrol = await startEnrollment(dir, 'dave');
    await confirmEnrollment(dir, 'dave', totpAt(enrol.secret, Date.now()));
    const fresh = await regenerateRecoveryCodes(dir, 'dave');
    expect(fresh).not.toBeNull();
    expect(fresh).toHaveLength(10);
    // Old code no longer accepted
    const stale = await verifyForStepUp(dir, 'dave', enrol.recoveryCodes[0]!);
    expect(stale.ok).toBe(false);
    // New code accepted
    const fresh1 = await verifyForStepUp(dir, 'dave', fresh![0]!);
    expect(fresh1.ok).toBe(true);
  });

  it('disable removes the on-disk record', async () => {
    const enrol = await startEnrollment(dir, 'erin');
    await confirmEnrollment(dir, 'erin', totpAt(enrol.secret, Date.now()));
    await disableMfa(dir, 'erin');
    expect(await loadMfa(dir, 'erin')).toBeNull();
  });

  it('user isolation: alice MFA does not affect bob', async () => {
    const a = await startEnrollment(dir, 'alice2');
    await confirmEnrollment(dir, 'alice2', totpAt(a.secret, Date.now()));
    const bobStatus = await getStatus(dir, 'bob2');
    expect(bobStatus.enrolled).toBe(false);
  });
});

describe('recovery code primitives', () => {
  it('generates 10 distinct codes that consume in a record', () => {
    const { plain, hashes } = generateRecoveryCodes();
    expect(new Set(plain).size).toBe(10);
    expect(hashes).toHaveLength(10);
    const rec = {
      userId: 'x', secret: 'AAAA', confirmedAt: Date.now(), createdAt: Date.now(),
      recoveryHashes: [...hashes], stepUpTtlSec: 900,
    };
    expect(consumeRecoveryCode(rec, plain[3]!)).toBe(true);
    expect(rec.recoveryHashes).toHaveLength(9);
    expect(consumeRecoveryCode(rec, plain[3]!)).toBe(false);
  });
});
