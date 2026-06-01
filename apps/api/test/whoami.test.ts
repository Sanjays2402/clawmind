import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { whoamiRoutes } from '../src/routes/whoami.js';

// Whoami is the SDK-side identity introspection endpoint. The contract
// every integrator depends on:
//   1. Anonymous callers get a 200 with authenticated:false (NOT a 401),
//      so they can distinguish "no creds" from "bad creds" without
//      special-case error parsing.
//   2. Authenticated callers see their identity but never a secret.
//   3. API-key callers see the key id and scopes echoed back, since that
//      is exactly what a developer asks an admin to confirm when an SDK
//      starts returning 403s mid-deploy.
function build() {
  const app = Fastify();
  return app;
}

describe('GET /v1/whoami', () => {
  it('returns authenticated:false for anonymous callers without rejecting them', async () => {
    const app = build();
    await app.register(whoamiRoutes, { prefix: '/v1' });
    const res = await app.inject({ method: 'GET', url: '/v1/whoami' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('clawmind.whoami.v1');
    expect(body.authenticated).toBe(false);
    expect(body.via).toBe('anonymous');
    expect(body.user).toEqual({ id: null, role: null, email: null, github: null });
    expect(body.apiKey).toBeNull();
    expect(body.elevation).toBeNull();
    expect(body.request.id).toBeTypeOf('string');
    expect(body.request.method).toBe('GET');
    expect(body.request.url).toBe('/v1/whoami');
    expect(body.request.serverTime).toBeGreaterThan(0);
    await app.close();
  });

  it('echoes session identity for a session-authenticated caller', async () => {
    const app = build();
    app.addHook('preHandler', async (req) => {
      req.user = { id: 'alice', github: 'alice-gh', role: 'admin', via: 'session', email: 'alice@acme.test' };
    });
    await app.register(whoamiRoutes, { prefix: '/v1' });
    const res = await app.inject({ method: 'GET', url: '/v1/whoami' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.authenticated).toBe(true);
    expect(body.via).toBe('session');
    expect(body.user).toEqual({ id: 'alice', role: 'admin', email: 'alice@acme.test', github: 'alice-gh' });
    expect(body.apiKey).toBeNull();
    await app.close();
  });

  it('echoes api-key id and scopes for api-key callers and never the secret', async () => {
    const app = build();
    app.addHook('preHandler', async (req) => {
      req.user = {
        id: 'svc-bot',
        github: null,
        role: 'member',
        via: 'api-key',
        apiKeyId: 'k_abc123',
        scopes: ['ask:read', 'search:read'],
      };
    });
    await app.register(whoamiRoutes, { prefix: '/v1' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/whoami',
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', authorization: 'Bearer cm_supersecrettoken' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.authenticated).toBe(true);
    expect(body.via).toBe('api-key');
    expect(body.apiKey).toEqual({ id: 'k_abc123', scopes: ['ask:read', 'search:read'] });
    expect(body.request.forwardedFor).toBe('203.0.113.7, 10.0.0.1');
    // The bearer secret must never round-trip.
    expect(res.payload).not.toContain('cm_supersecrettoken');
    expect(res.payload).not.toContain('Bearer');
    await app.close();
  });

  it('surfaces an active role-elevation grant so callers can see why their role is lifted', async () => {
    const app = build();
    const exp = Date.now() + 60_000;
    app.addHook('preHandler', async (req) => {
      req.user = { id: 'alice', github: null, role: 'owner', via: 'session' };
      req.elevation = { id: 'el_1', fromRole: 'admin', toRole: 'owner', expiresAt: exp };
    });
    await app.register(whoamiRoutes, { prefix: '/v1' });
    const res = await app.inject({ method: 'GET', url: '/v1/whoami' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.elevation).toEqual({ id: 'el_1', fromRole: 'admin', toRole: 'owner', expiresAt: exp });
    await app.close();
  });
});
