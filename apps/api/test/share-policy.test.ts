import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setPolicy,
  evaluate,
  invalidateCache,
  MAX_POLICY_TTL_DAYS,
  SharePolicyValidationError,
} from '../src/services/share-policy.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-share-policy-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('share-policy service', () => {
  it('returns an empty policy when no file exists', async () => {
    const p = await getPolicy(dir);
    expect(p.disableShares).toBe(false);
    expect(p.requireExpiry).toBe(false);
    expect(p.maxTtlDays).toBe(0);
    expect(p.updatedBy).toBeNull();
  });

  it('persists owner edits with partial-update semantics', async () => {
    await setPolicy(dir, 'alice', { maxTtlDays: 7 });
    const first = await getPolicy(dir);
    expect(first.maxTtlDays).toBe(7);
    expect(first.requireExpiry).toBe(false);
    await setPolicy(dir, 'alice', { requireExpiry: true });
    const second = await getPolicy(dir);
    // maxTtlDays preserved across the partial update.
    expect(second.maxTtlDays).toBe(7);
    expect(second.requireExpiry).toBe(true);
    expect(second.updatedBy).toBe('alice');
  });

  it('rejects out-of-range maxTtlDays', async () => {
    await expect(
      setPolicy(dir, 'alice', { maxTtlDays: MAX_POLICY_TTL_DAYS + 1 }),
    ).rejects.toBeInstanceOf(SharePolicyValidationError);
    await expect(
      setPolicy(dir, 'alice', { maxTtlDays: -1 }),
    ).rejects.toBeInstanceOf(SharePolicyValidationError);
  });

  it('rejects non-boolean booleans', async () => {
    await expect(
      // @ts-expect-error intentional bad type at runtime
      setPolicy(dir, 'alice', { requireExpiry: 'yes' }),
    ).rejects.toBeInstanceOf(SharePolicyValidationError);
  });
});

describe('share-policy evaluate', () => {
  const base = {
    workspaceId: 'default',
    disableShares: false,
    requireExpiry: false,
    maxTtlDays: 0,
    updatedAt: 0,
    updatedBy: null,
  };

  it('passes through when policy is unset', () => {
    expect(evaluate(base, { ttlDays: 5 })).toEqual({ ok: true, ttlDays: 5 });
    expect(evaluate(base, { ttlDays: null })).toEqual({ ok: true, ttlDays: null });
    expect(evaluate(base, {})).toEqual({ ok: true, ttlDays: undefined });
  });

  it('blocks every share when disableShares is on', () => {
    const d = evaluate({ ...base, disableShares: true }, { ttlDays: 1 });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('shares-disabled');
  });

  it('rejects null ttl when requireExpiry is on', () => {
    const d = evaluate({ ...base, requireExpiry: true }, { ttlDays: null });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('expiry-required');
  });

  it('clamps default and null ttl down to the cap', () => {
    const cap = { ...base, maxTtlDays: 7 };
    expect(evaluate(cap, {}).ttlDays).toBe(7);
    expect(evaluate(cap, { ttlDays: null }).ttlDays).toBe(7);
    expect(evaluate(cap, { ttlDays: 3 }).ttlDays).toBe(3);
  });

  it('rejects ttls above the cap', () => {
    const d = evaluate({ ...base, maxTtlDays: 7 }, { ttlDays: 30 });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('ttl-exceeds-cap');
    expect(d.message).toContain('30');
    expect(d.message).toContain('7');
  });
});

describe('share-policy cross-tenant isolation', () => {
  it('does not leak policy edits across workspaces', async () => {
    // The service is workspace-scoped: a write to workspace 'acme'
    // must not show up when workspace 'globex' reads its policy.
    await setPolicy(dir, 'alice', { disableShares: true, maxTtlDays: 1 }, 'acme');
    await setPolicy(dir, 'bob', { maxTtlDays: 90 }, 'globex');

    const acme = await getPolicy(dir, 'acme');
    const globex = await getPolicy(dir, 'globex');
    const def = await getPolicy(dir, 'default');

    expect(acme.disableShares).toBe(true);
    expect(acme.maxTtlDays).toBe(1);
    expect(acme.updatedBy).toBe('alice');

    expect(globex.disableShares).toBe(false);
    expect(globex.maxTtlDays).toBe(90);
    expect(globex.updatedBy).toBe('bob');

    // The default workspace was never touched and must stay empty.
    expect(def.disableShares).toBe(false);
    expect(def.maxTtlDays).toBe(0);
    expect(def.updatedBy).toBeNull();

    // Evaluation must use the right workspace's policy: a share
    // requested under globex with a 30-day TTL must succeed (cap=90)
    // while the same request under acme must be denied (disabled).
    expect(evaluate(globex, { ttlDays: 30 })).toEqual({ ok: true, ttlDays: 30 });
    const denied = evaluate(acme, { ttlDays: 30 });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('shares-disabled');
  });
});
