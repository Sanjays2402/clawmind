import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { conversationRoutes } from '../src/routes/conversations.js';
import { createConversation, appendTurn } from '../src/services/conversations.js';

// Route-level pinning for the new `?since=<iso-date>` filter on
// `/conversations/:id/export.<fmt>`. The filter narrows the export
// to turns whose `ts` is at-or-after the cutoff (mirrors the --since
// semantics across stale / stats / digest show / pins / mutes /
// ingest / reindex byte-for-byte). The natural use is an incremental
// dump for cron: `?since=$(date -u -d '1 day ago' +%FT%TZ)` produces
// a daily delta without re-downloading the whole thread.

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-conv-since-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

function buildApp(user: { id: string; role: 'owner' | 'reader'; scopes?: string[] | null }) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  app.decorate('clawmind', {
    dataDir: dir,
    env: { CLAWMIND_WORKSPACE: '/abs/workspace' },
    audit: { write: async () => undefined },
    rag: {},
    llm: { id: 'test-llm' },
  } as never);
  app.addHook('preHandler', async (req) => {
    (req as any).user = { ...user, github: null, via: 'session' };
  });
  app.decorate('requireAuth', async (req: any, reply: any) => {
    if (!req.user) reply.code(401).send({ error: 'auth required' });
  });
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });
  app.register(conversationRoutes, { prefix: '/v1' });
  return app;
}

// Seed a conversation with three turns at ts = 1000, 2000, 3000.
// The cutoff at 2000 should keep ts >= 2000 (the two newest).
async function seedConversation() {
  const c = await createConversation(dir, 'u1', 'Test');
  await appendTurn(dir, c.id, { role: 'user', content: 'first', ts: 1000 } as never);
  await appendTurn(dir, c.id, { role: 'assistant', content: 'second', ts: 2000 } as never);
  await appendTurn(dir, c.id, { role: 'user', content: 'third', ts: 3000 } as never);
  return c.id;
}

describe('GET /v1/conversations/:id/export.<fmt>?since=<iso>', () => {
  it('json: narrows turns to those with ts at-or-after the cutoff (INCLUSIVE)', async () => {
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });
    const id = await seedConversation();
    const cutoff = new Date(2000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.json?since=${encodeURIComponent(cutoff)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversation: { turns: { content: string; ts: number }[] } };
    expect(body.conversation.turns).toHaveLength(2);
    expect(body.conversation.turns.map((t) => t.content)).toEqual(['second', 'third']);
    expect(body.conversation.turns.every((t) => t.ts >= 2000)).toBe(true);
    await app.close();
  });

  it('json without ?since keeps every turn (legacy behaviour unchanged)', async () => {
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });
    const id = await seedConversation();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.json`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversation: { turns: { content: string }[] } };
    expect(body.conversation.turns).toHaveLength(3);
    expect(body.conversation.turns.map((t) => t.content)).toEqual(['first', 'second', 'third']);
    await app.close();
  });

  it('md: narrows turns in the rendered markdown body', async () => {
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });
    const id = await seedConversation();
    const cutoff = new Date(2500).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.md?since=${encodeURIComponent(cutoff)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('third');
    expect(res.payload).not.toContain('first');
    expect(res.payload).not.toContain('second');
    await app.close();
  });

  it('csv: narrows the body rows in the rendered CSV', async () => {
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });
    const id = await seedConversation();
    const cutoff = new Date(2500).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.csv?since=${encodeURIComponent(cutoff)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('third');
    expect(res.payload).not.toContain('first');
    expect(res.payload).not.toContain('second');
    // Header row stays untouched so a downstream CSV parser keeps working.
    expect(res.payload.split('\r\n')[0]).toContain('turn_id');
    await app.close();
  });

  it('empty window yields a well-formed export with zero turns (NOT a 404)', async () => {
    // Critical contract: a cron polling a quiet conversation must
    // not alarm on \"nothing new\". Empty-but-valid is the right
    // shape — the consumer can branch on `turns.length === 0`.
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });
    const id = await seedConversation();
    const cutoff = new Date(99999).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.json?since=${encodeURIComponent(cutoff)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conversation: { turns: unknown[] } };
    expect(body.conversation.turns).toEqual([]);
    await app.close();
  });

  it('invalid ISO date is rejected with 400 (no silent degrade to full export)', async () => {
    const app = buildApp({ id: 'u1', role: 'owner', scopes: ['*'] });
    const id = await seedConversation();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.json?since=banana`,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string };
    expect(body.error).toContain('invalid since');
    await app.close();
  });

  it('?since does not leak across ownership: another user cannot read the narrowed thread', async () => {
    // Defence-in-depth: --since is a presentational filter, NOT a
    // permission control. The 404-on-foreign-owner check fires
    // BEFORE the narrow, so a u2 caller hitting u1's conversation
    // is still rejected with 404 regardless of cutoff.
    const app = buildApp({ id: 'u2', role: 'reader', scopes: ['*'] });
    const id = await seedConversation(); // owned by u1
    const cutoff = new Date(2000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${id}/export.json?since=${encodeURIComponent(cutoff)}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
