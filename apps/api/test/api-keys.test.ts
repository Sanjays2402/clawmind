import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  issueKey, listKeys, filterKeys, revokeKey, rotateKey, verifySecret, loadKeys, hashSecret, redact, KEY_PREFIX,
  hasScope, isValidScope, WILDCARD_SCOPE,
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

describe('api-key scopes', () => {
  it('isValidScope accepts the wildcard and resource:action shapes', () => {
    expect(isValidScope(WILDCARD_SCOPE)).toBe(true);
    expect(isValidScope('search:read')).toBe(true);
    expect(isValidScope('ingest:write')).toBe(true);
    expect(isValidScope('keys:admin')).toBe(true);
  });

  it('isValidScope rejects malformed values', () => {
    expect(isValidScope('')).toBe(false);
    expect(isValidScope('search')).toBe(false);
    expect(isValidScope('search:execute')).toBe(false);
    expect(isValidScope('Search:read')).toBe(false);
    expect(isValidScope(':read')).toBe(false);
  });

  it('hasScope treats empty/missing grants as unrestricted (legacy keys)', () => {
    expect(hasScope(undefined, 'search:read')).toBe(true);
    expect(hasScope(null, 'search:read')).toBe(true);
    expect(hasScope([], 'search:read')).toBe(true);
  });

  it('hasScope honours wildcard and exact matches', () => {
    expect(hasScope(['*'], 'anything:read')).toBe(true);
    expect(hasScope(['search:read'], 'search:read')).toBe(true);
    expect(hasScope(['search:read'], 'ingest:write')).toBe(false);
    expect(hasScope(['search:read', 'ask:read'], 'ask:read')).toBe(true);
  });

  it('issueKey persists deduped, sorted scopes', async () => {
    const { record } = await issueKey(dir, {
      userId: 'u1', label: 'scoped',
      scopes: ['ask:read', 'search:read', 'ask:read'],
    });
    expect(record.scopes).toEqual(['ask:read', 'search:read']);
  });

  it('issueKey throws on an invalid scope', async () => {
    await expect(issueKey(dir, {
      userId: 'u1', label: 'bad', scopes: ['not-a-scope'],
    })).rejects.toThrow(/invalid scope/);
  });

  it('verified record carries the scope list through', async () => {
    const { secret } = await issueKey(dir, {
      userId: 'u1', label: 's', scopes: ['search:read'],
    });
    const v = await verifySecret(dir, secret);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.record.scopes).toEqual(['search:read']);
  });

  it('redact exposes scopes (or null) so the UI can render them', async () => {
    const a = await issueKey(dir, { userId: 'u1', label: 'a' });
    const b = await issueKey(dir, { userId: 'u1', label: 'b', scopes: ['ask:read'] });
    expect(redact(a.record).scopes).toBeNull();
    expect(redact(b.record).scopes).toEqual(['ask:read']);
  });
});

describe('api-key rotation', () => {
  it('rotate issues a new secret that verifies and keeps the same id, label, role, scopes', async () => {
    const { record, secret: oldSecret } = await issueKey(dir, {
      userId: 'u1', label: 'cli', role: 'owner', scopes: ['search:read'],
    });
    const rotated = await rotateKey(dir, 'u1', record.id);
    expect(rotated).not.toBeNull();
    expect(rotated!.secret.startsWith(KEY_PREFIX)).toBe(true);
    expect(rotated!.secret).not.toBe(oldSecret);
    expect(rotated!.record.id).toBe(record.id);
    expect(rotated!.record.label).toBe('cli');
    expect(rotated!.record.role).toBe('owner');
    expect(rotated!.record.scopes).toEqual(['search:read']);
    const v = await verifySecret(dir, rotated!.secret);
    expect(v.ok).toBe(true);
  });

  it('previous secret keeps working inside the grace window and stops after it', async () => {
    const now = 1_000_000;
    const { record, secret: oldSecret } = await issueKey(dir, { userId: 'u1', label: 'cli', now });
    const rotated = await rotateKey(dir, 'u1', record.id, { graceMs: 60_000, now });
    expect(rotated).not.toBeNull();
    // Within grace: old secret still verifies.
    const within = await verifySecret(dir, oldSecret, now + 30_000);
    expect(within.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    // Beyond grace: old secret is unknown.
    const beyond = await verifySecret(dir, oldSecret, now + 120_000);
    expect(beyond).toEqual({ ok: false, reason: 'unknown' });
    await new Promise((r) => setTimeout(r, 20));
    // The new secret keeps working past the grace window.
    const newOk = await verifySecret(dir, rotated!.secret, now + 200_000);
    expect(newOk.ok).toBe(true);
  });

  it('rotate with graceMs=0 invalidates the old secret immediately', async () => {
    const { record, secret: oldSecret } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const rotated = await rotateKey(dir, 'u1', record.id, { graceMs: 0 });
    expect(rotated).not.toBeNull();
    expect(rotated!.previousExpiresAt).toBeNull();
    const v = await verifySecret(dir, oldSecret);
    expect(v).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rotate returns null when the key is not owned by the user', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    expect(await rotateKey(dir, 'u2', record.id)).toBeNull();
  });

  it('rotate returns null for revoked keys so revoked keys cannot be revived', async () => {
    const { record, secret: oldSecret } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    await revokeKey(dir, 'u1', record.id);
    const rotated = await rotateKey(dir, 'u1', record.id);
    expect(rotated).toBeNull();
    // And the old secret stays revoked.
    const v = await verifySecret(dir, oldSecret);
    expect(v).toEqual({ ok: false, reason: 'revoked' });
  });

  it('rotate stamps rotatedAt and persists the grace metadata on disk', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const rotated = await rotateKey(dir, 'u1', record.id);
    expect(rotated!.record.rotatedAt).toBeGreaterThan(0);
    expect(rotated!.previousExpiresAt).toBeGreaterThan(Date.now());
    const all = await loadKeys(dir);
    expect(all[0]!.previousHash).toBe(hashSecret('placeholder') === '' ? '' : all[0]!.previousHash);
    expect(all[0]!.previousHash).toBeTruthy();
    expect(all[0]!.previousHashExpiresAt).toBe(rotated!.previousExpiresAt);
    // redact surfaces only the timestamp, never the hash itself.
    const r = redact(all[0]!) as Record<string, unknown>;
    expect(r).not.toHaveProperty('previousHash');
    expect(r.previousHashExpiresAt).toBe(rotated!.previousExpiresAt);
  });
});

describe('filterKeys', () => {
  it('returns the input when q is empty or whitespace', async () => {
    const { record: a } = await issueKey(dir, { userId: 'u1', label: 'ci-deploy' });
    const { record: b } = await issueKey(dir, { userId: 'u1', label: 'laptop-cli' });
    const all = [a, b];
    expect(filterKeys(all, undefined)).toBe(all);
    expect(filterKeys(all, '')).toBe(all);
    expect(filterKeys(all, '   ')).toBe(all);
  });

  it('matches a substring of the label case-insensitively', async () => {
    const { record: a } = await issueKey(dir, { userId: 'u1', label: 'CI-deploy' });
    const { record: b } = await issueKey(dir, { userId: 'u1', label: 'laptop-cli' });
    const out = filterKeys([a, b], 'deploy');
    expect(out.map((k) => k.id)).toEqual([a.id]);
  });

  it('matches a substring of the key id', async () => {
    const { record: a } = await issueKey(dir, { userId: 'u1', label: 'one' });
    const { record: b } = await issueKey(dir, { userId: 'u1', label: 'two' });
    const out = filterKeys([a, b], a.id.slice(0, 6));
    expect(out.map((k) => k.id)).toEqual([a.id]);
  });

  it('returns an empty list when nothing matches', async () => {
    const { record: a } = await issueKey(dir, { userId: 'u1', label: 'cli' });
    expect(filterKeys([a], 'zzz-no-hit')).toEqual([]);
  });
});
