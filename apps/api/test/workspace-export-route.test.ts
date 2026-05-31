import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { workspaceExportRoutes } from '../src/routes/workspace-export.js';
import { Scopes } from '../src/scopes.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-ws-export-route-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'reader';
const RANK: Record<Role, number> = { reader: 0, viewer: 0, member: 1, admin: 2, owner: 3 };

function buildApp(opts: { user: { id: string; role: Role; scopes?: string[] | null } | null }) {
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
  app.decorate('requireMinRole', (min: Role) => async (req: any, reply: any) => {
    if (!req.user) return reply.code(401).send({ error: 'auth required' });
    if (RANK[req.user.role as Role] < RANK[min]) {
      reply.code(403).send({ error: 'role insufficient', required: min });
    }
  });
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });

  app.register(workspaceExportRoutes, { prefix: '/v1' });
  return { app, audit };
}

async function seedTiny() {
  await writeFile(
    join(dir, 'members.json'),
    JSON.stringify({ members: [{ userId: 'owner-1', role: 'owner' }] }),
  );
  await mkdir(join(dir, 'conversations'), { recursive: true });
}

describe('GET /v1/workspace/export.*', () => {
  it('requires authentication', async () => {
    const { app } = buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url: '/v1/workspace/export.json' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('forbids non-owner roles (admin cannot pull the tenant-wide bundle)', async () => {
    await seedTiny();
    const { app } = buildApp({
      user: { id: 'a', role: 'admin', scopes: ['*'] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/workspace/export.json' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('forbids owner with a narrow key that lacks workspace-export:admin', async () => {
    await seedTiny();
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.Ask] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/workspace/export.json' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('returns the bundle for an owner with the right scope and audits it', async () => {
    await seedTiny();
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.WorkspaceExportManage] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/workspace/export.json' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('clawmind.workspace-export.v1');
    expect(body.exportedBy).toBe('owner-1');
    expect(body.counts.members).toBe(1);
    const q = await audit.query({ actions: ['workspace.export'] });
    expect(q.events.length).toBe(1);
    expect(q.events[0]!.actor).toBe('owner-1');
    await app.close();
  });

  it('dry_run=true returns a preview and audits with the .dry_run suffix', async () => {
    await seedTiny();
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.WorkspaceExportManage] },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/workspace/export.json?dry_run=true',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.dryRun).toBe(true);
    expect(body.schema).toBe('clawmind.workspace-export-preview.v1');
    const q = await audit.query({ actions: ['workspace.export.dry_run'] });
    expect(q.events.length).toBe(1);
    await app.close();
  });

  it('zip endpoint returns a PK archive for an owner', async () => {
    await seedTiny();
    const { app } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: [Scopes.WorkspaceExportManage] },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/workspace/export.zip' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.rawPayload.slice(0, 4).toString('hex')).toBe('504b0304');
    await app.close();
  });

  it('preview route accepts the read-only scope but still denies non-owners', async () => {
    await seedTiny();
    const denied = buildApp({
      user: { id: 'a', role: 'admin', scopes: [Scopes.WorkspaceExportRead] },
    });
    const r1 = await denied.app.inject({ method: 'GET', url: '/v1/workspace/export/preview' });
    expect(r1.statusCode).toBe(403);
    await denied.app.close();

    const ok = buildApp({
      user: { id: 'o', role: 'owner', scopes: [Scopes.WorkspaceExportRead] },
    });
    const r2 = await ok.app.inject({ method: 'GET', url: '/v1/workspace/export/preview' });
    expect(r2.statusCode).toBe(200);
    const body = JSON.parse(r2.payload);
    expect(body.dryRun).toBe(true);
    await ok.app.close();
  });
});
