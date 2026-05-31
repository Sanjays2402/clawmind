import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueKey, setKeyRateLimit, loadKeys } from '../src/services/api-keys.js';
import { consume, _resetAllBuckets } from '../src/services/api-key-rate-limit.js';
import { applyRateLimitHeaders } from '../src/services/rate-headers.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-keyrl-'));
  _resetAllBuckets();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('per-key rate limit', () => {
  it('persists a custom rate limit on a key and clears it', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'partner' });
    const updated = await setKeyRateLimit(dir, 'u1', record.id, { max: 5, windowMs: 60_000 });
    expect(updated).not.toBeNull();
    expect(updated!.rateLimit).toEqual({ max: 5, windowMs: 60_000 });
    const persisted = await loadKeys(dir);
    expect(persisted[0]!.rateLimit).toEqual({ max: 5, windowMs: 60_000 });
    const cleared = await setKeyRateLimit(dir, 'u1', record.id, null);
    expect(cleared!.rateLimit).toBeNull();
  });

  it('rejects an invalid rate limit', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'partner' });
    await expect(setKeyRateLimit(dir, 'u1', record.id, { max: 0, windowMs: 60_000 })).rejects.toThrow();
    await expect(setKeyRateLimit(dir, 'u1', record.id, { max: 5, windowMs: 100 })).rejects.toThrow();
  });

  it('returns 404-equivalent (null) when the key belongs to another user', async () => {
    const { record } = await issueKey(dir, { userId: 'u1', label: 'partner' });
    const updated = await setKeyRateLimit(dir, 'u2', record.id, { max: 5, windowMs: 60_000 });
    expect(updated).toBeNull();
  });

  it('token bucket allows up to max and denies the next request in the window', () => {
    const limit = { max: 3, windowMs: 60_000 };
    const now = 1_000_000;
    const a = consume('k1', limit, now);
    const b = consume('k1', limit, now + 10);
    const c = consume('k1', limit, now + 20);
    const d = consume('k1', limit, now + 30);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
    expect(c.allowed).toBe(true);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.resetMs).toBe(now + 60_000);
  });

  it('token bucket resets after the window elapses', () => {
    const limit = { max: 1, windowMs: 1_000 };
    const t0 = 2_000_000;
    expect(consume('k2', limit, t0).allowed).toBe(true);
    expect(consume('k2', limit, t0 + 500).allowed).toBe(false);
    expect(consume('k2', limit, t0 + 1_100).allowed).toBe(true);
  });

  it('emits standard X-RateLimit headers and Retry-After when over budget', () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { headers[k.toLowerCase()] = String(v); } } as unknown as import('fastify').FastifyReply;
    const now = 5_000_000;
    applyRateLimitHeaders(reply, { limit: 10, remaining: 0, resetMs: now + 30_000, windowSec: 60, policy: 'api-key' }, now);
    expect(headers['x-ratelimit-limit']).toBe('10');
    expect(headers['x-ratelimit-remaining']).toBe('0');
    expect(headers['x-ratelimit-reset']).toBe(String(Math.ceil((now + 30_000) / 1000)));
    expect(headers['retry-after']).toBe('30');
    expect(headers['ratelimit-policy']).toContain('10;w=60');
    expect(headers['ratelimit-policy']).toContain('"api-key"');
  });

  it('does not emit Retry-After when budget remains', () => {
    const headers: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => { headers[k.toLowerCase()] = String(v); } } as unknown as import('fastify').FastifyReply;
    applyRateLimitHeaders(reply, { limit: 10, remaining: 4, resetMs: Date.now() + 30_000, windowSec: 60 });
    expect(headers['retry-after']).toBeUndefined();
    expect(headers['x-ratelimit-remaining']).toBe('4');
  });
});
