import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getPolicy,
  updatePolicy,
  grantAccess,
  revokeAccess,
  verifyToken,
  getLockboxState,
  getState,
  lockboxHeaderValue,
  invalidateCache,
  VendorAccessPolicyError,
  VendorAccessValidationError,
  ABSOLUTE_MAX_DURATION_SEC,
} from '../src/services/vendor-access.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-vendor-access-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('vendor-access policy', () => {
  it('defaults to closed lockbox', async () => {
    const policy = await getPolicy(dir);
    expect(policy.enabled).toBe(false);
    const state = await getLockboxState(dir);
    expect(state.open).toBe(false);
    expect(lockboxHeaderValue(state)).toBe('closed');
  });

  it('refuses grants when lockbox is disabled', async () => {
    await expect(
      grantAccess(dir, 'owner-1', { durationSec: 600, reason: 'support' }),
    ).rejects.toBeInstanceOf(VendorAccessPolicyError);
  });

  it('refuses durations above policy ceiling', async () => {
    await updatePolicy(dir, 'owner-1', {
      enabled: true,
      maxDurationSec: 600,
      requireJustification: false,
      requireTicket: false,
    });
    await expect(
      grantAccess(dir, 'owner-1', { durationSec: 7200, reason: null }),
    ).rejects.toBeInstanceOf(VendorAccessValidationError);
    await expect(
      grantAccess(dir, 'owner-1', { durationSec: ABSOLUTE_MAX_DURATION_SEC + 1, reason: null }),
    ).rejects.toBeInstanceOf(VendorAccessValidationError);
  });

  it('requires justification when policy says so', async () => {
    await updatePolicy(dir, 'owner-1', {
      enabled: true,
      maxDurationSec: 600,
      requireJustification: true,
      requireTicket: false,
    });
    await expect(
      grantAccess(dir, 'owner-1', { durationSec: 300, reason: null }),
    ).rejects.toBeInstanceOf(VendorAccessValidationError);
  });

  it('grants and verifies the raw token, then rejects revoked tokens', async () => {
    await updatePolicy(dir, 'owner-1', {
      enabled: true,
      maxDurationSec: 600,
      requireJustification: false,
      requireTicket: false,
    });
    const { grant, token } = await grantAccess(dir, 'owner-1', {
      durationSec: 600,
      reason: 'INC-42 root cause',
    });
    expect(token.startsWith('cmv_')).toBe(true);
    expect(grant.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    invalidateCache();
    expect(await verifyToken(dir, token)).toBe(true);
    expect(await verifyToken(dir, 'cmv_wrong')).toBe(false);

    const state = await getLockboxState(dir);
    expect(state.open).toBe(true);
    expect(lockboxHeaderValue(state)).toMatch(/^open; expires-at=/);

    const revoked = await revokeAccess(dir, 'owner-2');
    expect(revoked?.revokedBy).toBe('owner-2');
    invalidateCache();
    expect(await verifyToken(dir, token)).toBe(false);

    const afterState = await getLockboxState(dir);
    expect(afterState.open).toBe(false);
    expect(lockboxHeaderValue(afterState)).toBe('closed');
  });

  it('disabling the lockbox revokes any active grant', async () => {
    await updatePolicy(dir, 'owner-1', {
      enabled: true,
      maxDurationSec: 600,
      requireJustification: false,
      requireTicket: false,
    });
    const { token } = await grantAccess(dir, 'owner-1', {
      durationSec: 600,
      reason: 'work',
    });
    invalidateCache();
    expect(await verifyToken(dir, token)).toBe(true);
    await updatePolicy(dir, 'owner-1', { enabled: false });
    invalidateCache();
    expect(await verifyToken(dir, token)).toBe(false);
  });

  it('filters getState history by q substring across id, grantedBy, reason, and ticket', async () => {
    await updatePolicy(dir, 'owner-1', {
      enabled: true,
      maxDurationSec: 600,
      requireJustification: false,
      requireTicket: false,
    });
    const a = await grantAccess(dir, 'owner-alice', {
      durationSec: 600,
      reason: 'INC-42 storage replica lag',
      ticket: 'JIRA-1001',
    });
    await revokeAccess(dir, 'owner-alice');
    const b = await grantAccess(dir, 'owner-bob', {
      durationSec: 600,
      reason: 'CASE-77 vector index rebuild',
      ticket: 'ZD-9988',
    });
    await revokeAccess(dir, 'owner-bob');

    const full = await getState(dir);
    expect(full.history.map((g) => g.id).sort()).toEqual([a.grant.id, b.grant.id].sort());

    const byReason = await getState(dir, undefined, { q: 'replica' });
    expect(byReason.history).toHaveLength(1);
    expect(byReason.history[0]!.id).toBe(a.grant.id);

    const byTicket = await getState(dir, undefined, { q: 'ZD-9988' });
    expect(byTicket.history).toHaveLength(1);
    expect(byTicket.history[0]!.id).toBe(b.grant.id);

    const byActor = await getState(dir, undefined, { q: 'ALICE' });
    expect(byActor.history).toHaveLength(1);
    expect(byActor.history[0]!.grantedBy).toBe('owner-alice');

    const byId = await getState(dir, undefined, { q: b.grant.id });
    expect(byId.history).toHaveLength(1);
    expect(byId.history[0]!.id).toBe(b.grant.id);

    const blank = await getState(dir, undefined, { q: '   ' });
    expect(blank.history).toHaveLength(2);

    const none = await getState(dir, undefined, { q: 'no-such-token' });
    expect(none.history).toHaveLength(0);
  });
});
