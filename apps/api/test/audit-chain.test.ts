import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog, GENESIS_PREV_HASH, computeRecordHash } from '@clawmind/store';
import { auditRoutes } from '../src/routes/audit.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-audit-chain-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('AuditLog hash chain', () => {
  it('stamps every record with prevHash and a sha256 hash', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    const a = await log.write({ actor: 'alice', action: 'login', resource: '/x' });
    const b = await log.write({ actor: 'alice', action: 'read', resource: '/y' });
    expect(a.prevHash).toBe(GENESIS_PREV_HASH);
    expect(a.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(b.prevHash).toBe(a.hash);
    expect(b.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(b.hash).not.toBe(a.hash);
  });

  it('verify() reports ok with head hash on an untampered chain', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    let last = '';
    for (let i = 0; i < 4; i++) {
      const ev = await log.write({ actor: 'u', action: `n${i}`, resource: '/x' });
      last = ev.hash!;
    }
    const v = await log.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(4);
    expect(v.firstBadIndex).toBeNull();
    expect(v.headHash).toBe(last);
  });

  it('verify() detects an in-place edit of a record', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'alice', action: 'login', resource: '/x' });
    await log.write({ actor: 'alice', action: 'sensitive', resource: '/y' });
    await log.write({ actor: 'alice', action: 'logout', resource: '/z' });

    const file = join(dir, 'audit.log');
    const raw = await readFile(file, 'utf8');
    // Flip "sensitive" -> "innocuous" in the middle record. This changes
    // the hashable body but leaves the recorded hash field unchanged, so
    // the record's own hash check must fail.
    const tampered = raw.replace('"sensitive"', '"innocuous"');
    await writeFile(file, tampered, 'utf8');

    const v = await log.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBadIndex).toBe(1);
    expect(v.reason).toMatch(/hash mismatch/);
  });

  it('verify() detects a deleted record via prevHash break', async () => {
    const log = new AuditLog(join(dir, 'audit.log'));
    await log.write({ actor: 'a', action: 'one', resource: '/1' });
    await log.write({ actor: 'a', action: 'two', resource: '/2' });
    await log.write({ actor: 'a', action: 'three', resource: '/3' });

    const file = join(dir, 'audit.log');
    const raw = await readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    // Drop the middle line, keep first and third.
    await writeFile(file, lines[0] + '\n' + lines[2] + '\n', 'utf8');

    const v = await log.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBadIndex).toBe(1);
    expect(v.reason).toMatch(/prevHash mismatch/);
  });

  it('recovers the chain head after restart so a new writer keeps linking', async () => {
    const file = join(dir, 'audit.log');
    const first = new AuditLog(file);
    const a = await first.write({ actor: 'a', action: 'one', resource: '/x' });
    const b = await first.write({ actor: 'a', action: 'two', resource: '/x' });

    // Fresh instance, simulating a restart.
    const second = new AuditLog(file);
    const c = await second.write({ actor: 'a', action: 'three', resource: '/x' });
    expect(c.prevHash).toBe(b.hash);
    expect(b.prevHash).toBe(a.hash);

    const v = await second.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);
    expect(v.headHash).toBe(c.hash);
  });

  it('chains across a rotation boundary', async () => {
    // Tiny maxBytes so the first write triggers a rotation on the second.
    const log = new AuditLog(join(dir, 'audit.log'), { maxBytes: 64, keepFiles: 3 });
    const a = await log.write({ actor: 'a', action: 'one', resource: '/x' });
    const b = await log.write({ actor: 'a', action: 'two', resource: '/x' });
    const c = await log.write({ actor: 'a', action: 'three', resource: '/x' });
    // b or c may live in a rotated sibling depending on sizes; verify walks them all.
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    const v = await log.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);
    expect(v.headHash).toBe(c.hash);
  });

  it('tolerates legacy unchained records as a prefix', async () => {
    const file = join(dir, 'audit.log');
    // Hand-write a legacy record (no hash, no prevHash) as if from an older build.
    await appendFile(
      file,
      JSON.stringify({ id: 'legacy', ts: 1, actor: 'old', action: 'old', resource: '/x' }) + '\n',
      'utf8',
    );
    const log = new AuditLog(file);
    const a = await log.write({ actor: 'a', action: 'one', resource: '/x' });
    expect(a.prevHash).toBe(GENESIS_PREV_HASH);
    const v = await log.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(2);
    expect(v.headHash).toBe(a.hash);
  });

  it('computeRecordHash is stable across meta key order', async () => {
    const base = {
      id: 'x',
      ts: 1,
      actor: 'a',
      action: 'b',
      resource: '/r',
      prevHash: GENESIS_PREV_HASH,
    };
    const h1 = computeRecordHash({ ...base, meta: { a: 1, b: 2 } });
    const h2 = computeRecordHash({ ...base, meta: { b: 2, a: 1 } });
    expect(h1).toBe(h2);
  });
});

function buildApp(opts: { user: { id: string; role: 'owner' | 'reader'; scopes?: string[] } | null }) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const audit = new AuditLog(join(dir, 'audit.log'));
  app.decorate('clawmind', { audit, dataDir: dir } as never);

  app.addHook('preHandler', async (req) => {
    if (opts.user) (req as any).user = { ...opts.user, github: null, via: 'session' };
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

describe('GET /v1/admin/audit/verify route', () => {
  it('requires owner role', async () => {
    const { app } = buildApp({ user: { id: 'r', role: 'reader', scopes: [Scopes.AuditRead] } });
    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit/verify' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns ok=true and a head hash for a clean log', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    await audit.write({ actor: 'alice', action: 'login', resource: '/x' });
    await audit.write({ actor: 'alice', action: 'read', resource: '/y' });

    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit/verify' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.checked).toBeGreaterThanOrEqual(2);
    expect(body.headHash).toMatch(/^[a-f0-9]{64}$/);

    // The verify call itself is audited.
    const after = await audit.query({ action: 'audit.verify' });
    expect(after.total).toBe(1);
    expect(after.events[0]!.actor).toBe('owner-1');
    await app.close();
  });

  it('reports ok=false when the log on disk has been edited', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.AuditRead] },
    });
    await audit.write({ actor: 'alice', action: 'sensitive', resource: '/x' });
    await audit.write({ actor: 'alice', action: 'next', resource: '/y' });

    const file = join(dir, 'audit.log');
    const raw = await readFile(file, 'utf8');
    await writeFile(file, raw.replace('sensitive', 'benign'), 'utf8');

    const res = await app.inject({ method: 'GET', url: '/v1/admin/audit/verify' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/hash mismatch|prevHash mismatch/);
    await app.close();
  });
});
