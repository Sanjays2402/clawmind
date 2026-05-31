import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  setPolicy,
  evaluateSession,
  invalidateCache,
  SessionPolicyValidationError,
  DEFAULT_LIFETIME_MIN,
  MAX_LIFETIME_MIN,
  MAX_IDLE_MIN,
} from '../src/services/session-policy.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-session-policy-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('session-policy service', () => {
  it('defaults to unset on a fresh deployment', async () => {
    const p = await getPolicy(dir);
    expect(p.maxLifetimeMinutes).toBe(0);
    expect(p.idleTimeoutMinutes).toBe(0);
    expect(p.updatedBy).toBeNull();
  });

  it('setPolicy records actor and rejects out-of-range values', async () => {
    const p = await setPolicy(dir, 'owner-1', {
      maxLifetimeMinutes: 60,
      idleTimeoutMinutes: 15,
    });
    expect(p.updatedBy).toBe('owner-1');
    expect(p.maxLifetimeMinutes).toBe(60);
    expect(p.idleTimeoutMinutes).toBe(15);

    await expect(
      setPolicy(dir, 'owner-1', { maxLifetimeMinutes: MAX_LIFETIME_MIN + 1 }),
    ).rejects.toBeInstanceOf(SessionPolicyValidationError);
    await expect(
      setPolicy(dir, 'owner-1', { idleTimeoutMinutes: MAX_IDLE_MIN + 1 }),
    ).rejects.toBeInstanceOf(SessionPolicyValidationError);
  });

  it('rejects idle window larger than lifetime window', async () => {
    await expect(
      setPolicy(dir, 'owner-1', {
        maxLifetimeMinutes: 60,
        idleTimeoutMinutes: 120,
      }),
    ).rejects.toBeInstanceOf(SessionPolicyValidationError);
  });

  it('evaluateSession returns ok when policy is unset', () => {
    const res = evaluateSession(
      {
        workspaceId: 'default',
        maxLifetimeMinutes: 0,
        idleTimeoutMinutes: 0,
        updatedAt: 0,
        updatedBy: null,
      },
      { createdAt: 0, lastSeenAt: 0 },
      DEFAULT_LIFETIME_MIN * 60_000 * 1000,
    );
    expect(res.ok).toBe(true);
  });

  it('evaluateSession flags lifetime-exceeded once the cap is reached', () => {
    const policy = {
      workspaceId: 'default',
      maxLifetimeMinutes: 60,
      idleTimeoutMinutes: 0,
      updatedAt: 0,
      updatedBy: null,
    };
    const now = 1_000_000_000;
    const ok = evaluateSession(policy, { createdAt: now - 30 * 60_000, lastSeenAt: now }, now);
    expect(ok.ok).toBe(true);
    const expired = evaluateSession(policy, { createdAt: now - 61 * 60_000, lastSeenAt: now }, now);
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.reason).toBe('lifetime-exceeded');
      expect(expired.limitMinutes).toBe(60);
    }
  });

  it('evaluateSession flags idle-timeout independently of lifetime', () => {
    const policy = {
      workspaceId: 'default',
      maxLifetimeMinutes: 0,
      idleTimeoutMinutes: 10,
      updatedAt: 0,
      updatedBy: null,
    };
    const now = 1_000_000_000;
    const idle = evaluateSession(policy, { createdAt: now - 60_000, lastSeenAt: now - 11 * 60_000 }, now);
    expect(idle.ok).toBe(false);
    if (!idle.ok) {
      expect(idle.reason).toBe('idle-timeout');
      expect(idle.limitMinutes).toBe(10);
    }
  });

  it('lifetime cap wins over idle cap when both trip at the same instant', () => {
    const policy = {
      workspaceId: 'default',
      maxLifetimeMinutes: 60,
      idleTimeoutMinutes: 30,
      updatedAt: 0,
      updatedBy: null,
    };
    const now = 1_000_000_000;
    const both = evaluateSession(
      policy,
      { createdAt: now - 120 * 60_000, lastSeenAt: now - 60 * 60_000 },
      now,
    );
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.reason).toBe('lifetime-exceeded');
  });
});
