import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  getStatus,
  uploadCustomerKek,
  removeCustomerKek,
  rotateDek,
  encryptPayload,
  decryptEnvelope,
  EncryptionValidationError,
  EncryptionStateError,
  ENCRYPTION_SCHEMA,
} from '../src/services/encryption.js';

function freshKek(): string {
  return randomBytes(32).toString('base64');
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-enc-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('encryption service (CMEK/BYOK)', () => {
  it('initialises with an internal KEK and a usable active DEK', async () => {
    const s = await getStatus(dir, 'owner-1');
    expect(s.schema).toBe(ENCRYPTION_SCHEMA);
    expect(s.kekKind).toBe('internal');
    expect(s.kekFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(s.kekFingerprintShort).toHaveLength(16);
    expect(s.activeKeyId).toMatch(/^dek_/);
    expect(s.archivedKeyCount).toBe(0);
    expect(s.version).toBe(1);

    // Round-trip works under the default (internal) KEK without
    // requiring the caller to know any key material.
    const env = await encryptPayload(dir, Buffer.from('hello procurement'));
    const plain = await decryptEnvelope(dir, env);
    expect(plain.toString('utf8')).toBe('hello procurement');
  });

  it('rotation archives prior DEK and keeps old ciphertext decryptable', async () => {
    const env1 = await encryptPayload(dir, Buffer.from('one'));
    const before = await getStatus(dir);
    const after = await rotateDek(dir, 'owner-1');
    expect(after.activeKeyId).not.toBe(before.activeKeyId);
    expect(after.archivedKeyCount).toBe(1);
    expect(after.version).toBe(before.version + 1);

    const env2 = await encryptPayload(dir, Buffer.from('two'));
    expect(env2.keyId).toBe(after.activeKeyId);
    expect(env1.keyId).not.toBe(env2.keyId);
    // Old envelope still decrypts via the archived key.
    expect((await decryptEnvelope(dir, env1)).toString('utf8')).toBe('one');
    expect((await decryptEnvelope(dir, env2)).toString('utf8')).toBe('two');
  });

  it('upload + remove customer KEK rewraps DEKs and gates on the supplied key', async () => {
    const env1 = await encryptPayload(dir, Buffer.from('pre-byok'));
    const kek = freshKek();
    const up = await uploadCustomerKek(dir, 'owner-1', kek);
    expect(up.kekKind).toBe('customer');
    expect(up.kekFingerprintShort).toHaveLength(16);

    // Without the customer KEK, encrypt/decrypt must refuse.
    await expect(encryptPayload(dir, Buffer.from('x'))).rejects.toBeInstanceOf(EncryptionValidationError);
    await expect(decryptEnvelope(dir, env1)).rejects.toBeInstanceOf(EncryptionValidationError);

    // With the right KEK, prior ciphertext still decrypts and new
    // writes round-trip cleanly under the customer-managed envelope.
    expect((await decryptEnvelope(dir, env1, kek)).toString('utf8')).toBe('pre-byok');
    const env2 = await encryptPayload(dir, Buffer.from('post-byok'), kek);
    expect((await decryptEnvelope(dir, env2, kek)).toString('utf8')).toBe('post-byok');

    // A second upload while a customer KEK is in force is rejected.
    await expect(uploadCustomerKek(dir, 'owner-1', freshKek())).rejects.toBeInstanceOf(EncryptionStateError);

    // Removing with the wrong KEK is rejected.
    await expect(removeCustomerKek(dir, 'owner-1', freshKek())).rejects.toBeInstanceOf(EncryptionValidationError);

    // Removing with the right KEK rewraps back to internal and prior
    // envelopes once again decrypt without supplying any key material.
    const back = await removeCustomerKek(dir, 'owner-1', kek);
    expect(back.kekKind).toBe('internal');
    expect((await decryptEnvelope(dir, env1)).toString('utf8')).toBe('pre-byok');
    expect((await decryptEnvelope(dir, env2)).toString('utf8')).toBe('post-byok');
  });

  it('rejects malformed customer KEK input', async () => {
    await expect(uploadCustomerKek(dir, 'owner-1', 'not-base64-and-too-short')).rejects.toBeInstanceOf(
      EncryptionValidationError,
    );
    await expect(uploadCustomerKek(dir, 'owner-1', Buffer.alloc(16).toString('base64'))).rejects.toBeInstanceOf(
      EncryptionValidationError,
    );
  });

  it('rotation under customer KEK requires the active KEK', async () => {
    const kek = freshKek();
    await uploadCustomerKek(dir, 'owner-1', kek);
    await expect(rotateDek(dir, 'owner-1')).rejects.toBeInstanceOf(EncryptionValidationError);
    await expect(rotateDek(dir, 'owner-1', freshKek())).rejects.toBeInstanceOf(EncryptionValidationError);
    const rotated = await rotateDek(dir, 'owner-1', kek);
    expect(rotated.kekKind).toBe('customer');
    expect(rotated.archivedKeyCount).toBe(1);
  });
});
