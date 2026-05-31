import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordLogin,
  listForUser,
  revokeById,
  revokeAllForUser,
  isRevoked,
  removeBySid,
  hashSid,
  MAX_SESSIONS_PER_USER,
} from '../src/services/sessions.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-sessions-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('session registry', () => {
  it('records a login and surfaces it via listForUser as the current session', async () => {
    await recordLogin(dir, { sid: 'sid-1', userId: 'alice', ip: '1.1.1.1', userAgent: 'curl/8' });
    const list = await listForUser(dir, 'alice', 'sid-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.current).toBe(true);
    expect(list[0]!.ip).toBe('1.1.1.1');
    expect(list[0]!.userAgent).toBe('curl/8');
    expect(list[0]!.id).toBe(hashSid('sid-1').slice(0, 12));
  });

  it('isolates one user from another and never leaks across tenants', async () => {
    await recordLogin(dir, { sid: 'sid-a', userId: 'alice', ip: '1.1.1.1' });
    await recordLogin(dir, { sid: 'sid-b', userId: 'bob', ip: '2.2.2.2' });
    const aliceList = await listForUser(dir, 'alice', 'sid-a');
    const bobList = await listForUser(dir, 'bob', 'sid-b');
    expect(aliceList).toHaveLength(1);
    expect(bobList).toHaveLength(1);
    expect(aliceList[0]!.ip).toBe('1.1.1.1');
    expect(bobList[0]!.ip).toBe('2.2.2.2');
    // Cross-tenant revoke must do nothing.
    const stolen = await revokeById(dir, 'bob', aliceList[0]!.id);
    expect(stolen.revoked).toBe(0);
    expect(await isRevoked(dir, 'sid-a')).toBe(false);
  });

  it('revokes a single session and the auth check sees it as revoked', async () => {
    await recordLogin(dir, { sid: 'sid-1', userId: 'alice', ip: '1.1.1.1' });
    await recordLogin(dir, { sid: 'sid-2', userId: 'alice', ip: '1.1.1.2' });
    const list = await listForUser(dir, 'alice', 'sid-1');
    const target = list.find((s) => !s.current)!;
    const out = await revokeById(dir, 'alice', target.id);
    expect(out.revoked).toBe(1);
    expect(await isRevoked(dir, 'sid-2')).toBe(true);
    expect(await isRevoked(dir, 'sid-1')).toBe(false);
  });

  it('revoke-all keeps the current session when asked, otherwise wipes all', async () => {
    await recordLogin(dir, { sid: 'sid-1', userId: 'alice', ip: '1.1.1.1' });
    await recordLogin(dir, { sid: 'sid-2', userId: 'alice', ip: '1.1.1.2' });
    await recordLogin(dir, { sid: 'sid-3', userId: 'alice', ip: '1.1.1.3' });
    const keep = await revokeAllForUser(dir, 'alice', 'sid-1');
    expect(keep.revoked).toBe(2);
    expect(await isRevoked(dir, 'sid-1')).toBe(false);
    expect(await isRevoked(dir, 'sid-2')).toBe(true);
    expect(await isRevoked(dir, 'sid-3')).toBe(true);
  });

  it('removeBySid drops the entry entirely (logout path)', async () => {
    await recordLogin(dir, { sid: 'sid-1', userId: 'alice', ip: '1.1.1.1' });
    await removeBySid(dir, 'sid-1');
    const list = await listForUser(dir, 'alice', 'sid-1');
    expect(list).toHaveLength(0);
  });

  it('caps per-user sessions at MAX_SESSIONS_PER_USER, evicting the oldest', async () => {
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 5; i++) {
      await recordLogin(dir, { sid: `sid-${i}`, userId: 'alice', ip: '1.1.1.1' });
    }
    const list = await listForUser(dir, 'alice', undefined);
    expect(list.length).toBeLessThanOrEqual(MAX_SESSIONS_PER_USER);
  });

  it('enforces a workspace concurrent-session cap by evicting the oldest as a tombstone', async () => {
    // Cap of 2 concurrent sessions for alice. First two log in fine.
    const first = await recordLogin(dir, { sid: 'sid-1', userId: 'alice', ip: '1.1.1.1', userAgent: 'a', maxConcurrent: 2 });
    const second = await recordLogin(dir, { sid: 'sid-2', userId: 'alice', ip: '1.1.1.2', userAgent: 'b', maxConcurrent: 2 });
    expect(first.evicted).toHaveLength(0);
    expect(second.evicted).toHaveLength(0);

    // Third login must evict the oldest (sid-1) as a tombstone so the
    // user can see in the sessions UI that another sign-in took the seat.
    const third = await recordLogin(dir, { sid: 'sid-3', userId: 'alice', ip: '1.1.1.3', userAgent: 'c', maxConcurrent: 2 });
    expect(third.evicted).toHaveLength(1);
    expect(third.evicted[0]!.sidHash).toBe(hashSid('sid-1'));

    // The evicted session is treated as revoked everywhere downstream.
    expect(await isRevoked(dir, 'sid-1')).toBe(true);
    expect(await isRevoked(dir, 'sid-2')).toBe(false);
    expect(await isRevoked(dir, 'sid-3')).toBe(false);

    // Another user's sessions are never touched by alice's cap.
    const bob = await recordLogin(dir, { sid: 'bob-1', userId: 'bob', ip: '2.2.2.2', maxConcurrent: 2 });
    expect(bob.evicted).toHaveLength(0);
    expect(await isRevoked(dir, 'bob-1')).toBe(false);
  });
});
