import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { offboardingRoutes } from '../src/routes/offboarding.js';
import { memberRoutes } from '../src/routes/members.js';
import { inviteMember } from '../src/services/members.js';
import { issueKey, loadKeys } from '../src/services/api-keys.js';
import { recordLogin, listForUser as listSessions } from '../src/services/sessions.js';
import { findOrphanedKeys, sweepUser } from '../src/services/offboarding.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-offboarding-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

function buildApp(opts: {
  user: { id: string; role: 'owner' | 'admin' | 'member' | 'viewer'; scopes?: string[] | null } | null;
}) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const audit = new AuditLog(join(dir, 'audit.log'));
  app.decorate('clawmind', { audit, dataDir: dir } as never);
  app.addHook('preHandler', async (req) => {
    if (opts.user) (req as { user?: unknown }).user = { ...opts.user, github: null, via: 'session' };
  });
  app.decorate('requireAuth', async (req: any, reply: any) => {
    if (!req.user) reply.code(401).send({ error: 'auth required' });
  });
  app.decorate('requireMinRole', (min: string) => async (req: any, reply: any) => {
    const rank: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1, reader: 1 };
    if (!req.user) return reply.code(401).send({ error: 'auth required' });
    if ((rank[req.user.role] ?? 0) < (rank[min] ?? 0)) {
      reply.code(403).send({ error: 'forbidden', requiredRole: min, currentRole: req.user.role });
    }
  });
  app.decorate('requireMfa', async () => undefined);
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });
  app.register(offboardingRoutes, { prefix: '/v1' });
  app.register(memberRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('offboarding sweep', () => {
  it('revokes a removed member\'s API keys and sessions atomically', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'leaver', role: 'member', invitedBy: 'o1' });
    const k = await issueKey(dir, { userId: 'leaver', label: 'ci', role: 'reader', expiresAt: null });
    expect(k.record.revokedAt).toBeNull();
    await recordLogin(dir, { userId: 'leaver', sid: 'sid-1', userAgent: 'curl', ip: '127.0.0.1' });
    await recordLogin(dir, { userId: 'leaver', sid: 'sid-2', userAgent: 'curl', ip: '127.0.0.1' });

    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: null } });
    const res = await app.inject({ method: 'DELETE', url: '/v1/members/leaver' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { offboarding: { keysRevoked: number; sessionsRevoked: number } };
    expect(body.offboarding.keysRevoked).toBe(1);
    expect(body.offboarding.sessionsRevoked).toBe(2);

    const keys = await loadKeys(dir);
    expect(keys.find((kk) => kk.id === k.record.id)?.revokedAt).not.toBeNull();
    const sessions = await listSessions(dir, 'leaver');
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    await app.close();
  });

  it('idempotent: a second sweep of the same user reports zero', async () => {
    await inviteMember(dir, { userId: 'u1', role: 'member', invitedBy: 'bootstrap' });
    await issueKey(dir, { userId: 'u1', label: 'a', role: 'reader', expiresAt: null });
    const r1 = await sweepUser(dir, 'u1');
    expect(r1.keysRevoked).toBe(1);
    const r2 = await sweepUser(dir, 'u1');
    expect(r2.keysRevoked).toBe(0);
    expect(r2.sessionsRevoked).toBe(0);
  });

  it('GET /offboarding/orphans surfaces a key whose user is no longer a member', async () => {
    // Issue a key for someone who was never registered; this simulates a
    // pre-sweep orphan that survived an older removal path.
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await issueKey(dir, { userId: 'ghost', label: 'old', role: 'reader', expiresAt: null });
    const orphans = await findOrphanedKeys(dir);
    expect(orphans.map((o) => o.userId)).toEqual(['ghost']);

    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: null } });
    const res = await app.inject({ method: 'GET', url: '/v1/offboarding/orphans' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { count: number; orphans: Array<{ userId: string }> };
    expect(body.count).toBe(1);
    expect(body.orphans[0]?.userId).toBe('ghost');
    await app.close();
  });

  it('viewer cannot list orphans (RBAC enforcement)', async () => {
    const { app } = buildApp({ user: { id: 'v1', role: 'viewer', scopes: null } });
    const res = await app.inject({ method: 'GET', url: '/v1/offboarding/orphans' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('admin cannot revoke orphan (owner-only manage)', async () => {
    await issueKey(dir, { userId: 'ghost', label: 'x', role: 'reader', expiresAt: null });
    const orphans = await findOrphanedKeys(dir);
    const target = orphans[0]!;
    const { app } = buildApp({ user: { id: 'a1', role: 'admin', scopes: null } });
    const res = await app.inject({ method: 'POST', url: `/v1/offboarding/orphans/${target.id}/revoke` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
