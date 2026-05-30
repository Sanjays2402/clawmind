import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  securityHeadersPlugin,
  DEFAULT_API_CSP,
} from '../src/plugins/security-headers.js';

function build(opts?: Parameters<typeof securityHeadersPlugin>[1]) {
  const app = Fastify();
  app.register(securityHeadersPlugin, opts);
  app.get('/ping', async () => ({ ok: true }));
  app.get('/boom', async () => {
    throw new Error('nope');
  });
  return app;
}

describe('security-headers plugin', () => {
  it('emits the default JSON-API baseline headers on success responses', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['content-security-policy']).toBe(DEFAULT_API_CSP);
    expect(res.headers['permissions-policy']).toContain('camera=()');
    expect(res.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });

  it('also emits headers on error responses', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(DEFAULT_API_CSP);
    await app.close();
  });

  it('emits HSTS only when hstsEnabled is true', async () => {
    const app = build({ hstsEnabled: true, hstsMaxAgeSeconds: 600 });
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['strict-transport-security']).toBe(
      'max-age=600; includeSubDomains',
    );
    await app.close();
  });

  it('supports disabling CSP by passing null', async () => {
    const app = build({ contentSecurityPolicy: null });
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('honours preload and subdomain toggles for HSTS', async () => {
    const app = build({
      hstsEnabled: true,
      hstsMaxAgeSeconds: 31536000,
      hstsIncludeSubDomains: false,
      hstsPreload: true,
    });
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; preload');
    await app.close();
  });
});
