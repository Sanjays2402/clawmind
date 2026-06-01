import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setPolicy,
  classifyKey,
  findUpcomingKeys,
  invalidateCache,
  getPolicyCached,
  ApiKeyExpiryValidationError,
  MAX_WARN_DAYS,
} from '../src/services/api-key-expiry.js';
import { issueKey, loadKeys, touchExpiryWarning } from '../src/services/api-keys.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-expiry-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60_000;

describe('api-key-expiry service', () => {
  it('defaults to a 14 day warning window with no recorded actor', async () => {
    const p = await getPolicy(dir);
    expect(p.warnDays).toBe(14);
    expect(p.updatedBy).toBeNull();
  });

  it('setPolicy records actor and rejects out-of-range values', async () => {
    const p = await setPolicy(dir, 'owner-1', { warnDays: 30 });
    expect(p.warnDays).toBe(30);
    expect(p.updatedBy).toBe('owner-1');
    await expect(
      setPolicy(dir, 'owner-1', { warnDays: MAX_WARN_DAYS + 1 }),
    ).rejects.toBeInstanceOf(ApiKeyExpiryValidationError);
    await expect(
      setPolicy(dir, 'owner-1', { warnDays: -1 }),
    ).rejects.toBeInstanceOf(ApiKeyExpiryValidationError);
  });

  it('cache returns the latest policy after setPolicy invalidates it', async () => {
    await setPolicy(dir, 'a', { warnDays: 7 });
    expect((await getPolicyCached(dir)).warnDays).toBe(7);
    await setPolicy(dir, 'a', { warnDays: 21 });
    expect((await getPolicyCached(dir)).warnDays).toBe(21);
  });

  it('classifyKey returns off / ok / expiring against the warning window', async () => {
    const policy = await setPolicy(dir, 'a', { warnDays: 7 });
    const now = Date.now();
    const mk = (expiresAt: number | null, revokedAt: number | null = null) => ({
      expiresAt,
      revokedAt,
    });
    expect(classifyKey(policy, mk(null), now).status).toBe('off');
    expect(classifyKey(policy, mk(now - DAY), now).status).toBe('off');
    expect(classifyKey(policy, mk(now + 30 * DAY), now).status).toBe('ok');
    const inside = classifyKey(policy, mk(now + 3 * DAY), now);
    expect(inside.status).toBe('expiring');
    expect(inside.daysRemaining).toBe(3);
    expect(classifyKey(policy, mk(now + DAY, now), now).status).toBe('off');
    // warnDays === 0 disables warnings entirely.
    const disabled = await setPolicy(dir, 'a', { warnDays: 0 });
    expect(classifyKey(disabled, mk(now + DAY), now).status).toBe('off');
  });

  it('findUpcomingKeys ignores revoked, never-expiring, and outside-window keys, sorted by soonest', async () => {
    const policy = await setPolicy(dir, 'a', { warnDays: 14 });
    const now = Date.now();
    const k1 = await issueKey(dir, { userId: 'u1', label: 'soon', role: 'reader', ttlMs: 2 * DAY });
    const k2 = await issueKey(dir, { userId: 'u1', label: 'later', role: 'reader', ttlMs: 10 * DAY });
    await issueKey(dir, { userId: 'u1', label: 'far', role: 'reader', ttlMs: 60 * DAY });
    await issueKey(dir, { userId: 'u1', label: 'never', role: 'reader' });

    const keys = await loadKeys(dir);
    const list = findUpcomingKeys(policy, keys, now);
    expect(list.map((k) => k.label)).toEqual(['soon', 'later']);
    expect(list[0]!.id).toBe(k1.record.id);
    expect(list[1]!.id).toBe(k2.record.id);
    expect(list[0]!.daysRemaining).toBeLessThanOrEqual(2);
  });

  it('touchExpiryWarning dedupes per (key, expiresAt) so the audit fires once per crossing', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'k', role: 'reader', ttlMs: 5 * DAY });
    const expiresAt = record.expiresAt!;
    expect(await touchExpiryWarning(dir, record.id, expiresAt)).toBe(true);
    expect(await touchExpiryWarning(dir, record.id, expiresAt)).toBe(false);
    // Simulate a rotation extending the TTL: the new expiresAt resets the anchor.
    expect(await touchExpiryWarning(dir, record.id, expiresAt + 30 * DAY)).toBe(true);
    expect(await touchExpiryWarning(dir, record.id, expiresAt + 30 * DAY)).toBe(false);
    // Unknown key id is a no-op.
    expect(await touchExpiryWarning(dir, 'nope', expiresAt)).toBe(false);
  });
});
