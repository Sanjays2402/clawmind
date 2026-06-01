import { describe, it, expect } from 'vitest';
import { AuditLog } from '../src/audit-log.js';
import {
  issueInclusionProof,
  verifyInclusionProof,
  signInclusionProof,
} from '../src/audit-proofs.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function makeLog() {
  const dir = await mkdtemp(join(tmpdir(), 'cm-proof-'));
  return new AuditLog(join(dir, 'audit.log'));
}

describe('audit inclusion proofs', () => {
  const secret = 'unit-test-secret';

  it('issues a proof for a known event and verifies offline', async () => {
    const log = await makeLog();
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/one' });
    const target = await log.write({
      actor: 'u',
      action: 'POST 200',
      resource: '/v1/two',
    });
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/three' });

    const v = await log.verify();
    expect(v.ok).toBe(true);

    const result = await issueInclusionProof({
      eventId: target.id,
      iterate: () => log.iterate(),
      chainHeadHash: v.headHash,
      chainChecked: v.checked,
      secret,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('proof issuance failed');

    expect(result.proof.position).toBe(2);
    expect(result.proof.event.id).toBe(target.id);
    expect(result.proof.eventHash).toBe(target.hash);

    const verdict = verifyInclusionProof(result.proof, secret);
    expect(verdict.ok).toBe(true);
    expect(verdict.eventHashValid).toBe(true);
    expect(verdict.signatureValid).toBe(true);
  });

  it('rejects a proof whose event body was tampered', async () => {
    const log = await makeLog();
    const ev = await log.write({
      actor: 'alice',
      action: 'POST 200',
      resource: '/v1/sensitive',
    });
    const v = await log.verify();
    const result = await issueInclusionProof({
      eventId: ev.id,
      iterate: () => log.iterate(),
      chainHeadHash: v.headHash,
      chainChecked: v.checked,
      secret,
    });
    if (!result.ok) throw new Error('proof issuance failed');

    // Attacker swaps the actor but keeps the original hash. The verifier
    // must detect this because the recomputed event hash will not match.
    const tampered = {
      ...result.proof,
      event: { ...result.proof.event, actor: 'mallory' },
    };
    const verdict = verifyInclusionProof(tampered, secret);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('event-hash-mismatch');
  });

  it('rejects a proof signed with the wrong secret', async () => {
    const log = await makeLog();
    const ev = await log.write({
      actor: 'u',
      action: 'POST 200',
      resource: '/v1/x',
    });
    const v = await log.verify();
    const result = await issueInclusionProof({
      eventId: ev.id,
      iterate: () => log.iterate(),
      chainHeadHash: v.headHash,
      chainChecked: v.checked,
      secret,
    });
    if (!result.ok) throw new Error('proof issuance failed');
    const verdict = verifyInclusionProof(result.proof, 'different-secret');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('bad-signature');
  });

  it('rejects a proof whose claimed position was rewritten', async () => {
    const log = await makeLog();
    const ev = await log.write({
      actor: 'u',
      action: 'POST 200',
      resource: '/v1/x',
    });
    const v = await log.verify();
    const result = await issueInclusionProof({
      eventId: ev.id,
      iterate: () => log.iterate(),
      chainHeadHash: v.headHash,
      chainChecked: v.checked,
      secret,
    });
    if (!result.ok) throw new Error('proof issuance failed');
    // Swap position without resigning. The HMAC must reject this.
    const tampered = { ...result.proof, position: 99 };
    const verdict = verifyInclusionProof(tampered, secret);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('bad-signature');
  });

  it('returns not-found for an unknown event id', async () => {
    const log = await makeLog();
    await log.write({ actor: 'u', action: 'POST 200', resource: '/v1/x' });
    const v = await log.verify();
    const result = await issueInclusionProof({
      eventId: 'does-not-exist',
      iterate: () => log.iterate(),
      chainHeadHash: v.headHash,
      chainChecked: v.checked,
      secret,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('not-found');
  });

  it('signInclusionProof is deterministic for the same body', async () => {
    const log = await makeLog();
    const ev = await log.write({
      actor: 'u',
      action: 'POST 200',
      resource: '/v1/x',
    });
    const v = await log.verify();
    const base = {
      id: 'fixed-id',
      ts: 1700000000000,
      event: ev,
      eventHash: ev.hash!,
      position: 1,
      chainHeadHash: v.headHash,
      chainChecked: v.checked,
    };
    expect(signInclusionProof(base, secret)).toBe(
      signInclusionProof(base, secret),
    );
  });
});
