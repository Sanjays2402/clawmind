import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueKey, listKeys, revokeKey, verifySecret, loadKeys, hashSecret, redact, KEY_PREFIX,
} from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-keys-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-keys service', () => {
  it('issues a key with prefix and persists only the hash', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    expect(issued.secret.startsWith(KEY_PREFIX)).toBe(true);
    const all = await loadKeys(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.hash).toBe(hashSecret(issued.secret));
    expect(all[0]).not.toHaveProperty('secret');
  });

  it('lists only keys for the requesting user', async () => {
    await issueKey(dir, { userId: 'u1', label: 'a' });
    await issueKey(dir, { userId: 'u2', label: 'b' });
    const u1 = await listKeys(dir, 'u1');
    expect(u1.map((k) => k.label)).toEqual(['a']);
  });

  it('verifies a valid secret and bumps lastUsedAt', async () => {
    const { record, secret } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    expect(record.lastUsedAt).toBeNull();
    const v = await verifySecret(dir, secret);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.record.id).toBe(record.id);
    // Tiny pause to let the fire-and-forget save flush.
    await new Promise((r) => setTimeout(r, 20));
    const all = await loadKeys(dir);
    expect(all[0]!.lastUsedAt).toBeGreaterThan(0);
  });

  it('rejects malformed input', async () => {
    expect(await verifySecret(dir, '')).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifySecret(dir, 'nope')).toEqual({ ok: false, reason: 'malformed' });
    expect(await verifySecret(dir, 'cm_short')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects unknown but well-formed secrets', async () => {
    const fake = KEY_PREFIX + 'a'.repeat(64);
    expect(await verifySecret(dir, fake)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('revoke marks the record and blocks future verification', async () => {
    const { record, secret } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const ok = await revokeKey(dir, 'u1', record.id);
    expect(ok).toBe(true);
    const v = await verifySecret(dir, secret);
    expect(v).toEqual({ ok: false, reason: 'revoked' });
  });

  it('revoke fails for keys not owned by the user', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    expect(await revokeKey(dir, 'u2', record.id)).toBe(false);
  });

  it('expired keys are rejected and not auto-bumped', async () => {
    const now = 1_000;
    const { secret } = await issueKey(dir, { userId: 'u1', label: 't', ttlMs: 100, now });
    const v = await verifySecret(dir, secret, now + 500);
    expect(v).toEqual({ ok: false, reason: 'expired' });
  });

  it('redact strips hash from API responses', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const r = redact(record);
    expect(r).not.toHaveProperty('hash');
    expect(r.id).toBe(record.id);
  });
});
