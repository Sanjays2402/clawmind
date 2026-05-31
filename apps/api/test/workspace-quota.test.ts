import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  updatePolicy,
  validatePatch,
  WorkspaceQuotaValidationError,
  effectiveWorkspaceLimit,
  effectiveUserLimit,
} from '../src/services/workspace-quota.js';
import {
  recordUsage,
  enforceWorkspaceAndUserQuota,
  getWorkspaceUsage,
  DEFAULT_FREE_LIMIT,
} from '../src/services/usage.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-wsq-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('workspace quota policy', () => {
  it('defaults to the historical free-tier limit and no per-user cap', async () => {
    const p = await getPolicy(dir);
    expect(p.monthlyLimit).toBe(DEFAULT_FREE_LIMIT);
    expect(p.perUserMonthlyLimit).toBeNull();
    expect(effectiveWorkspaceLimit(p)).toBe(DEFAULT_FREE_LIMIT);
    expect(effectiveUserLimit(p)).toBe(Number.POSITIVE_INFINITY);
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(() => validatePatch({ monthlyLimit: 0 })).toThrow(WorkspaceQuotaValidationError);
    expect(() => validatePatch({ monthlyLimit: 1.5 })).toThrow(WorkspaceQuotaValidationError);
    expect(() => validatePatch({ perUserMonthlyLimit: -1 })).toThrow(WorkspaceQuotaValidationError);
    // null and valid integers pass
    validatePatch({ monthlyLimit: null, perUserMonthlyLimit: 50 });
  });

  it('persists owner updates and records who changed them', async () => {
    const next = await updatePolicy(dir, 'owner-1', { monthlyLimit: 100, perUserMonthlyLimit: 25 });
    expect(next.monthlyLimit).toBe(100);
    expect(next.perUserMonthlyLimit).toBe(25);
    expect(next.updatedBy).toBe('owner-1');
    const reread = await getPolicy(dir);
    expect(reread.monthlyLimit).toBe(100);
    expect(reread.perUserMonthlyLimit).toBe(25);
  });

  it('null monthlyLimit means unlimited', async () => {
    await updatePolicy(dir, 'owner-1', { monthlyLimit: null });
    const p = await getPolicy(dir);
    expect(p.monthlyLimit).toBeNull();
    expect(effectiveWorkspaceLimit(p)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('workspace quota enforcement', () => {
  it('workspace cap blocks any user once the total is exhausted, regardless of who burned it', async () => {
    // Workspace cap of 3, no per-user cap.
    await updatePolicy(dir, 'owner', { monthlyLimit: 3, perUserMonthlyLimit: null });
    // alice burns the entire workspace quota.
    await recordUsage(dir, 'alice', 'ask', 3);

    // bob has consumed zero personally but cannot ask either: the
    // workspace ceiling is the blocker. This is the cross-member
    // isolation test enterprise procurement reviewers ask for.
    const bobAttempt = await enforceWorkspaceAndUserQuota(
      dir,
      'bob',
      1,
      3,                          // workspace limit
      Number.POSITIVE_INFINITY,   // no per-user cap
    );
    expect(bobAttempt.allowed).toBe(false);
    expect(bobAttempt.blocker).toBe('workspace');
    expect(bobAttempt.workspace?.used).toBe(3);
    expect(bobAttempt.workspace?.remaining).toBe(0);
  });

  it('per-user cap blocks the heavy member without affecting peers', async () => {
    // Generous workspace cap, tight per-member cap.
    await updatePolicy(dir, 'owner', { monthlyLimit: 1000, perUserMonthlyLimit: 2 });
    await recordUsage(dir, 'alice', 'ask', 2);

    const aliceAttempt = await enforceWorkspaceAndUserQuota(dir, 'alice', 1, 1000, 2);
    expect(aliceAttempt.allowed).toBe(false);
    expect(aliceAttempt.blocker).toBe('user');

    // bob still has full headroom — the per-user cap is per-member,
    // not a shared bucket.
    const bobAttempt = await enforceWorkspaceAndUserQuota(dir, 'bob', 1, 1000, 2);
    expect(bobAttempt.allowed).toBe(true);
    expect(bobAttempt.blocker).toBeFalsy();
  });

  it('unlimited workspace policy never blocks regardless of total usage', async () => {
    await recordUsage(dir, 'alice', 'ask', 10_000);
    const attempt = await enforceWorkspaceAndUserQuota(
      dir,
      'bob',
      1,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
    expect(attempt.allowed).toBe(true);
  });

  it('workspace rollup counts distinct members and aggregates by kind', async () => {
    await recordUsage(dir, 'alice', 'ask', 2);
    await recordUsage(dir, 'alice', 'search', 1);
    await recordUsage(dir, 'bob', 'ask', 1);
    const ws = await getWorkspaceUsage(dir, Date.now(), 100);
    expect(ws.used).toBe(4);
    expect(ws.byKind.ask).toBe(3);
    expect(ws.byKind.search).toBe(1);
    expect(ws.members).toBe(2);
    expect(ws.remaining).toBe(96);
  });
});
