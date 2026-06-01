import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { auditRoutes } from '../src/routes/audit.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-audit-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('AuditLog.query', () => {
  it('returns an empty result when the file does not exist yet', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    const res = await log.query();
    expect(res).toEqual({ total: 0, events: [] });
  });

  it('round-trips writes and returns them newest first', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    const a = await log.write({ actor: 'alice', action: 'login', resource: '/v1/x' });
    // small gap so timestamps differ deterministically
    await new Promise((r) => setTimeout(r, 5));
    const b = await log.write({ actor: 'bob', action: 'logout', resource: '/v1/y' });
    const res = await log.query();
    expect(res.total).toBe(2);
    expect(res.events.map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('filters by actor, action substring and resource prefix', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'alice', action: 'lifecycle.export', resource: '/v1/me/export' });
    await log.write({ actor: 'bob', action: 'lifecycle.delete', resource: '/v1/me/data' });
    await log.write({ actor: 'alice', action: 'keys.issue', resource: '/v1/keys' });

    expect((await log.query({ actor: 'alice' })).total).toBe(2);
    expect((await log.query({ action: 'lifecycle' })).total).toBe(2);
    expect((await log.query({ resource: '/v1/me' })).total).toBe(2);
    expect((await log.query({ actor: 'alice', resource: '/v1/keys' })).total).toBe(1);
  });

  it('honours since / until time windows and limit/offset paging', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    for (let i = 0; i < 5; i++) {
      await log.write({ actor: 'u', action: `n${i}`, resource: '/v1/x' });
      await new Promise((r) => setTimeout(r, 2));
    }
    const all = await log.query();
    expect(all.total).toBe(5);
    const mid = all.events[2]!.ts;
    expect((await log.query({ since: mid })).total).toBe(3);
    expect((await log.query({ until: mid })).total).toBe(2);

    const page1 = await log.query({ limit: 2, offset: 0 });
    const page2 = await log.query({ limit: 2, offset: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page2.events).toHaveLength(2);
    expect(page1.events[0]!.id).not.toBe(page2.events[0]!.id);
  });

  it('skips malformed JSONL lines without throwing', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'a', action: 'ok', resource: '/x' });
    // Manually append garbage to simulate a partial write or external tampering.
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(dir, 'audit.log'), '{not json\n', 'utf8');
    await log.write({ actor: 'b', action: 'ok', resource: '/y' });
    const res = await log.query();
    expect(res.total).toBe(2);
  });
});

// Route-level test: build a minimal Fastify app with the audit plugin and
// a fake auth decorator stack so we exercise the actual handler, scope
// gating, and self-logging behaviour.
function buildApp(opts: { user: { id: string; role: 'owner' | 'reader'; scopes?: string[] | null } | null }) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const audit = new AuditLog(join(dir, 'audit.log'));
  app.decorate('clawmind', { audit, dataDir: dir, env: { CLAWMIND_SESSION_SECRET: 'test-secret' } } as never);

  app.addHook('preHandler', async (req) => {
    if (opts.user) req.user = { ...opts.user, github: null, via: 'session' } as never;
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

  app.register(auditRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('GET /v1/admin/audit route', () => {
  it('requires authentication', async () => {
    const { app } = buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('forbids reader role even with audit:read scope', async () => {
    const { app } = buildApp({ user: { id: 'r', role: 'reader', scopes: [Scopes.AuditRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('forbids owner without audit:read scope on a scoped key', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.Ask] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns filtered events for an owner with the scope and self-logs the query', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    await audit.write({ actor: 'alice', action: 'lifecycle.export', resource: '/v1/me/export' });
    await audit.write({ actor: 'bob', action: 'keys.issue', resource: '/v1/keys' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?actor=alice',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.total).toBe(1);
    expect(body.events[0].actor).toBe('alice');

    // The query itself should have been appended to the log.
    const after = await audit.query({ action: 'audit.query' });
    expect(after.total).toBe(1);
    expect(after.events[0]!.actor).toBe('owner-1');
    await app.close();
  });

  it('rejects an invalid limit via zod validation', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit?limit=99999' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('composes filters and pagination the way the audit UI calls it', async () => {
    // The owner-facing /audit page applies actor/action/resource filters
    // together with limit+offset. Make sure the route honours that combo
    // and returns the right slice rather than silently ignoring one knob.
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    for (let i = 0; i < 4; i++) {
      await audit.write({ actor: 'alice', action: 'keys.issue', resource: `/v1/keys/${i}` });
      await new Promise((r) => setTimeout(r, 2));
    }
    await audit.write({ actor: 'bob', action: 'keys.issue', resource: '/v1/keys/other' });

    const page1 = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?actor=alice&action=keys&resource=/v1/keys&limit=2&offset=0',
    });
    expect(page1.statusCode).toBe(200);
    const body1 = JSON.parse(page1.payload);
    expect(body1.total).toBe(4);
    expect(body1.events).toHaveLength(2);
    expect(body1.events.every((e: { actor: string }) => e.actor === 'alice')).toBe(true);

    const page2 = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit?actor=alice&action=keys&resource=/v1/keys&limit=2&offset=2',
    });
    expect(page2.statusCode).toBe(200);
    const body2 = JSON.parse(page2.payload);
    expect(body2.events).toHaveLength(2);
    const ids1 = new Set(body1.events.map((e: { id: string }) => e.id));
    for (const ev of body2.events) {
      expect(ids1.has(ev.id)).toBe(false);
    }
  });
});

describe('GET /v1/admin/audit/export route', () => {
  it('forbids a reader role', async () => {
    const { app } = buildApp({ user: { id: 'r', role: 'reader', scopes: [Scopes.AuditRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit/export' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('forbids an owner whose key lacks audit:read', async () => {
    const { app } = buildApp({ user: { id: 'o', role: 'owner', scopes: [Scopes.Ask] } });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit/export' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('streams every matching event as JSONL with one event per line', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    for (let i = 0; i < 3; i++) {
      await audit.write({ actor: 'alice', action: 'keys.issue', resource: `/v1/keys/${i}` });
    }
    await audit.write({ actor: 'bob', action: 'login', resource: '/v1/session' });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit/export?actor=alice',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    expect(res.headers['content-disposition']).toContain('attachment');
    const lines = res.payload.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      const ev = JSON.parse(line);
      expect(ev.actor).toBe('alice');
      expect(typeof ev.hash).toBe('string');
    }
    // The export itself must be recorded.
    const after = await audit.query({ action: 'audit.export' });
    expect(after.total).toBe(1);
    expect(after.events[0]!.actor).toBe('owner-1');
    await app.close();
  });

  it('emits a CSV header and properly quotes cells containing commas', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    await audit.write({
      actor: 'alice',
      action: 'keys.issue',
      resource: '/v1/keys',
      meta: { note: 'a, b, "c"' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit/export?format=csv',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.payload.split('\n').filter(Boolean);
    expect(lines[0]).toBe('id,ts,iso,actor,action,resource,prevHash,hash,meta');
    // Data row plus the self-logged audit.export row.
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const dataLine = lines.find((l) => l.includes('keys.issue'))!;
    expect(dataLine).toBeTruthy();
    // The embedded comma + quote in the meta must survive CSV escaping.
    expect(dataLine).toContain('"');
    expect(dataLine).toContain('a, b');
    await app.close();
  });

  it('rejects an unsupported format', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit/export?format=xml',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('audit inclusion proofs', () => {
  it('issues a proof for an existing event and verifies it', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    const ev = await audit.write({
      actor: 'alice',
      action: 'POST 200',
      resource: '/v1/sensitive',
    });
    const issued = await app.inject({
      method: 'GET',
      url: `/v1/admin/audit/${ev.id}/proof`,
    });
    expect(issued.statusCode).toBe(200);
    const proof = issued.json().proof;
    expect(proof.event.id).toBe(ev.id);
    expect(proof.position).toBeGreaterThanOrEqual(1);
    expect(proof.eventHash).toBe(ev.hash);
    expect(proof.hmac).toMatch(/^[a-f0-9]{64}$/);

    const verified = await app.inject({
      method: 'POST',
      url: '/v1/admin/audit/proofs/verify',
      payload: { proof },
    });
    expect(verified.statusCode).toBe(200);
    const verdict = verified.json();
    expect(verdict.ok).toBe(true);
    expect(verdict.eventHashValid).toBe(true);
    expect(verdict.signatureValid).toBe(true);
    await app.close();
  });

  it('rejects a proof whose event body was tampered', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    const ev = await audit.write({
      actor: 'alice',
      action: 'POST 200',
      resource: '/v1/secret',
    });
    const issued = await app.inject({
      method: 'GET',
      url: `/v1/admin/audit/${ev.id}/proof`,
    });
    const proof = issued.json().proof;
    proof.event.actor = 'mallory';
    const verified = await app.inject({
      method: 'POST',
      url: '/v1/admin/audit/proofs/verify',
      payload: { proof },
    });
    expect(verified.statusCode).toBe(200);
    const verdict = verified.json();
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('event-hash-mismatch');
    await app.close();
  });

  it('returns 404 for an unknown event id', async () => {
    const { app } = buildApp({
      user: { id: 'owner', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit/does-not-exist/proof',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('requires the audit:read scope', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner', role: 'owner', scopes: ['other:read'] },
    });
    const ev = await audit.write({
      actor: 'u',
      action: 'POST 200',
      resource: '/v1/x',
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/admin/audit/${ev.id}/proof`,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
