import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  freezeWorkspace,
  releaseFreeze,
  getFreeze,
  isFrozen,
  isFreezeAllowedPath,
  invalidateFreezeCache,
  WorkspaceFreezeValidationError,
} from '../src/services/workspace-freeze.js';
import { workspaceFreezePlugin } from '../src/plugins/workspace-freeze.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-freeze-'));
  invalidateFreezeCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('workspace freeze service', () => {
  it('defaults to inactive when the file does not exist', async () => {
    const f = await getFreeze(dir);
    expect(f.active).toBe(false);
    expect(f.frozenAt).toBeNull();
    expect(await isFrozen(dir)).toBe(false);
  });

  it('persists freeze metadata and records actor + timestamp', async () => {
    const f = await freezeWorkspace(dir, 'owner-1', { reason: 'billing-suspend', ticket: 'OPS-42' });
    expect(f.active).toBe(true);
    expect(f.frozenBy).toBe('owner-1');
    expect(f.reason).toBe('billing-suspend');
    expect(f.ticket).toBe('OPS-42');
    expect(typeof f.frozenAt).toBe('number');
    invalidateFreezeCache();
    expect(await isFrozen(dir)).toBe(true);
  });

  it('release flips active to false and records releasedBy without touching frozenAt history', async () => {
    const a = await freezeWorkspace(dir, 'owner-1', { reason: null, ticket: null });
    const b = await releaseFreeze(dir, 'owner-2');
    expect(b.active).toBe(false);
    expect(b.releasedBy).toBe('owner-2');
    expect(b.frozenAt).toBe(a.frozenAt); // history preserved
    invalidateFreezeCache();
    expect(await isFrozen(dir)).toBe(false);
  });

  it('rejects oversized reason and ticket strings', async () => {
    await expect(
      freezeWorkspace(dir, 'u', { reason: 'x'.repeat(1000) }),
    ).rejects.toBeInstanceOf(WorkspaceFreezeValidationError);
    await expect(
      freezeWorkspace(dir, 'u', { ticket: 'y'.repeat(1000) }),
    ).rejects.toBeInstanceOf(WorkspaceFreezeValidationError);
  });
});

describe('freeze allowlist', () => {
  it('always permits read methods', () => {
    expect(isFreezeAllowedPath('GET', '/v1/search?q=x')).toBe(true);
    expect(isFreezeAllowedPath('HEAD', '/v1/anything')).toBe(true);
    expect(isFreezeAllowedPath('OPTIONS', '/v1/keys')).toBe(true);
  });
  it('permits the freeze endpoint itself so owners can unfreeze', () => {
    expect(isFreezeAllowedPath('POST', '/v1/workspace/freeze')).toBe(true);
    expect(isFreezeAllowedPath('DELETE', '/v1/workspace/freeze')).toBe(true);
  });
  it('permits auth, MFA step-up, and GDPR export download paths', () => {
    expect(isFreezeAllowedPath('POST', '/v1/auth/login')).toBe(true);
    expect(isFreezeAllowedPath('POST', '/v1/mfa/verify')).toBe(true);
    expect(isFreezeAllowedPath('POST', '/v1/sessions/logout')).toBe(true);
    expect(isFreezeAllowedPath('POST', '/v1/me/data/export')).toBe(true);
  });
  it('blocks every other write path', () => {
    expect(isFreezeAllowedPath('POST', '/v1/ingest')).toBe(false);
    expect(isFreezeAllowedPath('PUT', '/v1/conversations/abc')).toBe(false);
    expect(isFreezeAllowedPath('PATCH', '/v1/keys/k1')).toBe(false);
    expect(isFreezeAllowedPath('DELETE', '/v1/history/h1')).toBe(false);
  });
});

describe('freeze plugin enforcement (integration)', () => {
  async function build() {
    const app = Fastify();
    const audited: Array<{ action: string; resource: string }> = [];
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async (e: { action: string; resource: string }) => { audited.push(e); } },
    } as never);
    await app.register(workspaceFreezePlugin);
    // Two probe routes: one mutating, one read-only.
    app.post('/v1/ingest', async () => ({ ok: true }));
    app.get('/v1/search', async () => ({ results: [] }));
    app.post('/v1/workspace/freeze', async () => ({ ok: 'freeze-endpoint' }));
    return { app, audited };
  }

  it('returns 423 on writes when the workspace is frozen, but allows reads and the freeze endpoint', async () => {
    await freezeWorkspace(dir, 'owner-1', { reason: 'incident-response', ticket: 'SEC-7' });
    invalidateFreezeCache();
    const { app, audited } = await build();

    const blocked = await app.inject({ method: 'POST', url: '/v1/ingest', payload: {} });
    expect(blocked.statusCode).toBe(423);
    const body = JSON.parse(blocked.payload);
    expect(body.error).toBe('workspace frozen');
    expect(body.ticket).toBe('SEC-7');
    expect(body.reason).toBe('incident-response');

    const read = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(read.statusCode).toBe(200);

    const freezeMgmt = await app.inject({ method: 'POST', url: '/v1/workspace/freeze', payload: {} });
    expect(freezeMgmt.statusCode).toBe(200);

    expect(audited.some((e) => e.action === 'workspace-freeze.denied' && e.resource === '/v1/ingest')).toBe(true);
  });

  it('permits writes again after release', async () => {
    await freezeWorkspace(dir, 'owner-1', {});
    invalidateFreezeCache();
    const { app } = await build();
    expect((await app.inject({ method: 'POST', url: '/v1/ingest', payload: {} })).statusCode).toBe(423);
    await releaseFreeze(dir, 'owner-1');
    invalidateFreezeCache();
    expect((await app.inject({ method: 'POST', url: '/v1/ingest', payload: {} })).statusCode).toBe(200);
  });
});
