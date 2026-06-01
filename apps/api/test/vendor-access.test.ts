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
});
