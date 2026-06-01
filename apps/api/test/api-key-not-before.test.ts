import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  issueKey,
  setKeyNotBefore,
  normaliseNotBefore,
  loadKeys,
  MAX_NOT_BEFORE_AHEAD_MS,
  redact,
} from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-notbefore-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key scheduled activation (notBefore)', () => {
  it('normalises null and undefined to null', () => {
    expect(normaliseNotBefore(null).value).toBeNull();
    expect(normaliseNotBefore(undefined).value).toBeNull();
  });

  it('coerces past timestamps to null (already active)', () => {
    const v = normaliseNotBefore(1, Date.now());
    expect(v.ok).toBe(true);
    expect(v.value).toBeNull();
  });

  it('rejects non-finite inputs', () => {
    expect(normaliseNotBefore(Number.NaN as number).ok).toBe(false);
    expect(normaliseNotBefore(Number.POSITIVE_INFINITY as number).ok).toBe(false);
  });

  it('rejects timestamps more than one year ahead', () => {
    const now = Date.now();
    const v = normaliseNotBefore(now + MAX_NOT_BEFORE_AHEAD_MS + 60_000, now);
    expect(v.ok).toBe(false);
  });

  it('persists notBefore on issue and surfaces active=false in redact', async () => {
    const now = Date.now();
    const future = now + 60 * 60_000; // 1h
    const issued = await issueKey(dir, { userId: 'u1', label: 'pre', notBefore: future });
    expect(issued.record.notBefore).toBe(future);
    const all = await loadKeys(dir);
    expect(all[0]!.notBefore).toBe(future);
    const r = redact(issued.record);
    expect(r.notBefore).toBe(future);
    expect(r.active).toBe(false);
  });

  it('refuses to issue when notBefore >= expiresAt', async () => {
    const now = Date.now();
    await expect(
      issueKey(dir, { userId: 'u1', label: 'bad', ttlMs: 5 * 60_000, notBefore: now + 10 * 60_000 }),
    ).rejects.toThrow(/strictly before expiresAt/);
  });

  it('setKeyNotBefore updates and clears the field', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const future = Date.now() + 2 * 60_000;
    const updated = await setKeyNotBefore(dir, 'u1', issued.record.id, future);
    expect(updated?.notBefore).toBe(future);
    const cleared = await setKeyNotBefore(dir, 'u1', issued.record.id, null);
    expect(cleared?.notBefore).toBeNull();
  });

  it('refuses to update a key owned by another user', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const updated = await setKeyNotBefore(dir, 'u2', issued.record.id, Date.now() + 60_000);
    expect(updated).toBeNull();
  });

  it('end-to-end: auth plugin denies a pre-activation key with 401 + headers', async () => {
    const { authPlugin } = await import('../src/plugins/auth.js');
    const { requestIdPlugin } = await import('../src/plugins/request-id.js');

    const future = Date.now() + 60 * 60_000;
    const issued = await issueKey(dir, { userId: 'u1', label: 'scheduled', notBefore: future });

    const app = Fastify();
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async () => undefined },
      env: { CLAWMIND_OIDC_ISSUER: '', CLAWMIND_OIDC_CLIENT_ID: '', CLAWMIND_OIDC_CLIENT_SECRET: '', CLAWMIND_OIDC_REDIRECT_URI: '', CLAWMIND_OIDC_SCOPES: '', CLAWMIND_AUTH_MODE: 'api-key' },
    } as never);
    await app.register(requestIdPlugin);
    await app.register(authPlugin);
    app.get('/v1/ping', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));

    const denied = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${issued.secret}` },
    });
    expect(denied.statusCode).toBe(401);
    const body = denied.json() as { error: string; reason: string; notBefore: string; waitSeconds: number };
    expect(body.reason).toBe('not_yet_active');
    expect(body.notBefore).toBe(new Date(future).toISOString());
    expect(body.waitSeconds).toBeGreaterThan(0);
    expect(denied.headers['x-api-key-not-before']).toBe(new Date(future).toISOString());
    expect(denied.headers['retry-after']).toBeDefined();

    await app.close();
  });

  it('end-to-end: same key authenticates once notBefore has passed', async () => {
    const { authPlugin } = await import('../src/plugins/auth.js');
    const { requestIdPlugin } = await import('../src/plugins/request-id.js');

    // Schedule for 1ms in the future, then wait past it.
    const future = Date.now() + 1;
    const issued = await issueKey(dir, { userId: 'u1', label: 'go', notBefore: future });
    await new Promise((r) => setTimeout(r, 25));

    const app = Fastify();
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async () => undefined },
      env: { CLAWMIND_OIDC_ISSUER: '', CLAWMIND_OIDC_CLIENT_ID: '', CLAWMIND_OIDC_CLIENT_SECRET: '', CLAWMIND_OIDC_REDIRECT_URI: '', CLAWMIND_OIDC_SCOPES: '', CLAWMIND_AUTH_MODE: 'api-key' },
    } as never);
    await app.register(requestIdPlugin);
    await app.register(authPlugin);
    app.get('/v1/ping', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${issued.secret}` },
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});
