import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDocument,
  updateSettings,
  signAttestation,
  withdrawCurrent,
  publicView,
  deriveStatus,
  CanaryValidationError,
} from '../src/services/warrant-canary.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-canary-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('warrant canary settings', () => {
  it('starts unconfigured on a fresh install', async () => {
    const doc = await getDocument(dir);
    expect(doc.enabled).toBe(false);
    expect(doc.history).toEqual([]);
    expect(deriveStatus(doc, Date.now())).toBe('unconfigured');
  });

  it('rejects out-of-range cadence', async () => {
    await expect(
      updateSettings(dir, 'u', { defaultCadenceDays: 0 }),
    ).rejects.toThrow(CanaryValidationError);
    await expect(
      updateSettings(dir, 'u', { defaultCadenceDays: 9999 }),
    ).rejects.toThrow(CanaryValidationError);
  });

  it('persists enable + cadence + preamble together', async () => {
    const doc = await updateSettings(dir, 'op', {
      enabled: true,
      defaultCadenceDays: 14,
      preamble: 'Signed monthly by the workspace owner.',
    });
    expect(doc.enabled).toBe(true);
    expect(doc.defaultCadenceDays).toBe(14);
    expect(doc.updatedBy).toBe('op');
  });
});

describe('warrant canary attestation', () => {
  it('refuses to sign while disabled', async () => {
    await expect(
      signAttestation(dir, 'op', { statement: 'No process received.' }),
    ).rejects.toThrow(CanaryValidationError);
  });

  it('signs an attestation and derives status active', async () => {
    await updateSettings(dir, 'op', { enabled: true, defaultCadenceDays: 30 });
    const { doc, record } = await signAttestation(dir, 'op', {
      statement: 'No undisclosed legal process has been received since the previous attestation.',
    });
    expect(record.id).toBe('wc_000001');
    expect(record.cadenceDays).toBe(30);
    expect(record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(record.expiresAt).toBeGreaterThan(record.attestedAt);
    expect(deriveStatus(doc, record.attestedAt)).toBe('active');
  });

  it('rejects empty or oversize statement', async () => {
    await updateSettings(dir, 'op', { enabled: true });
    await expect(
      signAttestation(dir, 'op', { statement: '   ' }),
    ).rejects.toThrow(CanaryValidationError);
    await expect(
      signAttestation(dir, 'op', { statement: 'x'.repeat(9000) }),
    ).rejects.toThrow(CanaryValidationError);
  });

  it('flips to stale after expiresAt passes', async () => {
    await updateSettings(dir, 'op', { enabled: true, defaultCadenceDays: 1 });
    const { doc, record } = await signAttestation(dir, 'op', {
      statement: 'Nothing to disclose.',
    });
    // Simulate a query made well after expiry.
    const later = record.expiresAt + 60_000;
    expect(deriveStatus(doc, later)).toBe('stale');
    const pub = publicView(doc, later);
    expect(pub.status).toBe('stale');
  });
});

describe('warrant canary withdrawal', () => {
  it('requires a reason and refuses to double-withdraw', async () => {
    await updateSettings(dir, 'op', { enabled: true });
    await signAttestation(dir, 'op', { statement: 'Nothing to disclose.' });
    await expect(
      withdrawCurrent(dir, 'op', { reason: '   ' }),
    ).rejects.toThrow(CanaryValidationError);
    const { record } = await withdrawCurrent(dir, 'op', {
      reason: 'Received order under seal; canary withdrawn pending review.',
    });
    expect(record.withdrawnBy).toBe('op');
    expect(record.withdrawnReason).toContain('Received order');
    await expect(
      withdrawCurrent(dir, 'op', { reason: 'again' }),
    ).rejects.toThrow(CanaryValidationError);
  });

  it('preserves the history entry after withdrawal', async () => {
    await updateSettings(dir, 'op', { enabled: true });
    const { record } = await signAttestation(dir, 'op', { statement: 'Nothing to disclose.' });
    await withdrawCurrent(dir, 'op', { reason: 'process received' });
    const doc = await getDocument(dir);
    expect(doc.history).toHaveLength(1);
    expect(doc.history[0]!.id).toBe(record.id);
    expect(doc.history[0]!.withdrawnAt).not.toBeNull();
    expect(deriveStatus(doc, Date.now())).toBe('withdrawn');
  });
});

describe('warrant canary public projection', () => {
  it('never leaks attestedBy / withdrawnBy / updatedBy', async () => {
    await updateSettings(dir, 'op-secret', { enabled: true, preamble: 'public note' });
    await signAttestation(dir, 'op-secret', { statement: 'No process received.' });
    await withdrawCurrent(dir, 'op-secret', { reason: 'precautionary' });
    const doc = await getDocument(dir);
    const pub = publicView(doc);
    const serialised = JSON.stringify(pub);
    expect(serialised).not.toContain('op-secret');
    expect(pub).not.toHaveProperty('updatedBy');
    const history = (pub as { history: unknown[] }).history;
    for (const entry of history as Record<string, unknown>[]) {
      expect(entry).not.toHaveProperty('attestedBy');
      expect(entry).not.toHaveProperty('withdrawnBy');
    }
  });

  it('exposes a recomputable fingerprint', async () => {
    await updateSettings(dir, 'op', { enabled: true, defaultCadenceDays: 7 });
    const { record } = await signAttestation(dir, 'op', {
      statement: 'Nothing to disclose.',
    });
    const doc = await getDocument(dir);
    const pub = publicView(doc) as { current: { fingerprint: string } };
    expect(pub.current.fingerprint).toBe(record.fingerprint);
    expect(pub.current.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});
