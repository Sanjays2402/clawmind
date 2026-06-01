import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  publishPolicy,
  recordAcceptance,
  getPolicy,
  hasUserAcceptedCurrent,
  hashBody,
  invalidateAcceptableUseCache,
  isAcceptableUseAllowedPath,
  AcceptableUseValidationError,
} from '../src/services/acceptable-use.js';
import { acceptableUsePlugin } from '../src/plugins/acceptable-use.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-aup-'));
  invalidateAcceptableUseCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('acceptable-use service', () => {
  it('returns an empty policy when none has been published', async () => {
    const p = await getPolicy(dir);
    expect(p.version).toBe('');
    expect(p.bodyHash).toBeNull();
    expect(p.requireAcceptance).toBe(false);
  });

  it('publishes a policy and computes a stable body hash', async () => {
    const p = await publishPolicy(dir, 'owner-1', {
      version: '1.0',
      title: 'AUP',
      body: 'Do not abuse the service.',
      requireAcceptance: true,
    });
    expect(p.version).toBe('1.0');
    expect(p.bodyHash).toBe(hashBody('Do not abuse the service.'));
    expect(p.publishedBy).toBe('owner-1');
    expect(p.requireAcceptance).toBe(true);
  });

  it('rejects oversize or empty fields', async () => {
    await expect(
      publishPolicy(dir, 'owner', {
        version: '',
        title: 't',
        body: 'b',
        requireAcceptance: false,
      }),
    ).rejects.toBeInstanceOf(AcceptableUseValidationError);
    await expect(
      publishPolicy(dir, 'owner', {
        version: '1',
        title: 't',
        body: 'x'.repeat(70_000),
        requireAcceptance: false,
      }),
    ).rejects.toBeInstanceOf(AcceptableUseValidationError);
  });

  it('records an acceptance and reports hasUserAcceptedCurrent', async () => {
    const policy = await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 'AUP',
      body: 'body',
      requireAcceptance: true,
    });
    expect(await hasUserAcceptedCurrent(dir, 'alice')).toBe(false);
    const r = await recordAcceptance(dir, {
      userId: 'alice',
      version: '1.0',
      bodyHash: policy.bodyHash!,
      ip: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(r.kind).toBe('ok');
    expect(await hasUserAcceptedCurrent(dir, 'alice')).toBe(true);
    expect(await hasUserAcceptedCurrent(dir, 'bob')).toBe(false);
  });

  it('rejects acceptance for a stale version or hash', async () => {
    const policy = await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 't',
      body: 'b',
      requireAcceptance: true,
    });
    const wrong = await recordAcceptance(dir, {
      userId: 'alice',
      version: '0.9',
      bodyHash: policy.bodyHash!,
    });
    expect(wrong.kind).toBe('version-mismatch');
    const bad = await recordAcceptance(dir, {
      userId: 'alice',
      version: '1.0',
      bodyHash: 'a'.repeat(64),
    });
    expect(bad.kind).toBe('hash-mismatch');
  });

  it('invalidates acceptances when a new version is published', async () => {
    const v1 = await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 't',
      body: 'b1',
      requireAcceptance: true,
    });
    await recordAcceptance(dir, {
      userId: 'alice',
      version: '1.0',
      bodyHash: v1.bodyHash!,
    });
    expect(await hasUserAcceptedCurrent(dir, 'alice')).toBe(true);
    await publishPolicy(dir, 'owner', {
      version: '2.0',
      title: 't',
      body: 'b2',
      requireAcceptance: true,
    });
    expect(await hasUserAcceptedCurrent(dir, 'alice')).toBe(false);
  });
});

describe('acceptable-use path allowlist', () => {
  it('always allows reads', () => {
    expect(isAcceptableUseAllowedPath('GET', '/v1/anything')).toBe(true);
    expect(isAcceptableUseAllowedPath('HEAD', '/v1/anything')).toBe(true);
  });
  it('allows the accept endpoint and auth/mfa/sessions on writes', () => {
    expect(isAcceptableUseAllowedPath('POST', '/v1/acceptable-use/accept')).toBe(true);
    expect(isAcceptableUseAllowedPath('POST', '/v1/auth/login')).toBe(true);
    expect(isAcceptableUseAllowedPath('POST', '/v1/mfa/totp/enrol')).toBe(true);
    expect(isAcceptableUseAllowedPath('POST', '/v1/sessions/revoke')).toBe(true);
  });
  it('blocks generic writes', () => {
    expect(isAcceptableUseAllowedPath('POST', '/v1/docs')).toBe(false);
    expect(isAcceptableUseAllowedPath('DELETE', '/v1/tags/x')).toBe(false);
  });
});

describe('acceptable-use gate plugin', () => {
  async function buildApp(opts: {
    user: { id: string; role: string; via: string } | null;
  }) {
    const app = Fastify();
    (app as any).decorate('clawmind', {
      dataDir: dir,
      audit: { write: async () => undefined },
    });
    app.addHook('preHandler', async (req) => {
      (req as any).user = opts.user;
    });
    await app.register(acceptableUsePlugin);
    app.post('/v1/docs', async () => ({ ok: true }));
    app.get('/v1/docs', async () => ({ ok: true }));
    app.post('/v1/acceptable-use/accept', async () => ({ ok: true }));
    return app;
  }

  it('returns 412 for a session user that has not accepted', async () => {
    await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 't',
      body: 'b',
      requireAcceptance: true,
    });
    invalidateAcceptableUseCache();
    const app = await buildApp({ user: { id: 'alice', role: 'member', via: 'session' } });
    const res = await app.inject({ method: 'POST', url: '/v1/docs' });
    expect(res.statusCode).toBe(412);
    expect(res.headers['x-acceptable-use-required']).toBe('1');
    expect(res.headers['x-acceptable-use-version']).toBe('1.0');
    expect(res.json().error).toBe('acceptable-use-required');
    await app.close();
  });

  it('passes once the user has accepted the current version', async () => {
    const policy = await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 't',
      body: 'b',
      requireAcceptance: true,
    });
    await recordAcceptance(dir, {
      userId: 'alice',
      version: '1.0',
      bodyHash: policy.bodyHash!,
    });
    invalidateAcceptableUseCache();
    const app = await buildApp({ user: { id: 'alice', role: 'member', via: 'session' } });
    const res = await app.inject({ method: 'POST', url: '/v1/docs' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('exempts api-key callers and workspace owners', async () => {
    await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 't',
      body: 'b',
      requireAcceptance: true,
    });
    invalidateAcceptableUseCache();
    const apiKeyApp = await buildApp({
      user: { id: 'svc', role: 'member', via: 'api-key' },
    });
    expect((await apiKeyApp.inject({ method: 'POST', url: '/v1/docs' })).statusCode).toBe(200);
    await apiKeyApp.close();
    const ownerApp = await buildApp({
      user: { id: 'owner', role: 'owner', via: 'session' },
    });
    expect((await ownerApp.inject({ method: 'POST', url: '/v1/docs' })).statusCode).toBe(200);
    await ownerApp.close();
  });

  it('allows reads and the accept endpoint even when blocking', async () => {
    await publishPolicy(dir, 'owner', {
      version: '1.0',
      title: 't',
      body: 'b',
      requireAcceptance: true,
    });
    invalidateAcceptableUseCache();
    const app = await buildApp({ user: { id: 'alice', role: 'member', via: 'session' } });
    expect((await app.inject({ method: 'GET', url: '/v1/docs' })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/acceptable-use/accept' })).statusCode,
    ).toBe(200);
    await app.close();
  });
});
