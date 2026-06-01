import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { postureRoutes } from '../src/routes/posture.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-posture-'));
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
  app.register(postureRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('GET /v1/posture', () => {
  it('requires authentication', async () => {
    const { app } = buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url: '/v1/posture' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('forbids reader role', async () => {
    const { app } = buildApp({
      user: { id: 'r', role: 'reader', scopes: [Scopes.PostureRead] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/posture' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('forbids owner without posture:read on a scoped key', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.Ask] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/posture' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns a fresh-install posture report with audit row', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.PostureRead] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/posture' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.counts.total).toBe(body.controls.length);
    expect(body.counts.pass + body.counts.warn + body.counts.fail).toBe(body.counts.total);
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);
    // Fresh install: at minimum SSO is not configured, expect a fail
    const sso = body.controls.find((c: any) => c.id === 'sso.oidc');
    expect(sso.status).toBe('fail');
    // Audit row written
    const q = await audit.query({ limit: 10 });
    const ev = q.events.find((e: any) => e.action === 'posture.read');
    expect(ev).toBeDefined();
  });
});
