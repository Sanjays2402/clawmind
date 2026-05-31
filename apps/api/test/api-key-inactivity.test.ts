import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setPolicy,
  classifyKey,
  findAtRiskKeys,
  sweep,
  invalidateCache,
  ApiKeyInactivityValidationError,
  MAX_IDLE_DAYS,
} from '../src/services/api-key-inactivity.js';
import { issueKey, loadKeys } from '../src/services/api-keys.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-inactivity-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60_000;

describe('api-key-inactivity service', () => {
  it('defaults to disabled on a fresh deployment', async () => {
    const p = await getPolicy(dir);
    expect(p.idleDays).toBe(0);
    expect(p.warnDays).toBe(0);
    expect(p.lastSweepAt).toBeNull();
    expect(p.updatedBy).toBeNull();
  });

  it('rejects warnDays > idleDays and warnDays without idleDays', async () => {
    await expect(setPolicy(dir, 'u', { idleDays: 5, warnDays: 10 })).rejects.toBeInstanceOf(
      ApiKeyInactivityValidationError,
    );
    invalidateCache();
    await expect(setPolicy(dir, 'u', { idleDays: 0, warnDays: 3 })).rejects.toBeInstanceOf(
      ApiKeyInactivityValidationError,
    );
  });

  it('rejects out-of-range values', async () => {
    await expect(
      setPolicy(dir, 'u', { idleDays: MAX_IDLE_DAYS + 1 }),
    ).rejects.toBeInstanceOf(ApiKeyInactivityValidationError);
  });

  it('classifyKey reports fresh / warn / expired against the threshold', async () => {
    const policy = await setPolicy(dir, 'admin', { idleDays: 30, warnDays: 7 });
    const now = Date.now();
    const mk = (lastUsedAt: number | null, createdAt: number) => ({
      id: 'k', userId: 'u', label: 'l', role: 'reader' as const,
      hash: 'h', createdAt, expiresAt: null, lastUsedAt, revokedAt: null,
    });
    expect(classifyKey(policy, mk(now - 2 * DAY, now - 60 * DAY), now).status).toBe('fresh');
    expect(classifyKey(policy, mk(now - 27 * DAY, now - 60 * DAY), now).status).toBe('warn');
    expect(classifyKey(policy, mk(now - 31 * DAY, now - 60 * DAY), now).status).toBe('expired');
    // never-used key falls back to createdAt
    expect(classifyKey(policy, mk(null, now - 31 * DAY), now).status).toBe('expired');
    // revoked keys are 'off' regardless of age
    expect(
      classifyKey(policy, { ...mk(now - 90 * DAY, now - 90 * DAY), revokedAt: now }, now)
        .status,
    ).toBe('off');
  });

  it('sweep revokes only expired keys and updates lastSweepAt; dryRun is a no-op', async () => {
    await setPolicy(dir, 'admin', { idleDays: 30 });

    const old = await issueKey(dir, { userId: 'u1', label: 'old', role: 'reader' });
    const fresh = await issueKey(dir, { userId: 'u1', label: 'fresh', role: 'reader' });
    const otherUser = await issueKey(dir, { userId: 'u2', label: 'other', role: 'reader' });

    // Backdate the old key past the threshold by overwriting the file.
    const { readFile, writeFile } = await import('node:fs/promises');
    const keysPath = join(dir, 'api-keys.json');
    const raw = JSON.parse(await readFile(keysPath, 'utf8')) as Array<any>;
    const past = Date.now() - 40 * DAY;
    for (const k of raw) {
      if (k.id === old.record.id || k.id === otherUser.record.id) {
        k.createdAt = past;
        k.lastUsedAt = past;
      }
    }
    await writeFile(keysPath, JSON.stringify(raw, null, 2));

    // Dry-run reports the same set, leaves disk untouched.
    const preview = await sweep(dir, () => loadKeys(dir), { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(new Set(preview.revokedIds)).toEqual(
      new Set([old.record.id, otherUser.record.id]),
    );
    let after = await loadKeys(dir);
    expect(after.find((k) => k.id === old.record.id)?.revokedAt).toBeFalsy();

    // Real sweep revokes both stale keys across users, leaves fresh alone.
    const result = await sweep(dir, () => loadKeys(dir));
    expect(result.dryRun).toBe(false);
    expect(new Set(result.revokedIds)).toEqual(
      new Set([old.record.id, otherUser.record.id]),
    );
    after = await loadKeys(dir);
    expect(after.find((k) => k.id === old.record.id)?.revokedAt).toBeTruthy();
    expect(after.find((k) => k.id === otherUser.record.id)?.revokedAt).toBeTruthy();
    expect(after.find((k) => k.id === fresh.record.id)?.revokedAt).toBeFalsy();

    const p = await getPolicy(dir);
    expect(p.lastSweepAt).toBeGreaterThan(0);
    expect(p.lastSweepCount).toBe(2);
  });

  it('findAtRiskKeys returns warn+expired sorted by age desc', async () => {
    const policy = await setPolicy(dir, 'admin', { idleDays: 30, warnDays: 7 });
    const now = Date.now();
    const keys = [
      { id: 'a', userId: 'u', label: 'a', role: 'reader' as const, hash: 'h', createdAt: now, expiresAt: null, lastUsedAt: now - 1 * DAY, revokedAt: null },
      { id: 'b', userId: 'u', label: 'b', role: 'reader' as const, hash: 'h', createdAt: now, expiresAt: null, lastUsedAt: now - 25 * DAY, revokedAt: null },
      { id: 'c', userId: 'u', label: 'c', role: 'reader' as const, hash: 'h', createdAt: now, expiresAt: null, lastUsedAt: now - 90 * DAY, revokedAt: null },
    ];
    const out = findAtRiskKeys(policy, keys, now);
    expect(out.map((k) => k.id)).toEqual(['c', 'b']);
    expect(out[0]!.status).toBe('expired');
    expect(out[1]!.status).toBe('warn');
  });
});
