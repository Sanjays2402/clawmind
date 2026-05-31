import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  getPolicy,
  enablePolicy,
  disablePolicy,
  evaluateUser,
  isMfaPolicyAllowedPath,
  invalidateCache,
  MfaPolicyValidationError,
  DEFAULT_GRACE_DAYS,
  MAX_GRACE_DAYS,
} from '../src/services/mfa-policy.js';
import { mfaPolicyPlugin } from '../src/plugins/mfa-policy.js';

let dir: string;

function writeConfirmedMfa(userId: string): void {
  mkdirSync(join(dir, 'mfa'), { recursive: true });
  const safe = userId.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  writeFileSync(
    join(dir, 'mfa', `${safe}.json`),
    JSON.stringify({
      version: 1,
      record: {
        userId,
        secret: 'JBSWY3DPEHPK3PXP',
        confirmedAt: Date.now(),
        createdAt: Date.now(),
        recoveryCodeHashes: [],
        lastVerifiedCounter: null,
      },
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-mfa-policy-'));
  invalidateCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('mfa-policy service', () => {
  it('defaults to not enforced with the default grace window', async () => {
    const p = await getPolicy(dir);
    expect(p.enforced).toBe(false);
    expect(p.graceDays).toBe(DEFAULT_GRACE_DAYS);
    expect(p.enforcedAt).toBeNull();
  });

  it('enable stores actor, timestamp, and the configured grace window', async () => {
    const p = await enablePolicy(dir, 'owner-1', { graceDays: 3 });
    expect(p.enforced).toBe(true);
    expect(p.enforcedBy).toBe('owner-1');
    expect(p.graceDays).toBe(3);
    expect(typeof p.enforcedAt).toBe('number');
  });

  it('rejects invalid graceDays', async () => {
    await expect(
      enablePolicy(dir, 'owner-1', { graceDays: -1 }),
    ).rejects.toBeInstanceOf(MfaPolicyValidationError);
    await expect(
      enablePolicy(dir, 'owner-1', { graceDays: MAX_GRACE_DAYS + 1 }),
    ).rejects.toBeInstanceOf(MfaPolicyValidationError);
  });

  it('disable flips enforced off and records the actor', async () => {
    await enablePolicy(dir, 'owner-1', { graceDays: 7 });
    const off = await disablePolicy(dir, 'owner-2');
    expect(off.enforced).toBe(false);
    expect(off.disabledBy).toBe('owner-2');
  });
});

describe('mfa-policy evaluation', () => {
  it('allows everyone when the policy is off', async () => {
    const r = await evaluateUser(dir, 'user-1');
    expect(r.allowed).toBe(true);
  });

  it('allows non-MFA users while inside the grace window', async () => {
    await enablePolicy(dir, 'owner-1', { graceDays: 7 });
    invalidateCache();
    const r = await evaluateUser(dir, 'user-no-mfa', { now: Date.now() });
    expect(r.allowed).toBe(true);
  });

  it('blocks non-MFA users once the grace window has elapsed', async () => {
    const enabled = await enablePolicy(dir, 'owner-1', { graceDays: 1 });
    invalidateCache();
    const future = (enabled.enforcedAt ?? Date.now()) + 2 * 24 * 60 * 60 * 1000;
    const r = await evaluateUser(dir, 'user-no-mfa', { now: future });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('not-enrolled');
      expect(r.graceEndsAt).toBeLessThan(future);
    }
  });

  it('allows MFA-enrolled users even after the grace window', async () => {
    const enabled = await enablePolicy(dir, 'owner-1', { graceDays: 0 });
    invalidateCache();
    writeConfirmedMfa('user-mfa');
    const future = (enabled.enforcedAt ?? Date.now()) + 10 * 24 * 60 * 60 * 1000;
    const r = await evaluateUser(dir, 'user-mfa', { now: future });
    expect(r.allowed).toBe(true);
  });
});

describe('mfa-policy allowlist', () => {
  it('always permits read methods', () => {
    expect(isMfaPolicyAllowedPath('GET', '/v1/search')).toBe(true);
    expect(isMfaPolicyAllowedPath('HEAD', '/v1/ingest')).toBe(true);
  });
  it('permits MFA enrolment, auth, sessions, profile, GDPR self-export', () => {
    expect(isMfaPolicyAllowedPath('POST', '/v1/mfa/enroll')).toBe(true);
    expect(isMfaPolicyAllowedPath('POST', '/auth/oidc/login')).toBe(true);
    expect(isMfaPolicyAllowedPath('POST', '/v1/sessions/logout')).toBe(true);
    expect(isMfaPolicyAllowedPath('POST', '/v1/me/data/export')).toBe(true);
    expect(isMfaPolicyAllowedPath('PUT', '/v1/mfa-policy')).toBe(true);
  });
  it('blocks every other write path', () => {
    expect(isMfaPolicyAllowedPath('POST', '/v1/ingest')).toBe(false);
    expect(isMfaPolicyAllowedPath('DELETE', '/v1/history/h1')).toBe(false);
    expect(isMfaPolicyAllowedPath('PATCH', '/v1/keys/k1')).toBe(false);
  });
});

describe('mfa-policy plugin integration', () => {
  async function build(user: { id: string; via: 'session' | 'api-key' }) {
    const app = Fastify();
    const audited: Array<{ action: string; resource: string }> = [];
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async (e: { action: string; resource: string }) => { audited.push(e); } },
    } as never);
    // Stand-in auth: stamp a user on every request so the gate has someone
    // to evaluate. Mirrors the position of the real auth plugin in the
    // server registration order.
    app.addHook('preHandler', async (req) => {
      (req as unknown as { user: typeof user }).user = user;
    });
    await app.register(mfaPolicyPlugin);
    app.post('/v1/ingest', async () => ({ ok: true }));
    app.get('/v1/search', async () => ({ results: [] }));
    app.post('/v1/mfa/enroll', async () => ({ ok: true }));
    return { app, audited };
  }

  it('returns 412 on writes for a non-MFA session user after grace elapses', async () => {
    // Set the policy to a moment far enough in the past that the grace
    // window is already exhausted.
    const longAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'mfa-policy.json'),
      JSON.stringify({
        version: 1,
        policies: [{
          workspaceId: 'default',
          enforced: true,
          graceDays: 1,
          enforcedAt: longAgo,
          enforcedBy: 'owner-1',
          disabledAt: null,
          disabledBy: null,
          updatedAt: longAgo,
        }],
      }),
    );
    invalidateCache();
    const { app, audited } = await build({ id: 'user-no-mfa', via: 'session' });

    const blocked = await app.inject({ method: 'POST', url: '/v1/ingest', payload: {} });
    expect(blocked.statusCode).toBe(412);
    const body = JSON.parse(blocked.payload);
    expect(body.error).toBe('mfa_enrollment_required');
    expect(body.enrollUrl).toBe('/settings/mfa');

    // Reads still work.
    const read = await app.inject({ method: 'GET', url: '/v1/search' });
    expect(read.statusCode).toBe(200);

    // The enrolment route itself stays reachable so the user can recover.
    const enrol = await app.inject({ method: 'POST', url: '/v1/mfa/enroll', payload: {} });
    expect(enrol.statusCode).toBe(200);

    expect(audited.some((e) => e.action === 'mfa-policy.denied' && e.resource === '/v1/ingest')).toBe(true);
  });

  it('lets api-key callers through unchanged', async () => {
    await enablePolicy(dir, 'owner-1', { graceDays: 0 });
    invalidateCache();
    const { app } = await build({ id: 'svc-bot', via: 'api-key' });
    const r = await app.inject({ method: 'POST', url: '/v1/ingest', payload: {} });
    expect(r.statusCode).toBe(200);
  });

  it('lets MFA-enrolled session users through', async () => {
    await enablePolicy(dir, 'owner-1', { graceDays: 0 });
    invalidateCache();
    writeConfirmedMfa('user-mfa');
    const { app } = await build({ id: 'user-mfa', via: 'session' });
    const r = await app.inject({ method: 'POST', url: '/v1/ingest', payload: {} });
    expect(r.statusCode).toBe(200);
  });
});
