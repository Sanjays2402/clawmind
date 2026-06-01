import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueCertificate,
  listCertificates,
  getCertificate,
  findByDsr,
  verifySignature,
  subjectEmailMatches,
  publicView,
  revokeCertificate,
  canonicalPayload,
  CertificateValidationError,
  FILE,
} from '../src/services/erasure-certificates.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-erc-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const baseInput = {
  dsrId: 'dsr_abc123',
  workspaceId: 'ws_acme',
  subjectEmail: 'Alice@Example.COM',
  scope: 'all corpus chunks attributable to the subject plus the associated history rows',
  fulfilledBy: 'user_admin',
  fulfilledAt: 1_700_000_000_000,
};

describe('erasure certificate issuance', () => {
  it('mints a signed receipt with a stable content fingerprint', async () => {
    const cert = await issueCertificate(dir, baseInput);
    expect(cert.id).toMatch(/^erc_/);
    expect(cert.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.contentFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.algo).toBe('hmac-sha256');
    // PII protection: the plaintext email never lands on disk.
    expect(cert.subjectEmailFingerprint).toMatch(/^[0-9a-f]{64}$/);
    const onDisk = readFileSync(join(dir, FILE), 'utf8');
    expect(onDisk.toLowerCase()).not.toContain('alice@example.com');
  });

  it('is idempotent per DSR id (re-issue returns the existing row)', async () => {
    const first = await issueCertificate(dir, baseInput);
    const again = await issueCertificate(dir, { ...baseInput, fulfilledBy: 'someone_else' });
    expect(again.id).toBe(first.id);
    expect(again.fulfilledBy).toBe('user_admin');
    const all = await listCertificates(dir);
    expect(all).toHaveLength(1);
  });

  it('rejects invalid inputs', async () => {
    await expect(
      issueCertificate(dir, { ...baseInput, subjectEmail: 'not-an-email' }),
    ).rejects.toThrow(CertificateValidationError);
    await expect(
      issueCertificate(dir, { ...baseInput, workspaceId: '' }),
    ).rejects.toThrow(CertificateValidationError);
    await expect(
      issueCertificate(dir, { ...baseInput, dsrId: '' }),
    ).rejects.toThrow(CertificateValidationError);
    await expect(
      issueCertificate(dir, { ...baseInput, dsrId: 'dsr_other', scope: 'x'.repeat(5000) }),
    ).rejects.toThrow(CertificateValidationError);
  });
});

describe('erasure certificate verification', () => {
  it('verifies an untouched certificate', async () => {
    const cert = await issueCertificate(dir, baseInput);
    await expect(verifySignature(dir, cert)).resolves.toBe(true);
  });

  it('detects tampering of any signed field', async () => {
    const cert = await issueCertificate(dir, baseInput);
    const tampered = { ...cert, scope: cert.scope + ' (modified)' };
    await expect(verifySignature(dir, tampered)).resolves.toBe(false);
  });

  it('detects tampering of the signature itself', async () => {
    const cert = await issueCertificate(dir, baseInput);
    const flipped =
      cert.signature.slice(0, -1) + (cert.signature.endsWith('a') ? 'b' : 'a');
    await expect(verifySignature(dir, { ...cert, signature: flipped })).resolves.toBe(false);
  });

  it('subjectEmailMatches is constant-time over the lowercase normalisation', () => {
    return issueCertificate(dir, baseInput).then((cert) => {
      expect(subjectEmailMatches(cert, 'alice@example.com')).toBe(true);
      expect(subjectEmailMatches(cert, 'ALICE@example.COM')).toBe(true);
      expect(subjectEmailMatches(cert, 'mallory@example.com')).toBe(false);
    });
  });

  it('public projection never carries the subject email', async () => {
    const cert = await issueCertificate(dir, baseInput);
    const pub = publicView(cert);
    const serialised = JSON.stringify(pub).toLowerCase();
    expect(serialised).not.toContain('alice@example.com');
    expect(pub.subjectEmailFingerprint).toBe(cert.subjectEmailFingerprint);
  });

  it('canonical payload is field-order stable', () => {
    const a = canonicalPayload({
      id: 'a', dsrId: 'd', workspaceId: 'w', subjectEmailFingerprint: 'f',
      scope: 's', fulfilledBy: 'u', fulfilledAt: 1, issuedAt: 2,
    });
    const b = canonicalPayload({
      issuedAt: 2, fulfilledAt: 1, fulfilledBy: 'u', scope: 's',
      subjectEmailFingerprint: 'f', workspaceId: 'w', dsrId: 'd', id: 'a',
    });
    expect(a).toBe(b);
  });
});

describe('erasure certificate revocation and lookup', () => {
  it('lookup by DSR id and certificate id agree', async () => {
    const cert = await issueCertificate(dir, baseInput);
    const byId = await getCertificate(dir, cert.id);
    const byDsr = await findByDsr(dir, baseInput.dsrId);
    expect(byId?.id).toBe(cert.id);
    expect(byDsr?.id).toBe(cert.id);
    expect(await findByDsr(dir, 'dsr_nope')).toBeNull();
  });

  it('revocation preserves the signed payload (append-only)', async () => {
    const cert = await issueCertificate(dir, baseInput);
    const before = { signature: cert.signature, contentFingerprint: cert.contentFingerprint };
    const revoked = await revokeCertificate(dir, cert.id, 'user_admin', 'rescinded by court order');
    expect(revoked?.revokedAt).toBeGreaterThan(0);
    expect(revoked?.signature).toBe(before.signature);
    expect(revoked?.contentFingerprint).toBe(before.contentFingerprint);
    await expect(verifySignature(dir, revoked!)).resolves.toBe(true);
  });

  it('rejects empty revocation reason', async () => {
    const cert = await issueCertificate(dir, baseInput);
    await expect(revokeCertificate(dir, cert.id, 'u', '   ')).rejects.toThrow(
      CertificateValidationError,
    );
  });

  it('verifySignature is robust against a swapped certificate file', async () => {
    const cert = await issueCertificate(dir, baseInput);
    // Attacker swaps one field after issuance directly on disk.
    const raw = JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as {
      certificates: Array<{ scope: string }>;
    };
    raw.certificates[0].scope = 'NOTHING WAS DELETED, ACTUALLY';
    writeFileSync(join(dir, FILE), JSON.stringify(raw));
    const reread = await getCertificate(dir, cert.id);
    expect(reread).not.toBeNull();
    await expect(verifySignature(dir, reread!)).resolves.toBe(false);
  });
});
