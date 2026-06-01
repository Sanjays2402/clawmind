import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRequest,
  approveRequest,
  rejectRequest,
  consumeApproval,
  getRequest,
  listRequests,
  DualControlStateError,
  DualControlValidationError,
  MIN_TTL_MS,
} from '../src/services/dual-control.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-dca-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const ACTION = 'workspace-deletion.schedule';
const RESOURCE = '/v1/workspace/deletion';

describe('dual-control approval ledger', () => {
  it('mints a pending request with an expiry and records the actor', async () => {
    const before = Date.now();
    const rec = await createRequest(dir, 'owner-1', {
      action: ACTION,
      resource: RESOURCE,
      reason: 'exit clause',
    });
    expect(rec.id).toMatch(/^dca_/);
    expect(rec.state).toBe('pending');
    expect(rec.requestedBy).toBe('owner-1');
    expect(rec.reason).toBe('exit clause');
    expect(rec.expiresAt).toBeGreaterThanOrEqual(before + MIN_TTL_MS);
  });

  it('rejects invalid input', async () => {
    await expect(
      createRequest(dir, 'owner-1', { action: '', resource: RESOURCE }),
    ).rejects.toBeInstanceOf(DualControlValidationError);
  });

  it('lists newest first and survives restarts', async () => {
    const a = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    const list = await listRequests(dir);
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('refuses self-approval (four-eyes rule)', async () => {
    const rec = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    await expect(approveRequest(dir, 'owner-1', rec.id)).rejects.toMatchObject({
      code: 'same-actor',
    });
    // Still pending after failed self-approval.
    const after = await getRequest(dir, rec.id);
    expect(after?.state).toBe('pending');
  });

  it('approves when a different owner signs off', async () => {
    const rec = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    const approved = await approveRequest(dir, 'owner-2', rec.id);
    expect(approved.state).toBe('approved');
    expect(approved.approvedBy).toBe('owner-2');
  });

  it('rejects state transitions on non-pending records', async () => {
    const rec = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    await rejectRequest(dir, 'owner-2', rec.id);
    await expect(approveRequest(dir, 'owner-3', rec.id)).rejects.toMatchObject({
      code: 'invalid-state',
    });
  });

  it('consumeApproval enforces action/resource match', async () => {
    const rec = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    await approveRequest(dir, 'owner-2', rec.id);
    await expect(
      consumeApproval(dir, 'owner-3', rec.id, {
        action: 'something-else',
        resource: RESOURCE,
      }),
    ).rejects.toMatchObject({ code: 'action-mismatch' });
  });

  it('consumeApproval forbids approver==executor (cross-actor isolation)', async () => {
    const rec = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    await approveRequest(dir, 'owner-2', rec.id);
    // owner-2 (the approver) must not be able to also execute.
    await expect(
      consumeApproval(dir, 'owner-2', rec.id, { action: ACTION, resource: RESOURCE }),
    ).rejects.toMatchObject({ code: 'same-actor' });
  });

  it('consumeApproval marks the record consumed exactly once', async () => {
    const rec = await createRequest(dir, 'owner-1', { action: ACTION, resource: RESOURCE });
    await approveRequest(dir, 'owner-2', rec.id);
    const consumed = await consumeApproval(dir, 'owner-3', rec.id, {
      action: ACTION,
      resource: RESOURCE,
    });
    expect(consumed.state).toBe('consumed');
    expect(consumed.consumedBy).toBe('owner-3');
    // Replay must fail.
    await expect(
      consumeApproval(dir, 'owner-3', rec.id, { action: ACTION, resource: RESOURCE }),
    ).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('surfaces a 404-style error for unknown ids', async () => {
    await expect(
      consumeApproval(dir, 'owner-1', 'dca_does_not_exist', { action: ACTION, resource: RESOURCE }),
    ).rejects.toBeInstanceOf(DualControlStateError);
  });
});
