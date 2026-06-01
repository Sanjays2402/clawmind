import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import {
  getJwks,
  getPublicMaterial,
  signPayload,
  verifyPayload,
  __resetCacheForTests,
} from '../src/services/signing-keys.js';
import {
  signAttestation,
  updateSettings,
  verifyAttestationSignature,
  canonicalAttestation,
  getDocument,
} from '../src/services/warrant-canary.js';

let dir: string;
beforeEach(() => {
  __resetCacheForTests();
  dir = mkdtempSync(join(tmpdir(), 'cm-signing-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('signing-keys service', () => {
  it('persists a stable kid across reloads', async () => {
    const first = await getPublicMaterial(dir);
    __resetCacheForTests();
    const second = await getPublicMaterial(dir);
    expect(first.kid).toEqual(second.kid);
    expect(first.x).toEqual(second.x);
    expect(first.publicPem).toEqual(second.publicPem);
  });

  it('JWKS exposes exactly one Ed25519 key with stable shape', async () => {
    const jwks = await getJwks(dir);
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0]!;
    expect(key.kty).toBe('OKP');
    expect(key.crv).toBe('Ed25519');
    expect(key.alg).toBe('EdDSA');
    expect(key.use).toBe('sig');
    expect(typeof key.kid).toBe('string');
    expect(key.kid!.length).toBeGreaterThan(0);
    expect(typeof key.x).toBe('string');
  });

  it('signPayload round-trips through verifyPayload', async () => {
    const signed = await signPayload(dir, 'hello world');
    const ok = await verifyPayload(dir, 'hello world', signed);
    expect(ok).toBe(true);
    const tampered = await verifyPayload(dir, 'hello WORLD', signed);
    expect(tampered).toBe(false);
  });

  it('rejects verification when kid does not match', async () => {
    const signed = await signPayload(dir, 'payload');
    const ok = await verifyPayload(dir, 'payload', { signature: signed.signature, kid: 'not-our-kid' });
    expect(ok).toBe(false);
  });

  it('produced signature verifies against the published PEM with stock crypto', async () => {
    // This is the procurement-relevant invariant: an external party
    // can take the public PEM from /.well-known/clawmind-signing.pem,
    // load it with createPublicKey (or openssl), and verify our
    // signatures without trusting any of our code.
    const mat = await getPublicMaterial(dir);
    const signed = await signPayload(dir, 'external-verify');
    const pub = createPublicKey(mat.publicPem);
    const ok = cryptoVerify(
      null,
      Buffer.from('external-verify', 'utf8'),
      pub,
      Buffer.from(signed.signature, 'base64url'),
    );
    expect(ok).toBe(true);
  });
});

describe('warrant-canary signing integration', () => {
  it('attaches a verifiable Ed25519 proof to every new attestation', async () => {
    await updateSettings(dir, 'owner@example.com', { enabled: true });
    const { record } = await signAttestation(dir, 'owner@example.com', {
      statement: 'No secret legal process received in the last 30 days.',
    });
    expect(record.proof).not.toBeNull();
    expect(record.proof!.alg).toBe('EdDSA');
    expect(record.proof!.signature.length).toBeGreaterThan(0);

    const verdict = await verifyAttestationSignature(dir, record);
    expect(verdict.valid).toBe(true);
    expect(verdict.reason).toBeNull();
  });

  it('detects tampered statement via signature failure', async () => {
    await updateSettings(dir, 'owner@example.com', { enabled: true });
    const { record } = await signAttestation(dir, 'owner@example.com', {
      statement: 'Original statement.',
    });
    const tampered = { ...record, statement: 'Silently edited statement.' };
    const verdict = await verifyAttestationSignature(dir, tampered);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/signature/);
  });

  it('persists the proof across reload and survives canonicalisation round-trip', async () => {
    await updateSettings(dir, 'owner@example.com', { enabled: true });
    const { record } = await signAttestation(dir, 'owner@example.com', {
      statement: 'Round trip.',
    });
    __resetCacheForTests();
    const reloaded = await getDocument(dir);
    const found = reloaded.history.find((r) => r.id === record.id);
    expect(found).toBeDefined();
    expect(found!.proof).not.toBeNull();
    // Canonical bytes are computed only over the signed fields.
    expect(canonicalAttestation(found!)).toEqual(canonicalAttestation(record));
    const verdict = await verifyAttestationSignature(dir, found!);
    expect(verdict.valid).toBe(true);
  });

  it('flags pre-signing legacy records as unsigned without crashing', async () => {
    await updateSettings(dir, 'owner@example.com', { enabled: true });
    const { record } = await signAttestation(dir, 'owner@example.com', {
      statement: 'Will be stripped to simulate legacy.',
    });
    const legacy = { ...record, proof: null } as typeof record;
    const verdict = await verifyAttestationSignature(dir, legacy);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/unsigned/);
  });
});
