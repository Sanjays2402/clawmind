import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { invitationRoutes } from '../src/routes/invitations.js';
import { inviteMember, listMembers } from '../src/services/members.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-invites-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

interface TestUser {
  id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'reader';
  scopes?: string[] | null;
  email?: string | null;
}

function buildApp(opts: { user: TestUser | null }) {
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
      reply.code(403).send({ error: 'forbidden', requiredRole: min });
    }
  });
  app.decorate('requireMfa', async () => undefined);
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });
  app.register(invitationRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('invitations routes', () => {
  it('denies list to viewers', async () => {
    const { app } = buildApp({ user: { id: 'v1', role: 'viewer', scopes: [Scopes.InvitationsRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/invitations' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('blocks admin from minting an owner invite', async () => {
    const { app } = buildApp({ user: { id: 'a1', role: 'admin', scopes: [Scopes.InvitationsManage, Scopes.InvitationsRead] } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      payload: { email: 'new@example.com', role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('owner mints invite, returns raw token once, and audit captures before/after', async () => {
    const { app, audit } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.InvitationsManage, Scopes.InvitationsRead] } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      payload: { email: 'Alice@Example.com', role: 'member', label: 'Eng' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.token).toBeTruthy();
    expect(body.invitation.email).toBe('alice@example.com');
    expect(body.invitation.status).toBe('pending');
    const events = await audit.query({ action: 'invitations.create' });
    expect(events.total).toBe(1);
    const meta = events.events[0]!.meta as { before: unknown; after: { email: string; role: string } };
    expect(meta.before).toBeNull();
    expect(meta.after.email).toBe('alice@example.com');
    expect(meta.after.role).toBe('member');
    await app.close();
  });

  it('rejects accept with email mismatch (link-forwarding defence)', async () => {
    const minter = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.InvitationsManage, Scopes.InvitationsRead] } });
    const minted = await minter.app.inject({
      method: 'POST',
      url: '/v1/invitations',
      payload: { email: 'alice@example.com', role: 'member' },
    });
    const token = JSON.parse(minted.payload).token as string;
    await minter.app.close();

    // bob accepts a link issued to alice — must fail
    const bob = buildApp({ user: { id: 'bob', role: 'viewer', email: 'bob@example.com' } });
    const res = await bob.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('email-mismatch');
    await bob.app.close();
  });

  it('end-to-end: mint, peek, accept binds the new member at the invited role', async () => {
    const minter = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.InvitationsManage, Scopes.InvitationsRead] } });
    const minted = await minter.app.inject({
      method: 'POST',
      url: '/v1/invitations',
      payload: { email: 'alice@example.com', role: 'admin' },
    });
    const token = JSON.parse(minted.payload).token as string;
    await minter.app.close();

    const alice = buildApp({ user: { id: 'alice-uid', role: 'viewer', email: 'alice@example.com' } });
    const peek = await alice.app.inject({ method: 'GET', url: `/v1/invitations/peek?token=${token}` });
    expect(peek.statusCode).toBe(200);
    expect(JSON.parse(peek.payload).invitation.role).toBe('admin');
    const accepted = await alice.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(accepted.payload).assignedRole).toBe('admin');
    // single-use: second redeem fails
    const second = await alice.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token },
    });
    expect(second.statusCode).toBe(409);
    await alice.app.close();

    const members = await listMembers(dir);
    const newMember = members.find((m) => m.userId === 'alice-uid');
    expect(newMember?.role).toBe('admin');
  });

  it('owner can revoke a pending invite and a second revoke conflicts', async () => {
    const minter = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.InvitationsManage, Scopes.InvitationsRead] } });
    const minted = await minter.app.inject({
      method: 'POST',
      url: '/v1/invitations',
      payload: { email: 'carol@example.com', role: 'member' },
    });
    const id = JSON.parse(minted.payload).invitation.id as string;
    const revoked = await minter.app.inject({ method: 'DELETE', url: `/v1/invitations/${id}` });
    expect(revoked.statusCode).toBe(200);
    expect(JSON.parse(revoked.payload).invitation.status).toBe('revoked');
    const again = await minter.app.inject({ method: 'DELETE', url: `/v1/invitations/${id}` });
    expect(again.statusCode).toBe(409);
    await minter.app.close();
  });

  it('dry-run on POST does not persist anything', async () => {
    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.InvitationsManage, Scopes.InvitationsRead] } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/invitations',
      payload: { email: 'dry@example.com', role: 'member', dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).dryRun).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/v1/invitations' });
    expect(JSON.parse(list.payload).invitations).toHaveLength(0);
    await app.close();
  });
});
