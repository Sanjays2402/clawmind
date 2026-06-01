import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  publishBanner,
  disableBanner,
  getBanner,
  recordAck,
  hasSessionAcked,
  hashBody,
  invalidateLoginBannerCache,
  isLoginBannerAllowedPath,
  LoginBannerValidationError,
} from '../src/services/login-banner.js';
import { loginBannerPlugin } from '../src/plugins/login-banner.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-login-banner-'));
  invalidateLoginBannerCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('login-banner service', () => {
  it('returns a disabled empty banner before any publish', async () => {
    const b = await getBanner(dir);
    expect(b.enabled).toBe(false);
    expect(b.bodyHash).toBeNull();
    expect(b.requireAck).toBe(false);
  });

  it('publishes and hashes deterministically', async () => {
    const body = 'WARNING: U.S. Government computer. Use is monitored.';
    const b = await publishBanner(dir, 'owner-1', {
      enabled: true, title: 'System Use Notice', body,
      severity: 'warning', requireAck: true,
    });
    expect(b.enabled).toBe(true);
    expect(b.publishedBy).toBe('owner-1');
    expect(b.bodyHash).toBe(hashBody(body));
    expect(b.severity).toBe('warning');
  });

  it('rejects invalid severity and oversized title', async () => {
    await expect(
      publishBanner(dir, 'u', { enabled: true, title: 'x'.repeat(300), body: 'b', severity: 'warning', requireAck: false }),
    ).rejects.toBeInstanceOf(LoginBannerValidationError);
    await expect(
      publishBanner(dir, 'u', { enabled: true, title: 't', body: 'b', severity: 'bad' as never, requireAck: false }),
    ).rejects.toBeInstanceOf(LoginBannerValidationError);
  });

  it('records a session ack only when bodyHash matches', async () => {
    const body = 'Authorized use only';
    await publishBanner(dir, 'o', { enabled: true, title: 'T', body, severity: 'info', requireAck: true });
    invalidateLoginBannerCache();
    const wrong = await recordAck(dir, { userId: 'u1', sessionId: 's1', bodyHash: hashBody('other') });
    expect(wrong.kind).toBe('hash-mismatch');
    const ok = await recordAck(dir, { userId: 'u1', sessionId: 's1', bodyHash: hashBody(body), ip: '10.0.0.1', userAgent: 'curl/8' });
    expect(ok.kind).toBe('ok');
    expect(await hasSessionAcked(dir, 's1', hashBody(body))).toBe(true);
    expect(await hasSessionAcked(dir, 's2', hashBody(body))).toBe(false);
  });

  it('publishing a banner with a new body invalidates prior session acks for the gate', async () => {
    await publishBanner(dir, 'o', { enabled: true, title: 'T', body: 'A', severity: 'info', requireAck: true });
    invalidateLoginBannerCache();
    await recordAck(dir, { userId: 'u1', sessionId: 's1', bodyHash: hashBody('A') });
    expect(await hasSessionAcked(dir, 's1', hashBody('A'))).toBe(true);
    await publishBanner(dir, 'o', { enabled: true, title: 'T', body: 'B', severity: 'info', requireAck: true });
    invalidateLoginBannerCache();
    expect(await hasSessionAcked(dir, 's1', hashBody('B'))).toBe(false);
  });

  it('disable flips enabled+requireAck to false but preserves ack history', async () => {
    await publishBanner(dir, 'o', { enabled: true, title: 'T', body: 'A', severity: 'info', requireAck: true });
    await recordAck(dir, { userId: 'u1', sessionId: 's1', bodyHash: hashBody('A') });
    const after = await disableBanner(dir, 'o');
    expect(after.enabled).toBe(false);
    expect(after.requireAck).toBe(false);
    invalidateLoginBannerCache();
    // History still queryable.
    expect(await hasSessionAcked(dir, 's1', hashBody('A'))).toBe(true);
  });
});

describe('login-banner allowlist', () => {
  it('always permits read methods', () => {
    expect(isLoginBannerAllowedPath('GET', '/v1/search')).toBe(true);
    expect(isLoginBannerAllowedPath('HEAD', '/v1/anything')).toBe(true);
  });
  it('permits the banner + ack + auth/mfa/session paths', () => {
    expect(isLoginBannerAllowedPath('POST', '/v1/login-banner/ack')).toBe(true);
    expect(isLoginBannerAllowedPath('PUT', '/v1/login-banner')).toBe(true);
    expect(isLoginBannerAllowedPath('POST', '/v1/auth/login')).toBe(true);
    expect(isLoginBannerAllowedPath('POST', '/v1/mfa/verify')).toBe(true);
    expect(isLoginBannerAllowedPath('POST', '/v1/sessions/logout')).toBe(true);
  });
  it('blocks ordinary mutating routes', () => {
    expect(isLoginBannerAllowedPath('POST', '/v1/ingest')).toBe(false);
    expect(isLoginBannerAllowedPath('PATCH', '/v1/conversations/abc')).toBe(false);
  });
});

describe('login-banner plugin enforcement', () => {
  async function build() {
    const app = Fastify();
    const audited: Array<{ actor: string; action: string }> = [];
    app.decorate('clawmind', {
      dataDir: dir,
      audit: {
        write: async (e: { actor: string; action: string }) => { audited.push(e); },
      },
    } as never);
    app.addHook('preHandler', async (req) => {
      const u = req.headers['x-test-user'];
      const v = req.headers['x-test-via'];
      const sid = req.headers['x-test-sid'];
      if (typeof u === 'string') {
        (req as { user?: unknown }).user = {
          id: u, role: 'member',
          via: typeof v === 'string' ? v : 'session',
        };
      }
      if (typeof sid === 'string') {
        (req as { session?: unknown }).session = { sessionId: sid };
      } else {
        (req as { session?: unknown }).session = {};
      }
    });
    await app.register(loginBannerPlugin);
    app.post('/v1/ingest', async () => ({ ok: true }));
    app.get('/v1/search', async () => ({ ok: true }));
    app.post('/v1/login-banner/ack', async () => ({ ok: 'ack' }));
    return { app, audited };
  }

  it('blocks a session user with no ack and returns 412 + audit', async () => {
    await publishBanner(dir, 'owner', { enabled: true, title: 'T', body: 'B', severity: 'warning', requireAck: true });
    invalidateLoginBannerCache();
    const { app, audited } = await build();
    const r = await app.inject({
      method: 'POST', url: '/v1/ingest',
      headers: { 'x-test-user': 'u-alice', 'x-test-sid': 'sess-1' },
      payload: {},
    });
    expect(r.statusCode).toBe(412);
    const body = JSON.parse(r.payload);
    expect(body.error).toBe('login-banner-ack-required');
    expect(body.severity).toBe('warning');
    expect(r.headers['x-login-banner-ack-required']).toBe('1');
    expect(audited.some((e) => e.action === 'login-banner.denied')).toBe(true);
  });

  it('permits the ack endpoint, reads, and API-key callers without ack', async () => {
    await publishBanner(dir, 'owner', { enabled: true, title: 'T', body: 'B', severity: 'info', requireAck: true });
    invalidateLoginBannerCache();
    const { app } = await build();
    const read = await app.inject({
      method: 'GET', url: '/v1/search',
      headers: { 'x-test-user': 'u-alice', 'x-test-sid': 'sess-1' },
    });
    expect(read.statusCode).toBe(200);
    const ack = await app.inject({
      method: 'POST', url: '/v1/login-banner/ack',
      headers: { 'x-test-user': 'u-alice', 'x-test-sid': 'sess-1' }, payload: {},
    });
    expect(ack.statusCode).toBe(200);
    const apiKey = await app.inject({
      method: 'POST', url: '/v1/ingest',
      headers: { 'x-test-user': 'bot', 'x-test-via': 'api-key' }, payload: {},
    });
    expect(apiKey.statusCode).toBe(200);
  });

  it('permits writes once the session records a matching ack', async () => {
    await publishBanner(dir, 'owner', { enabled: true, title: 'T', body: 'B', severity: 'info', requireAck: true });
    invalidateLoginBannerCache();
    await recordAck(dir, { userId: 'u-alice', sessionId: 'sess-1', bodyHash: hashBody('B') });
    invalidateLoginBannerCache();
    const { app } = await build();
    const ok = await app.inject({
      method: 'POST', url: '/v1/ingest',
      headers: { 'x-test-user': 'u-alice', 'x-test-sid': 'sess-1' }, payload: {},
    });
    expect(ok.statusCode).toBe(200);
    // A DIFFERENT session by the same user is still blocked. This is the
    // per-session isolation that proves the gate cannot be bypassed by
    // re-using an ack from another browser.
    const other = await app.inject({
      method: 'POST', url: '/v1/ingest',
      headers: { 'x-test-user': 'u-alice', 'x-test-sid': 'sess-2' }, payload: {},
    });
    expect(other.statusCode).toBe(412);
  });

  it('is a no-op when the banner is disabled or requireAck is false', async () => {
    await publishBanner(dir, 'owner', { enabled: true, title: 'T', body: 'B', severity: 'info', requireAck: false });
    invalidateLoginBannerCache();
    const { app } = await build();
    const r = await app.inject({
      method: 'POST', url: '/v1/ingest',
      headers: { 'x-test-user': 'u-alice', 'x-test-sid': 'sess-1' }, payload: {},
    });
    expect(r.statusCode).toBe(200);
  });
});
