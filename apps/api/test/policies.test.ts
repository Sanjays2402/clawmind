import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  publishPolicy,
  listPolicies,
  getCurrentPolicies,
  acceptPolicy,
  listAcceptances,
  unmetPolicies,
  acceptanceSummary,
  PolicyValidationError,
  MAX_BODY,
} from '../src/services/policies.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-policies-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('policies service', () => {
  it('returns no current policies for a fresh workspace and no one is unmet', async () => {
    expect(await getCurrentPolicies(dir)).toEqual([]);
    expect(await unmetPolicies(dir, 'user-1')).toEqual([]);
  });

  it('publishes, persists, and exposes a current policy', async () => {
    const p = await publishPolicy(dir, 'owner-1', {
      kind: 'tos',
      title: 'Acme TOS v1',
      body: 'You agree to be nice.',
    });
    expect(p.kind).toBe('tos');
    expect(p.required).toBe(true);
    expect(p.publishedBy).toBe('owner-1');
    expect(p.bodyHash).toMatch(/^[0-9a-f]{64}$/);

    const current = await getCurrentPolicies(dir);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(p.id);

    // Re-publishing the exact same body is a no-op and returns the same id.
    const p2 = await publishPolicy(dir, 'owner-1', {
      kind: 'tos',
      title: 'Acme TOS v1 (resubmit)',
      body: 'You agree to be nice.',
    });
    expect(p2.id).toBe(p.id);
  });

  it('supersedes the prior version of the same kind on publish', async () => {
    const v1 = await publishPolicy(dir, 'owner-1', {
      kind: 'dpa', title: 'DPA v1', body: 'first body',
    }, 1000);
    const v2 = await publishPolicy(dir, 'owner-1', {
      kind: 'dpa', title: 'DPA v2', body: 'second body',
    }, 2000);

    expect(v1.id).not.toBe(v2.id);
    const all = await listPolicies(dir, { includeSuperseded: true });
    const v1Reread = all.find((p) => p.id === v1.id)!;
    expect(v1Reread.supersededAt).not.toBeNull();

    const current = await getCurrentPolicies(dir, 3000);
    expect(current).toHaveLength(1);
    expect(current[0].id).toBe(v2.id);
  });

  it('PROVES enforcement: a required policy yields an unmet entry until accepted', async () => {
    const policy = await publishPolicy(dir, 'owner-1', {
      kind: 'aup',
      title: 'AUP v1',
      body: 'no abuse',
      required: true,
    });

    // Before acceptance the user is gated.
    const before = await unmetPolicies(dir, 'user-1');
    expect(before).toHaveLength(1);
    expect(before[0].id).toBe(policy.id);

    // Accepting clears the gate for that user only.
    const acc = await acceptPolicy(dir, {
      policyId: policy.id,
      userId: 'user-1',
      ip: '203.0.113.7',
      userAgent: 'curl/8',
    });
    expect(acc.policyId).toBe(policy.id);
    expect(acc.ip).toBe('203.0.113.7');

    expect(await unmetPolicies(dir, 'user-1')).toEqual([]);
    // A different user is still gated.
    const otherUnmet = await unmetPolicies(dir, 'user-2');
    expect(otherUnmet).toHaveLength(1);
    expect(otherUnmet[0].id).toBe(policy.id);
  });

  it('publishing a NEW required version re-gates a previously-compliant user', async () => {
    const v1 = await publishPolicy(dir, 'owner-1', {
      kind: 'dpa', title: 'DPA v1', body: 'v1 text', required: true,
    }, 1000);
    await acceptPolicy(dir, {
      policyId: v1.id, userId: 'user-1', ip: '1.2.3.4', userAgent: 'ua',
    }, 1500);
    expect(await unmetPolicies(dir, 'user-1', 1500)).toEqual([]);

    const v2 = await publishPolicy(dir, 'owner-1', {
      kind: 'dpa', title: 'DPA v2', body: 'v2 text', required: true,
    }, 2000);
    const unmet = await unmetPolicies(dir, 'user-1', 2500);
    expect(unmet).toHaveLength(1);
    expect(unmet[0].id).toBe(v2.id);
  });

  it('non-required policies never gate even if unaccepted', async () => {
    await publishPolicy(dir, 'owner-1', {
      kind: 'tos', title: 'optional', body: 'hi', required: false,
    });
    expect(await unmetPolicies(dir, 'user-1')).toEqual([]);
  });

  it('acceptance is idempotent and append-only', async () => {
    const policy = await publishPolicy(dir, 'owner-1', {
      kind: 'tos', title: 't', body: 'b',
    });
    const a1 = await acceptPolicy(dir, {
      policyId: policy.id, userId: 'u', ip: 'i', userAgent: 'ua',
    }, 100);
    const a2 = await acceptPolicy(dir, {
      policyId: policy.id, userId: 'u', ip: 'i', userAgent: 'ua',
    }, 200);
    expect(a2.acceptedAt).toBe(a1.acceptedAt); // same record returned
    const list = await listAcceptances(dir, { userId: 'u' });
    expect(list).toHaveLength(1);
  });

  it('rejects malformed input', async () => {
    await expect(
      publishPolicy(dir, 'o', { kind: 'tos', title: '', body: 'b' }),
    ).rejects.toBeInstanceOf(PolicyValidationError);
    await expect(
      publishPolicy(dir, 'o', { kind: 'tos', title: 't', body: '' }),
    ).rejects.toBeInstanceOf(PolicyValidationError);
    await expect(
      publishPolicy(dir, 'o', { kind: 'tos', title: 't', body: 'x'.repeat(MAX_BODY + 1) }),
    ).rejects.toBeInstanceOf(PolicyValidationError);
    await expect(
      acceptPolicy(dir, { policyId: 'nope', userId: 'u', ip: '', userAgent: '' }),
    ).rejects.toBeInstanceOf(PolicyValidationError);
  });

  it('summary counts unique accepting users per current policy', async () => {
    const tos = await publishPolicy(dir, 'o', { kind: 'tos', title: 't', body: 'b' });
    const dpa = await publishPolicy(dir, 'o', { kind: 'dpa', title: 'd', body: 'b' });
    await acceptPolicy(dir, { policyId: tos.id, userId: 'u1', ip: '', userAgent: '' });
    await acceptPolicy(dir, { policyId: tos.id, userId: 'u2', ip: '', userAgent: '' });
    await acceptPolicy(dir, { policyId: dpa.id, userId: 'u1', ip: '', userAgent: '' });
    const sum = await acceptanceSummary(dir);
    const byKind = Object.fromEntries(sum.map((s) => [s.policy.kind, s.acceptedCount]));
    expect(byKind.tos).toBe(2);
    expect(byKind.dpa).toBe(1);
  });
});
