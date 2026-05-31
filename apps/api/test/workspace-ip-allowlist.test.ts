import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import {
  getRecord,
  replaceRecord,
  validate,
  ipAllowedByWorkspace,
  diff,
} from '../src/services/workspace-ip-allowlist.js';
import { workspaceIpAllowlistPlugin } from '../src/plugins/workspace-ip-allowlist.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-wsipal-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('workspace-ip-allowlist service', () => {
  it('starts disabled with an empty rule set', async () => {
    const rec = await getRecord(dir);
    expect(rec.enabled).toBe(false);
    expect(rec.rules).toEqual([]);
  });

  it('rejects enabling with no rules to prevent total lockout-by-empty', () => {
    const v = validate({ enabled: true, rules: [] });
    expect(v.ok).toBe(false);
  });

  it('persists rules, normalises CIDR, and surfaces a diff', async () => {
    const next = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.5/24', label: 'office' }],
    });
    expect(next.rules[0].cidr).toBe('10.0.0.0/24');
    expect(next.enabled).toBe(true);
    expect(next.updatedBy).toBe('u-owner');
    const after = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [
        { cidr: '10.0.0.0/24', label: 'office' },
        { cidr: '203.0.113.7', label: 'bastion' },
      ],
    });
    const d = diff(next, after);
    expect(d.added).toEqual(['203.0.113.7']);
    expect(d.removed).toEqual([]);
  });

  it('ipAllowedByWorkspace returns true when disabled regardless of rules', async () => {
    const rec = await getRecord(dir);
    expect(ipAllowedByWorkspace('203.0.113.7', rec)).toBe(true);
  });

  it('ipAllowedByWorkspace matches CIDR membership when enabled', async () => {
    const rec = await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    expect(ipAllowedByWorkspace('10.0.0.42', rec)).toBe(true);
    expect(ipAllowedByWorkspace('198.51.100.1', rec)).toBe(false);
  });
});

// Build a stub Fastify instance that wires the plugin against the real
// service so we exercise the enforcement path end-to-end.
function buildApp(opts: { dataDir: string; userId: string | null; role?: string; ip?: string }) {
  const app = Fastify();
  app.decorate('clawmind', {
    dataDir: opts.dataDir,
    audit: { write: async () => {} },
  } as unknown as never);
  app.register(
    fp(async (a) => {
      a.addHook('preHandler', async (req) => {
        if (opts.userId) {
          (req as unknown as { user: { id: string; via: string; role?: string } }).user = {
            id: opts.userId,
            via: 'session',
            role: opts.role,
          };
        }
        if (opts.ip) {
          Object.defineProperty(req, 'ip', { value: opts.ip, configurable: true });
        }
      });
    }, { name: 'auth' }),
  );
  app.register(workspaceIpAllowlistPlugin);
  app.get('/v1/ping', async () => ({ ok: true }));
  app.get('/v1/workspace-ip-allowlist', async () => ({ ok: 'controls-open' }));
  app.get('/health', async () => ({ ok: 'health' }));
  return app;
}

describe('workspace-ip-allowlist plugin enforcement', () => {
  it('admits every request when the workspace allowlist is disabled', async () => {
    const app = buildApp({ dataDir: dir, userId: 'u-member', ip: '198.51.100.7' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies authenticated requests from outside the corporate range with 403', async () => {
    await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24', label: 'corp-vpn' }],
    });
    const app = buildApp({ dataDir: dir, userId: 'u-member', ip: '198.51.100.7' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('workspace_ip_not_allowed');
    await app.close();
  });

  it('admits authenticated requests from inside the allowed range', async () => {
    await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({ dataDir: dir, userId: 'u-member', ip: '10.0.0.99' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('applies to every member regardless of role, including owners off-network', async () => {
    await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({
      dataDir: dir,
      userId: 'u-owner',
      role: 'owner',
      ip: '198.51.100.7',
    });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('never gates the management endpoint itself so an owner can always recover', async () => {
    await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({
      dataDir: dir,
      userId: 'u-owner',
      role: 'owner',
      ip: '198.51.100.250',
    });
    const res = await app.inject({ method: 'GET', url: '/v1/workspace-ip-allowlist' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('does not touch /health so liveness probes keep working', async () => {
    await replaceRecord(dir, 'u-owner', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({ dataDir: dir, userId: null });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
