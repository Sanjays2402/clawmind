import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import {
  scheduleDeletion,
  cancelDeletion,
  markCompleted,
  getDeletion,
  isPending,
  isPastDue,
  isDeletionAllowedPath,
  invalidateDeletionCache,
  WorkspaceDeletionValidationError,
  WorkspaceDeletionStateError,
  MIN_GRACE_MS,
  DEFAULT_GRACE_MS,
  MAX_GRACE_MS,
} from '../src/services/workspace-deletion.js';
import { workspaceDeletionPlugin } from '../src/plugins/workspace-deletion.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-del-'));
  invalidateDeletionCache();
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('workspace deletion service', () => {
  it('defaults to state none when no file exists', async () => {
    const d = await getDeletion(dir);
    expect(d.state).toBe('none');
    expect(d.scheduledFor).toBeNull();
    expect(await isPending(dir)).toBe(false);
  });

  it('schedules with default grace window and records actor', async () => {
    const before = Date.now();
    const d = await scheduleDeletion(dir, 'owner-1', { reason: 'exit-clause', ticket: 'CS-9' });
    expect(d.state).toBe('pending');
    expect(d.scheduledBy).toBe('owner-1');
    expect(d.graceMs).toBe(DEFAULT_GRACE_MS);
    expect(d.scheduledFor).toBeGreaterThanOrEqual(before + DEFAULT_GRACE_MS - 1000);
    expect(d.reason).toBe('exit-clause');
    expect(d.ticket).toBe('CS-9');
    invalidateDeletionCache();
    expect(await isPending(dir)).toBe(true);
  });

  it('accepts a custom grace window within the clamp', async () => {
    const d = await scheduleDeletion(dir, 'owner-1', { graceMs: MIN_GRACE_MS });
    expect(d.graceMs).toBe(MIN_GRACE_MS);
  });

  it('rejects grace windows below the floor or above the ceiling', async () => {
    await expect(
      scheduleDeletion(dir, 'owner-1', { graceMs: MIN_GRACE_MS - 1 }),
    ).rejects.toBeInstanceOf(WorkspaceDeletionValidationError);
    invalidateDeletionCache();
    await expect(
      scheduleDeletion(dir, 'owner-1', { graceMs: MAX_GRACE_MS + 1 }),
    ).rejects.toBeInstanceOf(WorkspaceDeletionValidationError);
  });

  it('refuses to schedule when one is already pending', async () => {
    await scheduleDeletion(dir, 'owner-1', {});
    await expect(scheduleDeletion(dir, 'owner-1', {})).rejects.toBeInstanceOf(
      WorkspaceDeletionStateError,
    );
  });

  it('cancels a pending deletion and preserves history', async () => {
    const a = await scheduleDeletion(dir, 'owner-1', { ticket: 'CS-9' });
    const b = await cancelDeletion(dir, 'owner-2');
    expect(b.state).toBe('cancelled');
    expect(b.cancelledBy).toBe('owner-2');
    expect(b.scheduledFor).toBe(a.scheduledFor);
    expect(b.ticket).toBe('CS-9');
    invalidateDeletionCache();
    expect(await isPending(dir)).toBe(false);
  });

  it('refuses to cancel when nothing is pending', async () => {
    await expect(cancelDeletion(dir, 'owner-1')).rejects.toBeInstanceOf(
      WorkspaceDeletionStateError,
    );
  });

  it('refuses to mark completed before the scheduled window elapses', async () => {
    await scheduleDeletion(dir, 'owner-1', { graceMs: MIN_GRACE_MS });
    await expect(markCompleted(dir, 'owner-1')).rejects.toBeInstanceOf(
      WorkspaceDeletionStateError,
    );
  });

  it('detects past-due records once scheduledFor is in the past', async () => {
    const d = await scheduleDeletion(dir, 'owner-1', { graceMs: MIN_GRACE_MS });
    expect(isPastDue(d)).toBe(false);
    expect(isPastDue(d, (d.scheduledFor ?? 0) + 1)).toBe(true);
  });

  it('rejects oversized reason and ticket strings', async () => {
    await expect(
      scheduleDeletion(dir, 'u', { reason: 'x'.repeat(2000) }),
    ).rejects.toBeInstanceOf(WorkspaceDeletionValidationError);
    invalidateDeletionCache();
    await expect(
      scheduleDeletion(dir, 'u', { ticket: 'y'.repeat(2000) }),
    ).rejects.toBeInstanceOf(WorkspaceDeletionValidationError);
  });
});

describe('deletion allowlist', () => {
  it('always permits read methods', () => {
    expect(isDeletionAllowedPath('GET', '/v1/search?q=x')).toBe(true);
    expect(isDeletionAllowedPath('HEAD', '/v1/anything')).toBe(true);
    expect(isDeletionAllowedPath('OPTIONS', '/v1/keys')).toBe(true);
  });
  it('permits the deletion endpoint itself so owners can cancel', () => {
    expect(isDeletionAllowedPath('POST', '/v1/workspace/deletion')).toBe(true);
    expect(isDeletionAllowedPath('DELETE', '/v1/workspace/deletion')).toBe(true);
    expect(isDeletionAllowedPath('POST', '/v1/workspace/deletion/complete')).toBe(true);
  });
  it('permits auth, MFA step-up, and export paths', () => {
    expect(isDeletionAllowedPath('POST', '/v1/auth/login')).toBe(true);
    expect(isDeletionAllowedPath('POST', '/v1/mfa/verify')).toBe(true);
    expect(isDeletionAllowedPath('POST', '/v1/sessions/logout')).toBe(true);
    expect(isDeletionAllowedPath('POST', '/v1/me/data/export')).toBe(true);
    expect(isDeletionAllowedPath('POST', '/v1/workspace/export')).toBe(true);
  });
  it('blocks every other write path', () => {
    expect(isDeletionAllowedPath('POST', '/v1/ingest')).toBe(false);
    expect(isDeletionAllowedPath('PATCH', '/v1/keys/abc')).toBe(false);
    expect(isDeletionAllowedPath('DELETE', '/v1/saved/x')).toBe(false);
  });
});

describe('deletion gate plugin', () => {
  it('returns 423 with deletion metadata when pending', async () => {
    await scheduleDeletion(dir, 'owner-1', { ticket: 'CS-9', reason: 'wind-down' });
    const app = Fastify();
    // Minimal app.clawmind surface the plugin reads from.
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async () => undefined },
    } as never);
    await app.register(workspaceDeletionPlugin);
    app.post('/v1/ingest', async () => ({ ok: true }));
    app.get('/v1/search', async () => ({ ok: true }));

    invalidateDeletionCache();
    const blocked = await app.inject({ method: 'POST', url: '/v1/ingest' });
    expect(blocked.statusCode).toBe(423);
    const body = blocked.json();
    expect(body.error).toBe('workspace deletion pending');
    expect(body.ticket).toBe('CS-9');
    expect(typeof body.scheduledFor).toBe('number');

    const allowed = await app.inject({ method: 'GET', url: '/v1/search?q=x' });
    expect(allowed.statusCode).toBe(200);

    const cancelOk = await app.inject({ method: 'DELETE', url: '/v1/workspace/deletion' });
    // 404 because we did not register the route, but the gate let it through.
    expect(cancelOk.statusCode).not.toBe(423);
  });

  it('lets writes through once cancelled', async () => {
    await scheduleDeletion(dir, 'owner-1', {});
    await cancelDeletion(dir, 'owner-1');
    invalidateDeletionCache();

    const app = Fastify();
    app.decorate('clawmind', {
      dataDir: dir,
      audit: { write: async () => undefined },
    } as never);
    await app.register(workspaceDeletionPlugin);
    app.post('/v1/ingest', async () => ({ ok: true }));

    const res = await app.inject({ method: 'POST', url: '/v1/ingest' });
    expect(res.statusCode).toBe(200);
  });
});
