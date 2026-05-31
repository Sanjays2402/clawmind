import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { queryBlocklistRoutes } from '../src/routes/query-blocklist.js';
import {
  addRule,
  matchQuery,
  listRules,
} from '../src/services/query-blocklist.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-blocklist-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'reader';
const RANK: Record<Role, number> = { reader: 0, viewer: 0, member: 1, admin: 2, owner: 3 };

function buildApp(opts: {
  user: { id: string; role: Role; scopes?: string[] | null; mfa?: boolean } | null;
}) {
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
  app.decorate('requireMfa', async (req: any, reply: any) => {
    if (!req.user?.mfa) reply.code(401).send({ error: 'mfa required' });
  });

  app.register(queryBlocklistRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('query-blocklist service', () => {
  it('returns null when no rules exist', async () => {
    expect(await matchQuery(dir, 'anything')).toBeNull();
  });

  it('matches literal patterns case-insensitively', async () => {
    await addRule(dir, 'u', { pattern: 'Project Alpha', mode: 'literal' });
    const hit = await matchQuery(dir, 'tell me about project alpha please');
    expect(hit).not.toBeNull();
    expect(hit!.mode).toBe('literal');
  });

  it('matches regex patterns', async () => {
    await addRule(dir, 'u', { pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', mode: 'regex' });
    expect(await matchQuery(dir, 'ssn 123-45-6789 maybe')).not.toBeNull();
    expect(await matchQuery(dir, 'no number here')).toBeNull();
  });

  it('rejects invalid regex at write time', async () => {
    await expect(
      addRule(dir, 'u', { pattern: '(unclosed', mode: 'regex' }),
    ).rejects.toThrow(/invalid regex/);
  });

  it('rejects duplicate literal patterns regardless of case', async () => {
    await addRule(dir, 'u', { pattern: 'Acme', mode: 'literal' });
    await expect(
      addRule(dir, 'u', { pattern: 'ACME', mode: 'literal' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('POST /v1/query-blocklist permission gate', () => {
  it('forbids non-owner roles from writing', async () => {
    const { app } = buildApp({ user: { id: 'a', role: 'admin', scopes: ['*'], mfa: true } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/query-blocklist',
      payload: { pattern: 'leaked-token-prefix', mode: 'literal' },
    });
    expect(res.statusCode).toBe(403);
    expect(await listRules(dir)).toHaveLength(0);
    await app.close();
  });

  it('forbids owner without MFA step-up', async () => {
    const { app } = buildApp({ user: { id: 'o', role: 'owner', scopes: ['*'], mfa: false } });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/query-blocklist',
      payload: { pattern: 'leaked-token-prefix', mode: 'literal' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('owner with MFA can add and audit-log lists the rule id', async () => {
    const { app, audit } = buildApp({
      user: { id: 'owner-1', role: 'owner', scopes: ['*'], mfa: true },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/query-blocklist',
      payload: { pattern: 'project-zeta', mode: 'literal', label: 'restricted matter' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { rule: { id: string; pattern: string } };
    expect(body.rule.pattern).toBe('project-zeta');
    const stored = await listRules(dir);
    expect(stored).toHaveLength(1);
    const entries = (await audit.query({ limit: 50 })).events;
    const adds = entries.filter((e) => e.action === 'query-blocklist.add');
    expect(adds.length).toBe(1);
    expect((adds[0].meta as { ruleId: string }).ruleId).toBe(body.rule.id);
    await app.close();
  });

  it('forbids owner with a narrow key that lacks query-blocklist:admin', async () => {
    const { app } = buildApp({
      user: { id: 'o', role: 'owner', scopes: ['ask:read'], mfa: true },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/query-blocklist',
      payload: { pattern: 'p', mode: 'literal' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
