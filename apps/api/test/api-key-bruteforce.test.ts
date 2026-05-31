import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  configure,
  recordFailure,
  recordSuccess,
  status,
  list,
  tail,
  unlock,
  _resetAll,
  DEFAULT_CONFIG,
} from '../src/services/api-key-bruteforce.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-bf-'));
  _resetAll();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key brute-force throttle', () => {
  it('exposes default configuration', () => {
    expect(DEFAULT_CONFIG.maxFails).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.windowMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.lockoutMs).toBeGreaterThan(0);
  });

  it('locks an ip after the configured number of failures', async () => {
    configure({ maxFails: 3, windowMs: 60_000, lockoutMs: 5_000 });
    const ip = '203.0.113.7';
    expect(status(ip).locked).toBe(false);
    const a = await recordFailure(dir, ip, 'unknown');
    const b = await recordFailure(dir, ip, 'unknown');
    expect(a.lockedNow).toBe(false);
    expect(b.lockedNow).toBe(false);
    const c = await recordFailure(dir, ip, 'unknown');
    expect(c.lockedNow).toBe(true);
    expect(c.status.locked).toBe(true);
    expect(status(ip).locked).toBe(true);
  });

  it('does not re-lock on subsequent failures while already locked', async () => {
    configure({ maxFails: 2, windowMs: 60_000, lockoutMs: 60_000 });
    const ip = '198.51.100.1';
    await recordFailure(dir, ip, 'unknown');
    const lock = await recordFailure(dir, ip, 'unknown');
    expect(lock.lockedNow).toBe(true);
    const next = await recordFailure(dir, ip, 'unknown');
    expect(next.lockedNow).toBe(false);
    expect(next.status.locked).toBe(true);
  });

  it('expires the lock naturally once lockoutMs has elapsed', async () => {
    configure({ maxFails: 2, windowMs: 60_000, lockoutMs: 1 });
    const ip = '198.51.100.2';
    await recordFailure(dir, ip, 'unknown');
    await recordFailure(dir, ip, 'unknown');
    expect(status(ip).locked).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(status(ip).locked).toBe(false);
  });

  it('a manual unlock clears the lock and writes an audit log entry', async () => {
    configure({ maxFails: 2, windowMs: 60_000, lockoutMs: 60_000 });
    const ip = '198.51.100.3';
    await recordFailure(dir, ip, 'unknown');
    await recordFailure(dir, ip, 'unknown');
    expect(status(ip).locked).toBe(true);
    const cleared = await unlock(dir, ip, 'owner-1');
    expect(cleared).toBe(true);
    expect(status(ip).locked).toBe(false);
    const recent = await tail(dir, 10);
    expect(recent.some((e) => e.event === 'unlock' && e.ip === ip)).toBe(true);
  });

  it('unlock returns false for an ip that was never tracked', async () => {
    const cleared = await unlock(dir, '10.0.0.99', 'owner-1');
    expect(cleared).toBe(false);
  });

  it('recordSuccess resets the failure counter for that ip only', async () => {
    configure({ maxFails: 3, windowMs: 60_000, lockoutMs: 60_000 });
    const a = '198.51.100.4';
    const b = '198.51.100.5';
    await recordFailure(dir, a, 'unknown');
    await recordFailure(dir, a, 'unknown');
    await recordFailure(dir, b, 'unknown');
    recordSuccess(a);
    expect(status(a).recent).toBe(0);
    expect(status(b).recent).toBe(1);
  });

  it('a locked ip stays locked even if a success is recorded mid-lockout', async () => {
    configure({ maxFails: 2, windowMs: 60_000, lockoutMs: 60_000 });
    const ip = '198.51.100.6';
    await recordFailure(dir, ip, 'unknown');
    await recordFailure(dir, ip, 'unknown');
    recordSuccess(ip);
    expect(status(ip).locked).toBe(true);
  });

  it('list returns locked ips first then by recent failure count', async () => {
    configure({ maxFails: 2, windowMs: 60_000, lockoutMs: 60_000 });
    await recordFailure(dir, '10.0.0.1', 'unknown');
    await recordFailure(dir, '10.0.0.2', 'unknown');
    await recordFailure(dir, '10.0.0.2', 'unknown');
    await recordFailure(dir, '10.0.0.3', 'unknown');
    const snap = list();
    expect(snap[0]!.ip).toBe('10.0.0.2');
    expect(snap[0]!.locked).toBe(true);
  });

  it('log persists across reads', async () => {
    configure({ maxFails: 2, windowMs: 60_000, lockoutMs: 60_000 });
    await recordFailure(dir, '10.0.0.10', 'unknown');
    await recordFailure(dir, '10.0.0.10', 'unknown');
    const file = readFileSync(join(dir, 'api-key-bruteforce.log'), 'utf8');
    expect(file.split('\n').filter(Boolean).length).toBe(2);
  });
});
