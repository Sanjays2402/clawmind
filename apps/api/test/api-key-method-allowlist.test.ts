import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  issueKey,
  setKeyAllowedMethods,
  normaliseKeyMethodRules,
  methodAllowedByKey,
  loadKeys,
  MAX_KEY_METHOD_RULES,
  VALID_HTTP_METHODS,
} from '../src/services/api-keys.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-key-method-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('api-key per-key HTTP method allowlist', () => {
  it('normalises, uppercases, dedupes, and sorts methods', () => {
    expect(normaliseKeyMethodRules(['get', 'HEAD']).methods).toEqual(['GET', 'HEAD']);
    expect(normaliseKeyMethodRules(['POST', 'get']).methods).toEqual(['GET', 'POST']);
    expect(normaliseKeyMethodRules(null).ok).toBe(true);
    expect(normaliseKeyMethodRules([]).methods).toEqual([]);
  });

  it('rejects unknown verbs, duplicates, and overflow', () => {
    const bad = normaliseKeyMethodRules(['HACK']);
    expect(bad.ok).toBe(false);
    expect(bad.index).toBe(0);
    const dup = normaliseKeyMethodRules(['GET', 'get']);
    expect(dup.ok).toBe(false);
    const over = normaliseKeyMethodRules(new Array(MAX_KEY_METHOD_RULES + 1).fill('GET'));
    expect(over.ok).toBe(false);
  });

  it('unrestricted key permits every HTTP verb', () => {
    for (const m of VALID_HTTP_METHODS) {
      expect(methodAllowedByKey(m, null)).toBe(true);
      expect(methodAllowedByKey(m, [])).toBe(true);
    }
  });

  it('restricts to the configured set and fails closed on missing method', () => {
    const rules = ['GET', 'HEAD'];
    expect(methodAllowedByKey('GET', rules)).toBe(true);
    expect(methodAllowedByKey('get', rules)).toBe(true); // case-insensitive
    expect(methodAllowedByKey('POST', rules)).toBe(false);
    expect(methodAllowedByKey('DELETE', rules)).toBe(false);
    expect(methodAllowedByKey(undefined, rules)).toBe(false);
    expect(methodAllowedByKey(null, rules)).toBe(false);
  });

  it('persists the normalised list and clears with null', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const updated = await setKeyAllowedMethods(dir, 'u1', issued.record.id, ['post', 'GET']);
    expect(updated?.allowedMethods).toEqual(['GET', 'POST']);
    const all = await loadKeys(dir);
    expect(all[0]!.allowedMethods).toEqual(['GET', 'POST']);
    const cleared = await setKeyAllowedMethods(dir, 'u1', issued.record.id, null);
    expect(cleared?.allowedMethods).toBeNull();
  });

  it('refuses to update a key owned by another user', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    const updated = await setKeyAllowedMethods(dir, 'u2', issued.record.id, ['GET']);
    expect(updated).toBeNull();
  });

  it('throws on invalid input so routes return 400', async () => {
    const issued = await issueKey(dir, { userId: 'u1', label: 'cli' });
    await expect(setKeyAllowedMethods(dir, 'u1', issued.record.id, ['NOPE'])).rejects.toThrow();
  });

  it('end-to-end: auth plugin blocks disallowed verb with 405 + Allow header', async () => {
    const { authPlugin } = await import('../src/plugins/auth.js');
    const { requestIdPlugin } = await import('../src/plugins/request-id.js');

    const issued = await issueKey(dir, { userId: 'u1', label: 'ro' });
    await setKeyAllowedMethods(dir, 'u1', issued.record.id, ['GET', 'HEAD']);

    const app = Fastify();
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async () => undefined },
      env: { CLAWMIND_OIDC_ISSUER: '', CLAWMIND_OIDC_CLIENT_ID: '', CLAWMIND_OIDC_CLIENT_SECRET: '', CLAWMIND_OIDC_REDIRECT_URI: '', CLAWMIND_OIDC_SCOPES: '', CLAWMIND_AUTH_MODE: 'api-key' },
    } as never);
    await app.register(requestIdPlugin);
    await app.register(authPlugin);
    app.get('/v1/ping', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));
    app.post('/v1/ping', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));

    const okRes = await app.inject({
      method: 'GET',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${issued.secret}` },
    });
    expect(okRes.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'POST',
      url: '/v1/ping',
      headers: { authorization: `Bearer ${issued.secret}` },
    });
    expect(denied.statusCode).toBe(405);
    expect(denied.headers.allow).toBe('GET, HEAD');
    const body = denied.json() as { error: string; method: string; allowedMethods: string[] };
    expect(body.error).toMatch(/method not allowed/);
    expect(body.method).toBe('POST');
    expect(body.allowedMethods).toEqual(['GET', 'HEAD']);

    await app.close();
  });
});
