import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setPolicy,
  evaluateIssue,
  needsRotation,
  invalidateCache,
  ApiKeyPolicyValidationError,
  MAX_TTL_MIN,
  MAX_KEYS_PER_USER,
  MAX_FORCED_ROTATION_DAYS,
} from '../src/services/api-key-policy.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-api-key-policy-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key-policy service', () => {
  it('defaults to fully permissive on a fresh deployment', async () => {
    const p = await getPolicy(dir);
    expect(p.maxTtlMinutes).toBe(0);
    expect(p.requireExpiry).toBe(false);
    expect(p.maxActiveKeysPerUser).toBe(0);
    expect(p.maxScopesPerKey).toBe(0);
    expect(p.allowWildcardScope).toBe(true);
    expect(p.forcedRotationDays).toBe(0);
    expect(p.updatedBy).toBeNull();
  });

  it('setPolicy records actor and rejects out-of-range values', async () => {
    const p = await setPolicy(dir, 'owner-1', {
      maxTtlMinutes: 60,
      requireExpiry: true,
      maxActiveKeysPerUser: 5,
      maxScopesPerKey: 8,
      allowWildcardScope: false,
      forcedRotationDays: 90,
    });
    expect(p.updatedBy).toBe('owner-1');
    expect(p.maxTtlMinutes).toBe(60);
    expect(p.requireExpiry).toBe(true);

    await expect(
      setPolicy(dir, 'owner-1', { maxTtlMinutes: MAX_TTL_MIN + 1 }),
    ).rejects.toBeInstanceOf(ApiKeyPolicyValidationError);
    await expect(
      setPolicy(dir, 'owner-1', { maxActiveKeysPerUser: MAX_KEYS_PER_USER + 1 }),
    ).rejects.toBeInstanceOf(ApiKeyPolicyValidationError);
    await expect(
      setPolicy(dir, 'owner-1', { forcedRotationDays: MAX_FORCED_ROTATION_DAYS + 1 }),
    ).rejects.toBeInstanceOf(ApiKeyPolicyValidationError);
  });

  it('requireExpiry without a non-zero maxTtlMinutes is rejected', async () => {
    await expect(
      setPolicy(dir, 'owner-1', { requireExpiry: true, maxTtlMinutes: 0 }),
    ).rejects.toBeInstanceOf(ApiKeyPolicyValidationError);
  });
});

describe('evaluateIssue', () => {
  const base = {
    workspaceId: 'default',
    maxTtlMinutes: 0,
    requireExpiry: false,
    maxActiveKeysPerUser: 0,
    maxScopesPerKey: 0,
    allowWildcardScope: true,
    forcedRotationDays: 0,
    updatedAt: 0,
    updatedBy: null,
  };

  it('passes when policy is fully permissive', () => {
    const r = evaluateIssue(base, { ttlMs: null, scopes: ['*'], activeKeyCount: 100 });
    expect(r.ok).toBe(true);
  });

  it('rejects null ttl when requireExpiry is on', () => {
    const r = evaluateIssue(
      { ...base, maxTtlMinutes: 60, requireExpiry: true },
      { ttlMs: null, scopes: [], activeKeyCount: 0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ttl-required');
  });

  it('rejects ttl above the cap', () => {
    const r = evaluateIssue(
      { ...base, maxTtlMinutes: 60 },
      { ttlMs: 60 * 60_000 + 1, scopes: [], activeKeyCount: 0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ttl-too-large');
  });

  it('rejects when active key count is at or above the cap', () => {
    const r = evaluateIssue(
      { ...base, maxActiveKeysPerUser: 3 },
      { ttlMs: null, scopes: [], activeKeyCount: 3 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too-many-active-keys');
  });

  it('rejects scope list exceeding the cap', () => {
    const r = evaluateIssue(
      { ...base, maxScopesPerKey: 2 },
      { ttlMs: null, scopes: ['a:read', 'b:read', 'c:read'], activeKeyCount: 0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too-many-scopes');
  });

  it('rejects wildcard scope when policy forbids it', () => {
    const r = evaluateIssue(
      { ...base, allowWildcardScope: false },
      { ttlMs: null, scopes: ['*'], activeKeyCount: 0 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wildcard-scope-blocked');
  });
});

describe('needsRotation', () => {
  const base = {
    workspaceId: 'default',
    maxTtlMinutes: 0,
    requireExpiry: false,
    maxActiveKeysPerUser: 0,
    maxScopesPerKey: 0,
    allowWildcardScope: true,
    forcedRotationDays: 30,
    updatedAt: 0,
    updatedBy: null,
  };
  const now = 1_700_000_000_000;
  const day = 24 * 60 * 60_000;

  it('returns false when forcedRotationDays is unset', () => {
    expect(
      needsRotation(
        { ...base, forcedRotationDays: 0 },
        { createdAt: now - 365 * day },
        now,
      ),
    ).toBe(false);
  });

  it('returns true when created beyond the threshold and never rotated', () => {
    expect(needsRotation(base, { createdAt: now - 31 * day }, now)).toBe(true);
  });

  it('uses rotatedAt as the anchor when present', () => {
    expect(
      needsRotation(
        base,
        { createdAt: now - 365 * day, rotatedAt: now - 5 * day },
        now,
      ),
    ).toBe(false);
    expect(
      needsRotation(
        base,
        { createdAt: now - 365 * day, rotatedAt: now - 60 * day },
        now,
      ),
    ).toBe(true);
  });
});
