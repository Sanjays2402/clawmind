import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getHold,
  imposeHold,
  releaseHold,
  isLegalHoldActive,
  assertNotOnHold,
  LegalHoldActiveError,
  LegalHoldValidationError,
} from '../src/services/legal-hold.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-legalhold-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('legal-hold service', () => {
  it('returns an inactive default hold for fresh workspaces', async () => {
    const h = await getHold(dir);
    expect(h.active).toBe(false);
    expect(h.imposedAt).toBeNull();
    expect(await isLegalHoldActive(dir)).toBe(false);
    // assertNotOnHold must not throw when inactive.
    await expect(assertNotOnHold(dir)).resolves.toBeUndefined();
  });

  it('imposes, persists, and blocks deletes when active', async () => {
    const imposed = await imposeHold(dir, 'owner-1', {
      reason: 'SEC subpoena',
      ticket: 'LEGAL-42',
    });
    expect(imposed.active).toBe(true);
    expect(imposed.imposedBy).toBe('owner-1');
    expect(imposed.ticket).toBe('LEGAL-42');

    expect(await isLegalHoldActive(dir)).toBe(true);

    await expect(assertNotOnHold(dir)).rejects.toBeInstanceOf(LegalHoldActiveError);

    // Re-read from disk to prove persistence.
    const reread = await getHold(dir);
    expect(reread.active).toBe(true);
    expect(reread.reason).toBe('SEC subpoena');
  });

  it('preserves imposedAt across metadata updates and clears it on release', async () => {
    const first = await imposeHold(dir, 'owner-1', { ticket: 'LEGAL-1' });
    const firstAt = first.imposedAt!;
    // Update metadata without releasing.
    const second = await imposeHold(dir, 'owner-2', { ticket: 'LEGAL-1-UPDATED' });
    expect(second.imposedAt).toBe(firstAt);
    expect(second.ticket).toBe('LEGAL-1-UPDATED');

    const released = await releaseHold(dir, 'owner-2');
    expect(released.active).toBe(false);
    expect(released.releasedBy).toBe('owner-2');
    expect(released.releasedAt).not.toBeNull();
    await expect(assertNotOnHold(dir)).resolves.toBeUndefined();
  });

  it('release is idempotent when no hold is active', async () => {
    const r1 = await releaseHold(dir, 'owner-1');
    expect(r1.active).toBe(false);
    const r2 = await releaseHold(dir, 'owner-1');
    expect(r2.active).toBe(false);
  });

  it('rejects oversized reason and ticket', async () => {
    await expect(
      imposeHold(dir, 'owner-1', { reason: 'x'.repeat(10_000) }),
    ).rejects.toBeInstanceOf(LegalHoldValidationError);
    await expect(
      imposeHold(dir, 'owner-1', { ticket: 'y'.repeat(10_000) }),
    ).rejects.toBeInstanceOf(LegalHoldValidationError);
  });

  it('isolates holds per workspace id', async () => {
    await imposeHold(dir, 'owner-a', { ticket: 'A' }, 'tenant-a');
    expect(await isLegalHoldActive(dir, 'tenant-a')).toBe(true);
    expect(await isLegalHoldActive(dir, 'tenant-b')).toBe(false);
    await expect(assertNotOnHold(dir, 'tenant-b')).resolves.toBeUndefined();
    await expect(assertNotOnHold(dir, 'tenant-a')).rejects.toBeInstanceOf(
      LegalHoldActiveError,
    );
  });
});
