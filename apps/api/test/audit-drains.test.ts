import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import {
  createDrain,
  listDrains,
  rotateSecret,
  runOnce,
  signBody,
  verifySignature,
  buildBody,
  validateUrl,
  nextRetryDelayMs,
} from '../src/services/audit-drains.js';
import { auditDrainsRoutes } from '../src/routes/audit-drains.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-drains-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('audit-drains service', () => {
  it('rejects unsupported schemes and embedded credentials', () => {
    expect(validateUrl('ftp://example.com').ok).toBe(false);
    expect(validateUrl('https://user:pass@example.com/x').ok).toBe(false);
    expect(validateUrl('https://siem.example.com/ingest').ok).toBe(true);
  });

  it('blocks loopback by default and allows it under the dev override', () => {
    const prev = process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS;
    delete process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS;
    expect(validateUrl('http://127.0.0.1:9000/x').ok).toBe(false);
    process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS = '1';
    expect(validateUrl('http://127.0.0.1:9000/x').ok).toBe(true);
    if (prev === undefined) delete process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS;
    else process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS = prev;
  });

  it('signs a body the receiver can verify and rejects tampering', () => {
    const body = buildBody(
      { drainId: 'd', sequence: 1, ts: 1, count: 1, cursorBefore: null, cursorAfter: { ts: 1, id: 'a' } },
      [{ id: 'a', ts: 1, actor: 'x', action: 'y', resource: '/z' }],
    );
    const sig = signBody('shhh', body);
    expect(verifySignature('shhh', body, sig)).toBe(true);
    expect(verifySignature('shhh', body + 'tamper', sig)).toBe(false);
    expect(verifySignature('other', body, sig)).toBe(false);
  });

  it('returns a public projection that hides the shared secret', async () => {
    const created = await createDrain(dir, 'owner-1', {
      kind: 'generic',
      url: 'https://siem.example.com/in',
    });
    expect(created.ok).toBe(true);
    const listed = await listDrains(dir);
    expect(listed).toHaveLength(1);
    // No `secret` field on the public projection at all.
    expect(Object.keys(listed[0])).not.toContain('secret');
    expect(listed[0].secretFingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('exponential backoff is monotonic and bounded under one hour', () => {
    expect(nextRetryDelayMs(1)).toBeLessThan(nextRetryDelayMs(3));
    expect(nextRetryDelayMs(100)).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('delivers a batch, advances the cursor, and resets the failure counter', async () => {
    const created = await createDrain(dir, 'owner-1', {
      kind: 'generic',
      url: 'https://siem.example.com/in',
    });
    if (!created.ok) throw new Error('setup');
    const secret = created.drain.secret;

    const events = [
      { id: 'a', ts: 100, actor: 'u', action: 'x', resource: '/r' },
      { id: 'b', ts: 101, actor: 'u', action: 'y', resource: '/r' },
    ];
    let receivedSig: string | null = null;
    let receivedBody: string | null = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      receivedSig = String(
        (init?.headers as Record<string, string>)['x-clawmind-signature'],
      );
      receivedBody = String(init?.body ?? '');
      return new Response('ok', { status: 202 });
    };

    async function* iter() {
      for (const e of events) yield e;
    }
    const res = await runOnce({
      dataDir: dir,
      iterate: () => iter(),
      fetchImpl: fakeFetch,
    });
    expect(res.delivered).toBe(1);
    expect(res.failed).toBe(0);
    expect(receivedSig).toMatch(/^sha256=[0-9a-f]+$/);
    // Receiver verifies signature against the shared secret using the
    // exact body we sent. This is the procurement-relevant guarantee.
    const sig = receivedSig!.replace(/^sha256=/, '');
    expect(verifySignature(secret, receivedBody!, sig)).toBe(true);

    // Cursor advanced to last event so a second pass with no new events
    // is a no-op.
    const second = await runOnce({
      dataDir: dir,
      iterate: () => iter(),
      fetchImpl: fakeFetch,
    });
    expect(second.delivered).toBe(0);
  });

  it('dead-letters a batch after six consecutive failures and advances past it', async () => {
    const created = await createDrain(dir, 'owner-1', {
      kind: 'generic',
      url: 'https://siem.example.com/in',
    });
    if (!created.ok) throw new Error('setup');
    const events = [{ id: 'a', ts: 1, actor: 'u', action: 'x', resource: '/r' }];
    async function* iter() {
      for (const e of events) yield e;
    }
    const fail: typeof fetch = async () => new Response('boom', { status: 500 });
    // We control "now" so we can blow past the exponential backoff gates
    // and trigger six attempts deterministically.
    let now = 1_000_000_000_000;
    for (let i = 0; i < 6; i++) {
      const r = await runOnce({
        dataDir: dir,
        iterate: () => iter(),
        fetchImpl: fail,
        now: () => now,
      });
      expect(r.failed).toBe(1);
      // Jump past the next retry window.
      now += nextRetryDelayMs(i + 1) + 1;
    }
    // After six failures the batch should have been dead-lettered and the
    // cursor advanced so a new event would not pile onto the same wedge.
    const drains = await listDrains(dir);
    expect(drains[0].dropped).toBe(1);
    expect(drains[0].consecutiveFailures).toBe(0);
    expect(drains[0].lastCursor).toEqual({ ts: 1, id: 'a' });
  });

  it('rotateSecret invalidates the previous signature', async () => {
    const c = await createDrain(dir, 'owner-1', {
      kind: 'generic',
      url: 'https://siem.example.com/in',
    });
    if (!c.ok) throw new Error('setup');
    const old = c.drain.secret;
    const r = await rotateSecret(dir, c.drain.id, 'owner-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.secret).not.toBe(old);
    const body = 'x';
    expect(signBody(old, body)).not.toBe(signBody(r.secret, body));
  });
});

// Route-level test: exercises auth + scope + MFA gating and proves that
// a non-owner cannot create a drain. The MFA decorator is stubbed to
// fail unless the caller is marked mfaVerified so we cover the "owner
// without step-up" case explicitly.
function buildApp(opts: {
  user:
    | { id: string; role: 'owner' | 'admin' | 'reader'; scopes?: string[] | null; mfaVerified?: boolean }
    | null;
}) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const writes: unknown[] = [];
  app.decorate('clawmind', {
    dataDir: dir,
    audit: {
      write: async (e: unknown) => {
        writes.push(e);
      },
      iterate: async function* () {
        /* no events */
      },
    },
  } as never);

  app.addHook('preHandler', async (req) => {
    if (opts.user) req.user = { ...opts.user, github: null, via: 'session' } as never;
  });
  app.decorate('requireAuth', async (req: any, reply: any) => {
    if (!req.user) reply.code(401).send({ error: 'auth required' });
  });
  app.decorate('requireRole', (role: string) => async (req: any, reply: any) => {
    if (!req.user || req.user.role !== role) reply.code(403).send({ error: 'forbidden' });
  });
  app.decorate('requireMinRole', (role: string) => async (req: any, reply: any) => {
    const rank: Record<string, number> = { owner: 4, admin: 3, member: 2, viewer: 1, reader: 0 };
    if (!req.user || (rank[req.user.role] ?? -1) < (rank[role] ?? 0)) {
      reply.code(403).send({ error: 'forbidden' });
    }
  });
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });
  app.decorate('requireMfa', async (req: any, reply: any) => {
    if (!req.user?.mfaVerified) reply.code(401).send({ error: 'mfa_required' });
  });

  app.register(auditDrainsRoutes, { prefix: '/v1' });
  return { app, writes };
}

describe('audit-drains routes', () => {
  it('admin cannot create a drain even with manage scope (owner-only)', async () => {
    const { app } = buildApp({
      user: { id: 'a', role: 'admin', scopes: [Scopes.AuditDrainsManage], mfaVerified: true },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audit/drains',
      payload: { kind: 'generic', url: 'https://siem.example.com/in' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('owner without MFA step-up gets 401 from requireMfa', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.AuditDrainsManage], mfaVerified: false },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audit/drains',
      payload: { kind: 'generic', url: 'https://siem.example.com/in' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('owner with MFA creates a drain, secret returned once, audit logged', async () => {
    const { app, writes } = buildApp({
      user: {
        id: 'o',
        role: 'owner',
        scopes: [Scopes.AuditDrainsManage, Scopes.AuditDrainsRead],
        mfaVerified: true,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audit/drains',
      payload: { kind: 'splunk-hec', url: 'https://splunk.example.com/services/collector' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.drain.id).toMatch(/^drn_/);
    // List with admin+read scope should not echo the secret on subsequent reads.
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/audit/drains',
    });
    expect(listRes.statusCode).toBe(200);
    const listed = JSON.parse(listRes.payload);
    expect(listed.drains[0].secretFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(listed.drains[0]).not.toHaveProperty('secret');
    // audit.write was called with audit-drain.create.
    expect(
      (writes as Array<{ action: string }>).some((w) => w.action === 'audit-drain.create'),
    ).toBe(true);
    await app.close();
  });

  it('rejects a payload that points at loopback', async () => {
    const prev = process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS;
    delete process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS;
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.AuditDrainsManage], mfaVerified: true },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/audit/drains',
      payload: { kind: 'generic', url: 'http://127.0.0.1:9000/x' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
    if (prev !== undefined) process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS = prev;
  });
});
