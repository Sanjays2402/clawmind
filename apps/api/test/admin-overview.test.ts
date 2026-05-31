import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { adminRoutes } from '../src/routes/admin.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-admin-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

function buildApp(opts: {
  user: { id: string; role: 'owner' | 'reader'; scopes?: string[] | null } | null;
  env?: Record<string, string>;
}) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const audit = new AuditLog(join(dir, 'audit.log'));
  const env = {
    CLAWMIND_OIDC_ISSUER: '',
    CLAWMIND_OIDC_CLIENT_ID: '',
    CLAWMIND_OIDC_CLIENT_SECRET: '',
    CLAWMIND_OIDC_REDIRECT_URI: '',
    CLAWMIND_OIDC_ALLOWED_DOMAINS: '',
    CLAWMIND_OIDC_SCOPES: 'openid email profile',
    ...opts.env,
  };
  app.decorate('clawmind', { audit, dataDir: dir, env } as never);

  app.addHook('preHandler', async (req) => {
    if (opts.user) {
      (req as any).user = { ...opts.user, github: null, via: 'session' };
      (req as any).session = { sessionId: 'sess-current' };
    }
  });
  app.decorate('requireAuth', async (req: any, reply: any) => {
    if (!req.user) reply.code(401).send({ error: 'auth required' });
  });
  app.decorate('requireRole', (role: 'owner' | 'reader') => async (req: any, reply: any) => {
    if (!req.user || req.user.role !== role) reply.code(403).send({ error: 'forbidden' });
  });
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });

  app.register(adminRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('GET /v1/admin/overview', () => {
  it('requires authentication', async () => {
    const { app } = buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('forbids reader role even with admin:read scope', async () => {
    const { app } = buildApp({
      user: { id: 'r', role: 'reader', scopes: [Scopes.AdminRead] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('forbids owner without admin:read on a scoped key (narrow automation cannot enumerate posture)', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.Ask] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns a defaulted overview with no SSO and writes a self-audit row', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AdminRead] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.user).toEqual({ id: 'owner-1', role: 'owner' });
    expect(body.mfa.enrolled).toBe(false);
    expect(body.sso.configured).toBe(false);
    expect(body.sso.issuer).toBeNull();
    expect(body.sessions.active).toBe(0);
    expect(body.apiKeys.total).toBe(0);
    expect(body.webhooks.configured).toBe(0);
    expect(body.ipAllowlist.enabled).toBe(false);
    expect(body.retention.historyDays).toBeNull();

    const after = await audit.query({ action: 'admin.overview' });
    expect(after.total).toBe(1);
    expect(after.events[0]!.actor).toBe('owner-1');
    await app.close();
  });

  it('surfaces SSO settings when OIDC env is configured', async () => {
    const { app } = buildApp({
      user: { id: 'owner-2', role: 'owner', scopes: [Scopes.AdminRead] },
      env: {
        CLAWMIND_OIDC_ISSUER: 'https://login.example.com',
        CLAWMIND_OIDC_CLIENT_ID: 'cid-abc',
        CLAWMIND_OIDC_CLIENT_SECRET: 'shh',
        CLAWMIND_OIDC_REDIRECT_URI: 'https://app/cb',
        CLAWMIND_OIDC_ALLOWED_DOMAINS: 'example.com,partner.io',
      },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.sso.configured).toBe(true);
    expect(body.sso.issuer).toBe('https://login.example.com');
    expect(body.sso.clientId).toBe('cid-abc');
    expect(body.sso.allowedDomains).toEqual(['example.com', 'partner.io']);
    await app.close();
  });

  it('does not leak another tenant: counts only the caller userId', async () => {
    const { app } = buildApp({
      user: { id: 'alice', role: 'owner', scopes: [Scopes.AdminRead] },
    });
    // Seed an unrelated tenant's webhook delivery and session via the
    // services directly. The overview must show zero for alice.
    const { appendDelivery } = await import('../src/services/webhooks.js');
    const { recordLogin } = await import('../src/services/sessions.js');
    await appendDelivery(dir, {
      id: 'd1',
      webhookId: 'wh',
      userId: 'mallory',
      event: 'ask.completed',
      ts: Date.now(),
      url: 'https://x',
      attempt: 1,
      status: 500,
      ok: false,
      durationMs: 10,
    });
    await recordLogin(dir, { sid: 'mallory-sid', userId: 'mallory', ip: '9.9.9.9' });

    const res = await app.inject({ method: 'GET', url: '/v1/admin/overview' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.sessions.active).toBe(0);
    expect(body.webhooks.deliveriesRecent).toBe(0);
    expect(body.webhooks.failuresRecent).toBe(0);
    await app.close();
  });
});
