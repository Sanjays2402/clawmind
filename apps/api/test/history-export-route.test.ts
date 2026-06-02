import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { historyRoutes } from '../src/routes/history.js';
import { recordHistory } from '../src/services/history.js';
import { setTags as setHistoryTags } from '../src/services/history-tags.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-hist-export-route-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function buildApp(user: { id: string; role: 'owner' | 'reader'; scopes?: string[] | null }) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const audit = new AuditLog(join(dir, 'audit.log'));
  app.decorate('clawmind', { audit, dataDir: dir, env: {} } as never);
  app.addHook('preHandler', async (req) => {
    (req as any).user = { ...user, github: null, via: 'session' };
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
  app.register(historyRoutes, { prefix: '/v1' });
  return app;
}

describe('GET /v1/history/export.<fmt> tag filter', () => {
  it('filters bulk export by tag so the download matches the tag-narrowed UI', async () => {
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });

    await recordHistory(dir, {
      id: 'a', ts: 1700000000000, userId: 'u1',
      query: 'first question', answer: 'a1', model: 'm', sources: [],
    });
    await recordHistory(dir, {
      id: 'b', ts: 1700000001000, userId: 'u1',
      query: 'second question', answer: 'a2', model: 'm', sources: [],
    });
    await recordHistory(dir, {
      id: 'c', ts: 1700000002000, userId: 'u1',
      query: 'third question', answer: 'a3', model: 'm', sources: [],
    });
    await setHistoryTags(dir, 'u1', 'a', ['work']);
    await setHistoryTags(dir, 'u1', 'b', ['work', 'urgent']);
    await setHistoryTags(dir, 'u1', 'c', ['personal']);

    // No tag filter: all three.
    const all = await app.inject({ method: 'GET', url: '/v1/history/export.json' });
    expect(all.statusCode).toBe(200);
    const allBody = all.json() as { count: number; items: Array<{ id: string }> };
    expect(allBody.count).toBe(3);

    // Single tag.
    const work = await app.inject({ method: 'GET', url: '/v1/history/export.json?tags=work' });
    expect(work.statusCode).toBe(200);
    const workBody = work.json() as { count: number; items: Array<{ id: string }> };
    expect(workBody.count).toBe(2);
    expect(workBody.items.map((i) => i.id).sort()).toEqual(['a', 'b']);

    // Multi-tag AND semantics: only the item carrying both tags survives.
    const both = await app.inject({ method: 'GET', url: '/v1/history/export.json?tags=work,urgent' });
    expect(both.statusCode).toBe(200);
    const bothBody = both.json() as { count: number; items: Array<{ id: string }> };
    expect(bothBody.count).toBe(1);
    expect(bothBody.items[0].id).toBe('b');

    // CSV and Markdown formats apply the same filter.
    const csv = await app.inject({ method: 'GET', url: '/v1/history/export.csv?tags=personal' });
    expect(csv.statusCode).toBe(200);
    expect(csv.payload).toContain('third question');
    expect(csv.payload).not.toContain('first question');
    expect(csv.payload).not.toContain('second question');

    const md = await app.inject({ method: 'GET', url: '/v1/history/export.md?tags=personal' });
    expect(md.statusCode).toBe(200);
    expect(md.payload).toContain('third question');
    expect(md.payload).not.toContain('first question');

    // Unknown tag returns an empty (but well-formed) export.
    const none = await app.inject({ method: 'GET', url: '/v1/history/export.json?tags=missing' });
    expect(none.statusCode).toBe(200);
    expect((none.json() as { count: number }).count).toBe(0);

    await app.close();
  });
});
