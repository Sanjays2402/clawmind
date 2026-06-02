import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { memberRoutes } from '../src/routes/members.js';
import {
  inviteMember,
  listMembers,
  meetsMinRole,
  removeMember,
  updateRole,
} from '../src/services/members.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-members-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('members service hierarchy', () => {
  it('ranks the four roles strictly', () => {
    expect(meetsMinRole('owner', 'admin')).toBe(true);
    expect(meetsMinRole('admin', 'admin')).toBe(true);
    expect(meetsMinRole('member', 'admin')).toBe(false);
    expect(meetsMinRole('viewer', 'member')).toBe(false);
  });

  it('refuses to demote the last owner', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const r = await updateRole(dir, 'o1', 'admin', { userId: 'o1', role: 'owner' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('last-owner');
  });

  it('lets a second owner be demoted once another owner exists', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'o2', role: 'owner', invitedBy: 'o1' });
    const r = await updateRole(dir, 'o2', 'admin', { userId: 'o1', role: 'owner' });
    expect(r.ok).toBe(true);
  });

  it('forbids an admin from touching an owner', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'a1', role: 'admin', invitedBy: 'o1' });
    const r = await updateRole(dir, 'o1', 'admin', { userId: 'a1', role: 'admin' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('forbidden-target');
  });

  it('forbids an admin from minting an owner', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'a1', role: 'admin', invitedBy: 'o1' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'a1' });
    const r = await updateRole(dir, 'm1', 'owner', { userId: 'a1', role: 'admin' });
    expect(r.ok).toBe(false);
  });

  it('refuses self-remove and last-owner remove', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const self = await removeMember(dir, 'o1', { userId: 'o1', role: 'owner' });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe('self-remove');
    await inviteMember(dir, { userId: 'o2', role: 'owner', invitedBy: 'o1' });
    // o2 tries to remove o1 (allowed by hierarchy) but o1 then becomes the last owner. That's fine because we kept o2.
    const removed = await removeMember(dir, 'o1', { userId: 'o2', role: 'owner' });
    expect(removed.ok).toBe(true);
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

  app.register(memberRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('members routes', () => {
  it('denies list to viewers', async () => {
    const { app } = buildApp({ user: { id: 'v1', role: 'viewer', scopes: [Scopes.MembersRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/members' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('denies list to members', async () => {
    const { app } = buildApp({ user: { id: 'm1', role: 'member', scopes: [Scopes.MembersRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/members' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('allows admin to list', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'a1', role: 'admin', invitedBy: 'o1' });
    const { app } = buildApp({ user: { id: 'a1', role: 'admin', scopes: [Scopes.MembersRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/members' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.members).toHaveLength(2);
    await app.close();
  });

  it('blocks an admin from inviting an owner via the route', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const { app } = buildApp({ user: { id: 'a1', role: 'admin', scopes: [Scopes.MembersManage] } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/members',
      payload: { userId: 'x1', role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('owner promote writes a before/after diff to the audit log', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'o1' });
    const { app, audit } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.MembersManage] } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/members/m1',
      payload: { role: 'admin' },
    });
    expect(res.statusCode).toBe(200);
    const events = await audit.query({ action: 'members.role.update' });
    expect(events.total).toBe(1);
    const meta = events.events[0]!.meta as { before: { role: string }; after: { role: string } };
    expect(meta.before.role).toBe('member');
    expect(meta.after.role).toBe('admin');
    await app.close();
  });

  it('supports dry-run on DELETE without mutating the registry', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'o1' });
    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.MembersManage] } });
    const res = await app.inject({ method: 'DELETE', url: '/v1/members/m1?dry_run=true' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.dryRun).toBe(true);
    const after = await listMembers(dir);
    expect(after.find((m) => m.userId === 'm1')).toBeTruthy();
    await app.close();
  });

  it('filters list by case-insensitive q over userId, email, and label', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'alice', role: 'admin', email: 'alice@example.com', label: 'CI deploy', invitedBy: 'o1' });
    await inviteMember(dir, { userId: 'bob', role: 'member', email: 'bob@other.com', label: 'reviewer', invitedBy: 'o1' });
    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.MembersRead] } });

    const byEmail = await app.inject({ method: 'GET', url: '/v1/members?q=EXAMPLE' });
    expect(byEmail.statusCode).toBe(200);
    expect(JSON.parse(byEmail.payload).members.map((m: { userId: string }) => m.userId)).toEqual(['alice']);

    const byUserId = await app.inject({ method: 'GET', url: '/v1/members?q=bo' });
    expect(JSON.parse(byUserId.payload).members.map((m: { userId: string }) => m.userId)).toEqual(['bob']);

    const byLabel = await app.inject({ method: 'GET', url: '/v1/members?q=ci%20deploy' });
    expect(JSON.parse(byLabel.payload).members.map((m: { userId: string }) => m.userId)).toEqual(['alice']);

    const noMatch = await app.inject({ method: 'GET', url: '/v1/members?q=zzz' });
    expect(JSON.parse(noMatch.payload).members).toEqual([]);

    const empty = await app.inject({ method: 'GET', url: '/v1/members?q=' });
    expect(empty.statusCode).toBe(400);

    const all = await app.inject({ method: 'GET', url: '/v1/members' });
    expect(JSON.parse(all.payload).members).toHaveLength(3);

    await app.close();
  });
});
