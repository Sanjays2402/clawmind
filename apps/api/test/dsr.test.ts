import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createRequest,
  verifyRequest,
  listRequests,
  updateRequest,
  getRequest,
  validateCreate,
  DsrValidationError,
} from '../src/services/dsr.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-dsr-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('dsr validation', () => {
  it('rejects empty / malformed email', () => {
    expect(() => validateCreate({ subjectEmail: '', kind: 'access' })).toThrow(DsrValidationError);
    expect(() => validateCreate({ subjectEmail: 'not-an-email', kind: 'access' })).toThrow(
      DsrValidationError,
    );
  });

  it('rejects unknown kind', () => {
    expect(() =>
      validateCreate({ subjectEmail: 'a@b.co', kind: 'nope' as never }),
    ).toThrow(DsrValidationError);
  });

  it('rejects oversized details', () => {
    expect(() =>
      validateCreate({
        subjectEmail: 'a@b.co',
        kind: 'erasure',
        details: 'x'.repeat(5000),
      }),
    ).toThrow(DsrValidationError);
  });

  it('lowercases email and defaults workspace', () => {
    const v = validateCreate({ subjectEmail: 'A@B.co', kind: 'access' });
    expect(v.subjectEmail).toBe('a@b.co');
    expect(v.workspaceId).toBe('default');
  });
});

describe('dsr queue lifecycle', () => {
  it('creates a request in unverified state with a one-shot token', async () => {
    const { record, verifyToken } = await createRequest(dir, {
      subjectEmail: 'subject@example.com',
      kind: 'erasure',
      details: 'please delete all data',
    });
    expect(record.status).toBe('unverified');
    expect(record.verifyHash).toHaveLength(64);
    expect(verifyToken.length).toBeGreaterThan(20);
    // Plaintext token must not be persisted.
    expect(JSON.stringify(record)).not.toContain(verifyToken);
  });

  it('verifies with the matching token and rejects mismatched ones', async () => {
    const { record, verifyToken } = await createRequest(dir, {
      subjectEmail: 'a@b.co',
      kind: 'access',
    });
    const bad = await verifyRequest(dir, record.id, 'totally-wrong-token-xxxxx');
    expect(bad).toBeNull();

    const ok = await verifyRequest(dir, record.id, verifyToken);
    expect(ok?.status).toBe('pending');
    expect(ok?.verifiedAt).toBeGreaterThan(0);

    // Re-verifying a row already pending is a no-op success (idempotent).
    const again = await verifyRequest(dir, record.id, verifyToken);
    expect(again?.status).toBe('pending');

    // ...but a wrong token against an already-verified row MUST still fail,
    // otherwise anyone who learns the request id can confirm someone else's
    // submission.
    const stolen = await verifyRequest(dir, record.id, 'wrong-token-still-wrong-xxxx');
    expect(stolen).toBeNull();
  });

  it('hides submitter IP behind a truncated hash', async () => {
    const { record } = await createRequest(dir, {
      subjectEmail: 'a@b.co',
      kind: 'access',
      submitterIp: '203.0.113.42',
    });
    expect(record.submitterIpHash).toBeTruthy();
    expect(record.submitterIpHash).not.toContain('203.0.113.42');
    expect(record.submitterIpHash!.length).toBeLessThanOrEqual(16);
  });

  it('rejects status transitions on an unverified request', async () => {
    const { record } = await createRequest(dir, {
      subjectEmail: 'a@b.co',
      kind: 'erasure',
    });
    await expect(
      updateRequest(dir, record.id, 'user_owner', { status: 'fulfilled' }),
    ).rejects.toThrow(DsrValidationError);
  });

  it('records resolver + resolvedAt on terminal transitions and clears them on reopen', async () => {
    const { record, verifyToken } = await createRequest(dir, {
      subjectEmail: 'a@b.co',
      kind: 'erasure',
    });
    await verifyRequest(dir, record.id, verifyToken);

    const fulfilled = await updateRequest(dir, record.id, 'user_owner', {
      status: 'fulfilled',
      note: 'exported and erased',
    });
    expect(fulfilled?.status).toBe('fulfilled');
    expect(fulfilled?.resolvedBy).toBe('user_owner');
    expect(fulfilled?.resolvedAt).toBeGreaterThan(0);
    expect(fulfilled?.note).toBe('exported and erased');

    const reopened = await updateRequest(dir, record.id, 'user_owner', {
      status: 'pending',
    });
    expect(reopened?.status).toBe('pending');
    expect(reopened?.resolvedBy).toBeNull();
    expect(reopened?.resolvedAt).toBeNull();
  });

  it('lists with optional status filter and isolates workspaces', async () => {
    const a = await createRequest(dir, {
      subjectEmail: 'a@b.co',
      kind: 'access',
      workspaceId: 'tenant-a',
    });
    await createRequest(dir, {
      subjectEmail: 'b@b.co',
      kind: 'erasure',
      workspaceId: 'tenant-b',
    });

    const allA = await listRequests(dir, { workspaceId: 'tenant-a' });
    expect(allA).toHaveLength(1);
    expect(allA[0]!.id).toBe(a.record.id);

    const unverified = await listRequests(dir, { status: 'unverified' });
    expect(unverified).toHaveLength(2);

    const pending = await listRequests(dir, { status: 'pending' });
    expect(pending).toHaveLength(0);
  });

  it('round-trips a record by id', async () => {
    const { record } = await createRequest(dir, {
      subjectEmail: 'a@b.co',
      kind: 'portability',
    });
    const fetched = await getRequest(dir, record.id);
    expect(fetched?.id).toBe(record.id);
    expect(fetched?.kind).toBe('portability');
    expect(await getRequest(dir, 'dsr_does_not_exist')).toBeNull();
  });
});
