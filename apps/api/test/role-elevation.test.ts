import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRequest,
  approveRequest,
  denyRequest,
  revokeRequest,
  getActiveGrant,
  listRequests,
  sweepExpired,
  RoleElevationError,
  MIN_DURATION_MIN,
  MAX_DURATION_MIN,
} from '../src/services/role-elevation.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-role-elev-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('role-elevation service', () => {
  it('rejects request with toRole not higher than current role', async () => {
    await expect(
      createRequest(dir, {
        userId: 'u1',
        fromRole: 'admin',
        toRole: 'admin',
        reason: 'ops drill',
        durationMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(RoleElevationError);

    await expect(
      createRequest(dir, {
        userId: 'u1',
        fromRole: 'owner',
        toRole: 'admin',
        reason: 'ops drill',
        durationMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(RoleElevationError);
  });

  it('rejects out-of-range duration and empty reason', async () => {
    await expect(
      createRequest(dir, {
        userId: 'u1',
        fromRole: 'admin',
        toRole: 'owner',
        reason: '',
        durationMinutes: 30,
      }),
    ).rejects.toBeInstanceOf(RoleElevationError);
    await expect(
      createRequest(dir, {
        userId: 'u1',
        fromRole: 'admin',
        toRole: 'owner',
        reason: 'r',
        durationMinutes: MIN_DURATION_MIN - 1,
      }),
    ).rejects.toBeInstanceOf(RoleElevationError);
    await expect(
      createRequest(dir, {
        userId: 'u1',
        fromRole: 'admin',
        toRole: 'owner',
        reason: 'r',
        durationMinutes: MAX_DURATION_MIN + 1,
      }),
    ).rejects.toBeInstanceOf(RoleElevationError);
  });

  it('approver cannot be the requester (4-eyes)', async () => {
    const rec = await createRequest(dir, {
      userId: 'u1',
      fromRole: 'admin',
      toRole: 'owner',
      reason: 'incident #42',
      durationMinutes: 30,
    });
    await expect(approveRequest(dir, rec.id, 'u1')).rejects.toBeInstanceOf(RoleElevationError);
    await expect(denyRequest(dir, rec.id, 'u1', null)).rejects.toBeInstanceOf(RoleElevationError);
  });

  it('approved grant is active inside window and gone after expiry', async () => {
    const t0 = 1_700_000_000_000;
    const rec = await createRequest(
      dir,
      { userId: 'u1', fromRole: 'admin', toRole: 'owner', reason: 'incident', durationMinutes: 10 },
      t0,
    );
    const approved = await approveRequest(dir, rec.id, 'owner-1', t0);
    expect(approved.status).toBe('approved');
    expect(approved.expiresAt).toBe(t0 + 10 * 60_000);

    const inside = await getActiveGrant(dir, 'u1', t0 + 60_000);
    expect(inside?.id).toBe(rec.id);
    expect(inside?.toRole).toBe('owner');

    // Other users are unaffected.
    const otherUser = await getActiveGrant(dir, 'u2', t0 + 60_000);
    expect(otherUser).toBeNull();

    // After expiry the grant is no longer active and sweepExpired flips
    // the persisted status so the dashboard does not show "approved".
    const after = await getActiveGrant(dir, 'u1', t0 + 11 * 60_000);
    expect(after).toBeNull();

    const changed = await sweepExpired(dir, t0 + 11 * 60_000);
    expect(changed).toBe(true);
    const all = await listRequests(dir);
    expect(all[0].status).toBe('expired');
  });

  it('revoke immediately removes the active grant', async () => {
    const t0 = 1_700_000_000_000;
    const rec = await createRequest(
      dir,
      { userId: 'u1', fromRole: 'admin', toRole: 'owner', reason: 'r', durationMinutes: 60 },
      t0,
    );
    await approveRequest(dir, rec.id, 'owner-1', t0);
    expect((await getActiveGrant(dir, 'u1', t0 + 1000))?.id).toBe(rec.id);
    await revokeRequest(dir, rec.id, 'owner-1', t0 + 2000);
    expect(await getActiveGrant(dir, 'u1', t0 + 3000)).toBeNull();
  });

  it('refuses stacking a new pending or active request for the same user', async () => {
    const t0 = 1_700_000_000_000;
    await createRequest(
      dir,
      { userId: 'u1', fromRole: 'admin', toRole: 'owner', reason: 'r', durationMinutes: 30 },
      t0,
    );
    await expect(
      createRequest(
        dir,
        { userId: 'u1', fromRole: 'admin', toRole: 'owner', reason: 'r2', durationMinutes: 30 },
        t0 + 1000,
      ),
    ).rejects.toBeInstanceOf(RoleElevationError);
  });
});
