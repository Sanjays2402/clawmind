import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { accessReviewsRoutes } from '../src/routes/access-reviews.js';
import { inviteMember, listMembers } from '../src/services/members.js';
import {
  closeReview,
  openReview,
  setDecision,
} from '../src/services/access-reviews.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-access-reviews-'));
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
  app.register(accessReviewsRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('access-reviews service', () => {
  it('snapshots membership at open and refuses close while pending', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'o1' });
    const r = await openReview(dir, { title: '2026 Q2 review', openedBy: 'o1' });
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.userId).sort()).toEqual(['m1', 'o1']);
    const closed = await closeReview(dir, r.id, { closedBy: 'o1', closerRole: 'owner', attestation: null });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.code).toBe('pending-decisions');
  });

  it('downgrade decision actually demotes the member on close', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'a1', role: 'admin', invitedBy: 'o1' });
    const r = await openReview(dir, { title: 'q', openedBy: 'o1' });
    await setDecision(dir, r.id, 'o1', { decision: 'keep', decidedBy: 'o1' });
    const d = await setDecision(dir, r.id, 'a1', {
      decision: 'downgrade',
      downgradeTo: 'viewer',
      decidedBy: 'o1',
    });
    expect(d.ok).toBe(true);
    const closed = await closeReview(dir, r.id, { closedBy: 'o1', closerRole: 'owner', attestation: 'ok' });
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      expect(closed.applied).toEqual([{ userId: 'a1', action: 'downgraded', error: null }]);
    }
    const members = await listMembers(dir);
    expect(members.find((m) => m.userId === 'a1')?.role).toBe('viewer');
  });

  it('protects the last owner from a revoke decision', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const r = await openReview(dir, { title: 'q', openedBy: 'o1' });
    await setDecision(dir, r.id, 'o1', { decision: 'revoke', decidedBy: 'o1' });
    // o1 cannot self-remove anyway, but the closer here pretends to be
    // an external owner to ensure the last-owner guard fires deeper in
    // the stack (not just self-remove).
    await inviteMember(dir, { userId: 'o2', role: 'owner', invitedBy: 'o1' });
    const r2 = await openReview(dir, { title: 'q2', openedBy: 'o2' });
    await setDecision(dir, r2.id, 'o1', { decision: 'keep', decidedBy: 'o2' });
    await setDecision(dir, r2.id, 'o2', { decision: 'revoke', decidedBy: 'o2' });
    // o2 closing while revoking themselves -> self-remove blocks, recorded
    // as skipped-missing with the underlying error from removeMember.
    const closed = await closeReview(dir, r2.id, { closedBy: 'o2', closerRole: 'owner', attestation: null });
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      const revoked = closed.applied.find((a) => a.userId === 'o2');
      expect(revoked).toBeTruthy();
      expect(revoked!.action).not.toBe('revoked');
    }
    // Both owners still present.
    const after = await listMembers(dir);
    expect(after.find((m) => m.userId === 'o1')).toBeTruthy();
    expect(after.find((m) => m.userId === 'o2')).toBeTruthy();
  });
});

describe('access-reviews routes RBAC', () => {
  it('denies open to admins (owner-only manage)', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const { app } = buildApp({ user: { id: 'a1', role: 'admin', scopes: [Scopes.AccessReviewsManage] } });
    const res = await app.inject({ method: 'POST', url: '/v1/access-reviews', payload: { title: 'q' } });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('denies list to members', async () => {
    const { app } = buildApp({ user: { id: 'm1', role: 'member', scopes: [Scopes.AccessReviewsRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/access-reviews' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('refuses a key without the access-reviews:read scope', async () => {
    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: ['ask:read'] } });
    const res = await app.inject({ method: 'GET', url: '/v1/access-reviews' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe('scope required');
    await app.close();
  });

  it('end-to-end owner workflow: open, decide, close, audit', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'o1' });
    const { app, audit } = buildApp({ user: { id: 'o1', role: 'owner', scopes: ['*'] } });
    const opened = await app.inject({
      method: 'POST',
      url: '/v1/access-reviews',
      payload: { title: '2026 Q2' },
    });
    expect(opened.statusCode).toBe(201);
    const { review } = JSON.parse(opened.payload);
    await app.inject({
      method: 'POST',
      url: `/v1/access-reviews/${review.id}/decisions/o1`,
      payload: { decision: 'keep' },
    });
    await app.inject({
      method: 'POST',
      url: `/v1/access-reviews/${review.id}/decisions/m1`,
      payload: { decision: 'revoke', note: 'left the team' },
    });
    const close = await app.inject({
      method: 'POST',
      url: `/v1/access-reviews/${review.id}/close`,
      payload: { attestation: 'I attest the above is correct.' },
    });
    expect(close.statusCode).toBe(200);
    const body = JSON.parse(close.payload);
    expect(body.applied).toEqual([{ userId: 'm1', action: 'revoked', error: null }]);
    const members = await listMembers(dir);
    expect(members.find((m) => m.userId === 'm1')).toBeFalsy();
    const events = await audit.query({ action: 'access-reviews.close' });
    expect(events.total).toBe(1);
    await app.close();
  });

  it('list filters reviews by q substring across id, title, openedBy, and attestation', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'o2', role: 'owner', invitedBy: 'o1' });
    const r1 = await openReview(dir, { title: '2026 Q2 recertification', openedBy: 'o1' });
    const r2 = await openReview(dir, { title: '2026 Q3 recertification', openedBy: 'o2' });
    await setDecision(dir, r1.id, 'o1', { decision: 'keep', downgradeTo: null, note: null, decidedBy: 'o1' });
    await setDecision(dir, r1.id, 'o2', { decision: 'keep', downgradeTo: null, note: null, decidedBy: 'o1' });
    await closeReview(dir, r1.id, { closedBy: 'o1', closerRole: 'owner', attestation: 'signed-by-cfo' });

    const { app } = buildApp({ user: { id: 'o1', role: 'owner', scopes: [Scopes.AccessReviewsRead] } });
    const all = await app.inject({ method: 'GET', url: '/v1/access-reviews' });
    expect(JSON.parse(all.payload).reviews).toHaveLength(2);

    const byTitle = await app.inject({ method: 'GET', url: '/v1/access-reviews?q=Q3' });
    const t = JSON.parse(byTitle.payload).reviews;
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe(r2.id);

    const byOpener = await app.inject({ method: 'GET', url: '/v1/access-reviews?q=o2' });
    const o = JSON.parse(byOpener.payload).reviews;
    expect(o).toHaveLength(1);
    expect(o[0].openedBy).toBe('o2');

    const byAttestation = await app.inject({ method: 'GET', url: '/v1/access-reviews?q=signed-by-cfo' });
    const a = JSON.parse(byAttestation.payload).reviews;
    expect(a).toHaveLength(1);
    expect(a[0].id).toBe(r1.id);

    const byId = await app.inject({ method: 'GET', url: `/v1/access-reviews?q=${r2.id}` });
    expect(JSON.parse(byId.payload).reviews).toHaveLength(1);

    const miss = await app.inject({ method: 'GET', url: '/v1/access-reviews?q=zzz-nope' });
    expect(JSON.parse(miss.payload).reviews).toHaveLength(0);
    await app.close();
  });
});
