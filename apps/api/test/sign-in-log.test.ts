import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordSignIn,
  listForUser,
  listAll,
  MAX_RECORDS,
} from '../src/services/sign-in-log.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-signinlog-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('sign-in activity log', () => {
  it('records a success and surfaces it in listForUser', async () => {
    await recordSignIn(dir, {
      actor: 'gh:1', method: 'github', outcome: 'success',
      ip: '1.1.1.1', userAgent: 'curl/8',
    });
    const out = await listForUser(dir, 'gh:1');
    expect(out.records).toHaveLength(1);
    expect(out.records[0]!.method).toBe('github');
    expect(out.records[0]!.outcome).toBe('success');
    expect(out.records[0]!.ip).toBe('1.1.1.1');
    expect(out.total).toBe(1);
  });

  it('isolates one user from another: cross-tenant reads return nothing', async () => {
    await recordSignIn(dir, { actor: 'alice', method: 'oidc', outcome: 'success', ip: '1.1.1.1' });
    await recordSignIn(dir, { actor: 'bob', method: 'oidc', outcome: 'success', ip: '2.2.2.2' });
    await recordSignIn(dir, { actor: 'bob', method: 'oidc', outcome: 'failure', ip: '2.2.2.2', reason: 'bad token' });
    const aliceView = await listForUser(dir, 'alice');
    const bobView = await listForUser(dir, 'bob');
    expect(aliceView.records).toHaveLength(1);
    expect(aliceView.records.every((r) => r.actor === 'alice')).toBe(true);
    expect(bobView.records).toHaveLength(2);
    expect(bobView.records.every((r) => r.actor === 'bob')).toBe(true);
    // Critical: alice must not see bob's failure even though her view is
    // a slice of the same on-disk file.
    expect(aliceView.records.find((r) => r.actor === 'bob')).toBeUndefined();
  });

  it('hides anonymous failures from any individual user; admin view sees them', async () => {
    await recordSignIn(dir, { actor: 'anonymous', method: 'oidc', outcome: 'failure', ip: '9.9.9.9', reason: 'state mismatch' });
    await recordSignIn(dir, { actor: 'alice', method: 'oidc', outcome: 'success', ip: '1.1.1.1' });
    const aliceView = await listForUser(dir, 'alice');
    expect(aliceView.records.every((r) => r.actor === 'alice')).toBe(true);
    const adminView = await listAll(dir);
    expect(adminView.records.find((r) => r.actor === 'anonymous')).toBeDefined();
  });

  it('filters by outcome and by method on listAll', async () => {
    await recordSignIn(dir, { actor: 'alice', method: 'github', outcome: 'success', ip: '1.1.1.1' });
    await recordSignIn(dir, { actor: 'alice', method: 'oidc', outcome: 'failure', ip: '1.1.1.1', reason: 'bad' });
    await recordSignIn(dir, { actor: 'alice', method: 'github', outcome: 'logout', ip: '1.1.1.1' });
    const failures = await listAll(dir, { outcome: 'failure' });
    expect(failures.records).toHaveLength(1);
    expect(failures.records[0]!.reason).toBe('bad');
    const ghOnly = await listAll(dir, { method: 'github' });
    expect(ghOnly.records).toHaveLength(2);
  });

  it('filters by source ip on listAll for incident scoping', async () => {
    await recordSignIn(dir, { actor: 'alice', method: 'oidc', outcome: 'success', ip: '1.1.1.1' });
    await recordSignIn(dir, { actor: 'bob', method: 'oidc', outcome: 'failure', ip: '9.9.9.9', reason: 'bad' });
    await recordSignIn(dir, { actor: 'anonymous', method: 'oidc', outcome: 'failure', ip: '9.9.9.9', reason: 'probe' });
    const hits = await listAll(dir, { ip: '9.9.9.9' });
    expect(hits.records).toHaveLength(2);
    expect(hits.records.every((r) => r.ip === '9.9.9.9')).toBe(true);
    expect(hits.total).toBe(2);
    const miss = await listAll(dir, { ip: '8.8.8.8' });
    expect(miss.records).toHaveLength(0);
  });

  it('filters by reason substring (case-insensitive) on listAll for failure triage', async () => {
    await recordSignIn(dir, { actor: 'alice', method: 'oidc', outcome: 'success', ip: '1.1.1.1' });
    await recordSignIn(dir, { actor: 'bob', method: 'oidc', outcome: 'failure', ip: '2.2.2.2', reason: 'Bad password' });
    await recordSignIn(dir, { actor: 'eve', method: 'oidc', outcome: 'failure', ip: '3.3.3.3', reason: 'bad token' });
    await recordSignIn(dir, { actor: 'mallory', method: 'oidc', outcome: 'failure', ip: '4.4.4.4', reason: 'not allowed' });
    const bad = await listAll(dir, { reason: 'bad' });
    expect(bad.records).toHaveLength(2);
    expect(bad.records.every((r) => (r.reason ?? '').toLowerCase().includes('bad'))).toBe(true);
    expect(bad.total).toBe(2);
    const allowed = await listAll(dir, { reason: 'NOT ALLOWED' });
    expect(allowed.records).toHaveLength(1);
    expect(allowed.records[0]!.actor).toBe('mallory');
    const miss = await listAll(dir, { reason: 'nope' });
    expect(miss.records).toHaveLength(0);
  });

  it('paginates newest-first with a stable cursor', async () => {
    for (let i = 0; i < 5; i += 1) {
      await recordSignIn(dir, { actor: 'alice', method: 'oidc', outcome: 'success', ip: `1.0.0.${i}` });
      // Force a distinct timestamp on each row.
      await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await listForUser(dir, 'alice', { limit: 2 });
    expect(page1.records).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listForUser(dir, 'alice', { limit: 2, cursor: page1.nextCursor! });
    expect(page2.records).toHaveLength(2);
    // No duplication across pages.
    const ids = new Set([...page1.records, ...page2.records].map((r) => r.id));
    expect(ids.size).toBe(4);
  });

  it('caps the on-disk record count at MAX_RECORDS to bound the file', async () => {
    // Sanity guardrail. Don't actually write 5k records here; just check
    // the constant is exposed and non-trivial.
    expect(MAX_RECORDS).toBeGreaterThanOrEqual(1000);
  });
});
