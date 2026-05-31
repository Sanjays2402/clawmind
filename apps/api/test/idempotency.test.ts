import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { idempotencyPlugin } from '../src/plugins/idempotency.js';
import { lookup, hashBody, isValidKey, _resetForTest } from '../src/services/idempotency.js';

let dataDir: string;
let counter: number;

async function build(actorHeader = 'u1'): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('clawmind', { dataDir } as any);
  // Stand-in auth: read X-Test-Actor; '' means anonymous.
  app.addHook('preHandler', async (req) => {
    const v = req.headers['x-test-actor'];
    const id = Array.isArray(v) ? v[0] : v;
    if (id) (req as any).user = { id, role: 'owner' };
  });
  await app.register(idempotencyPlugin);
  app.post('/v1/things', async (req, reply) => {
    counter += 1;
    reply.header('content-type', 'application/json');
    return { n: counter, body: req.body ?? null };
  });
  app.post('/v1/fail', async (_req, reply) => {
    reply.code(500);
    return { error: 'boom' };
  });
  app.get('/v1/things', async () => ({ ok: true }));
  return app;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cm-idem-'));
  counter = 0;
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

describe('idempotency plugin', () => {
  it('passes through when no key header is present', async () => {
    const app = await build();
    const a = await app.inject({ method: 'POST', url: '/v1/things', headers: { 'x-test-actor': 'u1' }, payload: { x: 1 } });
    const b = await app.inject({ method: 'POST', url: '/v1/things', headers: { 'x-test-actor': 'u1' }, payload: { x: 1 } });
    expect(a.json()).toEqual({ n: 1, body: { x: 1 } });
    expect(b.json()).toEqual({ n: 2, body: { x: 1 } });
    await app.close();
  });

  it('replays the cached response on a repeat with the same key and body', async () => {
    const app = await build();
    const key = 'idem-test-aaaaaaaa';
    const a = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: { x: 1 },
    });
    const b = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: { x: 1 },
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual({ n: 1, body: { x: 1 } });
    expect(b.json()).toEqual({ n: 1, body: { x: 1 } });
    expect(b.headers['idempotency-replay']).toBe('true');
    expect(counter).toBe(1);
    await app.close();
  });

  it('returns 409 when the same key is reused with a different body', async () => {
    const app = await build();
    const key = 'idem-test-bbbbbbbb';
    const a = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: { x: 1 },
    });
    expect(a.statusCode).toBe(200);
    const b = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: { x: 2 },
    });
    expect(b.statusCode).toBe(409);
    expect(b.json().error).toBe('idempotency_key_reused');
    expect(counter).toBe(1);
    await app.close();
  });

  it('isolates keys between actors', async () => {
    const app = await build();
    const key = 'idem-test-cccccccc';
    const a = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: { x: 1 },
    });
    const b = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u2', 'idempotency-key': key },
      payload: { x: 1 },
    });
    expect(a.json().n).toBe(1);
    // Different actor should execute fresh, not replay u1's response.
    expect(b.json().n).toBe(2);
    expect(b.headers['idempotency-replay']).toBeUndefined();
    await app.close();
  });

  it('rejects malformed keys with 400', async () => {
    const app = await build();
    const r = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': 'has spaces!' },
      payload: { x: 1 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('invalid_idempotency_key');
    expect(counter).toBe(0);
    await app.close();
  });

  it('rejects anonymous callers with 401', async () => {
    const app = await build();
    const r = await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'idempotency-key': 'idem-test-dddddddd' },
      payload: { x: 1 },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe('idempotency_requires_auth');
    await app.close();
  });

  it('ignores GETs and never caches them', async () => {
    const app = await build();
    const a = await app.inject({
      method: 'GET', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': 'idem-test-eeeeeeee' },
    });
    expect(a.statusCode).toBe(200);
    const result = await lookup(dataDir, 'u:u1', 'GET', '/v1/things', 'idem-test-eeeeeeee', hashBody(''));
    expect(result.kind).toBe('miss');
    await app.close();
  });

  it('does not cache non-2xx responses so retries get a fresh attempt', async () => {
    const app = await build();
    const key = 'idem-test-ffffffff';
    const a = await app.inject({
      method: 'POST', url: '/v1/fail',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: {},
    });
    expect(a.statusCode).toBe(500);
    const b = await app.inject({
      method: 'POST', url: '/v1/fail',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': key },
      payload: {},
    });
    expect(b.statusCode).toBe(500);
    expect(b.headers['idempotency-replay']).toBeUndefined();
    await app.close();
  });

  it('validates keys with isValidKey', () => {
    expect(isValidKey('short')).toBe(false);
    expect(isValidKey('a'.repeat(8))).toBe(true);
    expect(isValidKey('has spaces')).toBe(false);
    expect(isValidKey('a'.repeat(500))).toBe(false);
    expect(isValidKey('valid_key.123:abc-xyz')).toBe(true);
  });

  it('_resetForTest clears persisted entries', async () => {
    const app = await build();
    await app.inject({
      method: 'POST', url: '/v1/things',
      headers: { 'x-test-actor': 'u1', 'idempotency-key': 'idem-test-gggggggg' },
      payload: { x: 1 },
    });
    await _resetForTest(dataDir);
    const r = await lookup(dataDir, 'u:u1', 'POST', '/v1/things', 'idem-test-gggggggg', hashBody(JSON.stringify({ x: 1 })));
    expect(r.kind).toBe('miss');
    await app.close();
  });
});
