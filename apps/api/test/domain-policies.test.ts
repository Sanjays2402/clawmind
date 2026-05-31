import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { domainPoliciesRoutes } from '../src/routes/domain-policies.js';
import {
  listPolicies,
  replacePolicies,
  resolveDefaultRoleByEmail,
  domainOfEmail,
  normalizeDomain,
} from '../src/services/domain-policies.js';
import { recordSeenAndBootstrap } from '../src/services/members.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-domains-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('domain-policies service', () => {
  it('extracts and normalises domains', () => {
    expect(domainOfEmail('jane@Acme.COM')).toBe('acme.com');
    expect(domainOfEmail('no-at-sign')).toBeNull();
    expect(domainOfEmail('@bare.com')).toBeNull();
    expect(domainOfEmail('jane@')).toBeNull();
    expect(normalizeDomain('@Acme.com')).toBe('acme.com');
    expect(normalizeDomain('bare')).toBeNull();
    expect(normalizeDomain('-bad.com')).toBeNull();
  });

  it('returns null when no enabled policy matches', async () => {
    await replacePolicies(dir, [{ domain: 'acme.com', role: 'member' }]);
    expect(await resolveDefaultRoleByEmail(dir, 'x@other.com')).toBeNull();
    expect(await resolveDefaultRoleByEmail(dir, null)).toBeNull();
  });

  it('returns the policy role when a domain matches and is enabled', async () => {
    await replacePolicies(dir, [
      { domain: 'acme.com', role: 'member' },
      { domain: 'partners.io', role: 'viewer', enabled: false },
    ]);
    expect(await resolveDefaultRoleByEmail(dir, 'jane@ACME.com')).toBe('member');
    expect(await resolveDefaultRoleByEmail(dir, 'guest@partners.io')).toBeNull();
  });

  it('refuses invalid input atomically without partial write', async () => {
    await replacePolicies(dir, [{ domain: 'acme.com', role: 'member' }]);
    const bad = await replacePolicies(dir, [
      { domain: 'good.com', role: 'member' },
      { domain: 'NOT A DOMAIN', role: 'member' },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('invalid-domain');
    const after = await listPolicies(dir);
    expect(after).toHaveLength(1);
    expect(after[0]!.domain).toBe('acme.com');
  });

  it('rejects duplicates within a single replace call', async () => {
    const r = await replacePolicies(dir, [
      { domain: 'acme.com', role: 'member' },
      { domain: 'ACME.com', role: 'viewer' },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('duplicate');
  });

  it('drives recordSeenAndBootstrap to assign the matched role to a new user', async () => {
    await replacePolicies(dir, [{ domain: 'acme.com', role: 'viewer' }]);
    // First user always becomes owner regardless of policy.
    const first = await recordSeenAndBootstrap(dir, { userId: 'first', email: 'owner@somewhere.com' });
    expect(first.role).toBe('owner');
    // Second user with matching domain picks up the policy role.
    const policyRole = await resolveDefaultRoleByEmail(dir, 'jane@acme.com');
    const second = await recordSeenAndBootstrap(dir, {
      userId: 'jane',
      email: 'jane@acme.com',
      defaultRole: policyRole ?? undefined,
    });
    expect(second.role).toBe('viewer');
    // Third user without matching domain falls back to member.
    const third = await recordSeenAndBootstrap(dir, {
      userId: 'mallory',
      email: 'mallory@other.com',
      defaultRole: (await resolveDefaultRoleByEmail(dir, 'mallory@other.com')) ?? undefined,
    });
    expect(third.role).toBe('member');
  });

  it('never silently promotes existing members when a policy is added later', async () => {
    await recordSeenAndBootstrap(dir, { userId: 'jane', email: 'jane@acme.com' }); // becomes owner (first user)
    await recordSeenAndBootstrap(dir, { userId: 'bob', email: 'bob@acme.com' });   // member
    await replacePolicies(dir, [{ domain: 'acme.com', role: 'viewer' }]);
    const policyRole = await resolveDefaultRoleByEmail(dir, 'bob@acme.com');
    const again = await recordSeenAndBootstrap(dir, {
      userId: 'bob',
      email: 'bob@acme.com',
      defaultRole: policyRole ?? undefined,
    });
    expect(again.role).toBe('member'); // unchanged
  });
});

function buildApp(opts: {
  user: { id: string; role: 'owner' | 'admin' | 'member' | 'viewer' | 'reader'; scopes?: string[] | null } | null;
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

  app.register(domainPoliciesRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('domain-policies routes', () => {
  it('denies read to members and viewers', async () => {
    const { app } = buildApp({ user: { id: 'm1', role: 'member', scopes: [Scopes.DomainPoliciesRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/domain-policies' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('lets admins read', async () => {
    await replacePolicies(dir, [{ domain: 'acme.com', role: 'member' }]);
    const { app } = buildApp({ user: { id: 'a1', role: 'admin', scopes: [Scopes.DomainPoliciesRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/domain-policies' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.policies).toHaveLength(1);
    expect(body.assignableRoles).toEqual(['member', 'viewer']);
    await app.close();
  });

  it('owner PUT writes a before/after diff to the audit log', async () => {
    await replacePolicies(dir, [{ domain: 'old.com', role: 'member' }]);
    const { app, audit } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.DomainPoliciesManage] } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/domain-policies',
      payload: { policies: [{ domain: 'acme.com', role: 'viewer', enabled: true }] },
    });
    expect(res.statusCode).toBe(200);
    const events = await audit.query({ action: 'domain_policies.replace' });
    expect(events.total).toBe(1);
    const meta = events.events[0]!.meta as {
      before: Array<{ domain: string }>; after: Array<{ domain: string; role: string }>;
    };
    expect(meta.before.map((p) => p.domain)).toEqual(['old.com']);
    expect(meta.after).toEqual([{ domain: 'acme.com', role: 'viewer', enabled: true }]);
    await app.close();
  });

  it('rejects bad domains with 400 and audit-logs the denial', async () => {
    const { app, audit } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.DomainPoliciesManage] } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/domain-policies',
      payload: { policies: [{ domain: 'bare-host', role: 'member' }] },
    });
    expect(res.statusCode).toBe(400);
    const events = await audit.query({ action: 'domain_policies.replace.denied' });
    expect(events.total).toBe(1);
    await app.close();
  });

  it('honours dryRun without writing', async () => {
    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.DomainPoliciesManage] } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/domain-policies',
      payload: { dryRun: true, policies: [{ domain: 'acme.com', role: 'member' }] },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.dryRun).toBe(true);
    expect(await listPolicies(dir)).toHaveLength(0);
    await app.close();
  });

  it('blocks members from PUT even with the right scope (RBAC isolation)', async () => {
    const { app } = buildApp({ user: { id: 'm1', role: 'member', scopes: [Scopes.DomainPoliciesManage] } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/domain-policies',
      payload: { policies: [{ domain: 'acme.com', role: 'member' }] },
    });
    expect(res.statusCode).toBe(403);
    expect(await listPolicies(dir)).toHaveLength(0);
    await app.close();
  });
});
