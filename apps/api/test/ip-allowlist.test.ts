import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import {
  normaliseRule,
  parseRule,
  ipAllowed,
  validate,
  replaceRecord,
  getRecord,
  diff,
} from '../src/services/ip-allowlist.js';
import { ipAllowlistPlugin } from '../src/plugins/ip-allowlist.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-ipal-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('ip-allowlist parsing', () => {
  it('normalises bare IPv4 to /32', () => {
    expect(normaliseRule('203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseRule(' 203.0.113.7/32 ')).toBe('203.0.113.7');
  });

  it('masks a CIDR to the network address', () => {
    expect(normaliseRule('10.0.0.5/24')).toBe('10.0.0.0/24');
    expect(normaliseRule('192.168.255.255/16')).toBe('192.168.0.0/16');
  });

  it('rejects leading zeros, garbage, and out-of-range octets', () => {
    expect(normaliseRule('10.0.01.0/24')).toBeNull();
    expect(normaliseRule('256.0.0.0')).toBeNull();
    expect(normaliseRule('not an ip')).toBeNull();
    expect(normaliseRule('10.0.0.0/40')).toBeNull();
  });

  it('parses and compacts IPv6', () => {
    expect(normaliseRule('2001:0db8:0000:0000:0000:0000:0000:0001'))
      .toBe('2001:db8::1');
    expect(normaliseRule('2001:db8:abcd:0012::/64')).toBe('2001:db8:abcd:12::/64');
  });
});

describe('ip-allowlist matching', () => {
  it('matches a single host rule', () => {
    expect(ipAllowed('203.0.113.7', [{ cidr: '203.0.113.7' }])).toBe(true);
    expect(ipAllowed('203.0.113.8', [{ cidr: '203.0.113.7' }])).toBe(false);
  });

  it('matches an IPv4 CIDR', () => {
    const rules = [{ cidr: '10.0.0.0/24' }];
    expect(ipAllowed('10.0.0.1', rules)).toBe(true);
    expect(ipAllowed('10.0.0.255', rules)).toBe(true);
    expect(ipAllowed('10.0.1.1', rules)).toBe(false);
  });

  it('matches an IPv6 CIDR and refuses cross-family', () => {
    expect(ipAllowed('2001:db8::1', [{ cidr: '2001:db8::/32' }])).toBe(true);
    expect(ipAllowed('2001:db9::1', [{ cidr: '2001:db8::/32' }])).toBe(false);
    expect(ipAllowed('203.0.113.7', [{ cidr: '2001:db8::/32' }])).toBe(false);
  });

  it('treats an empty list as deny-all', () => {
    expect(ipAllowed('203.0.113.7', [])).toBe(false);
  });
});

describe('ip-allowlist validate', () => {
  it('rejects enabling an empty list', () => {
    const v = validate({ enabled: true, rules: [] });
    expect(v.ok).toBe(false);
  });

  it('rejects duplicates after normalisation', () => {
    const v = validate({
      enabled: false,
      rules: [
        { cidr: '10.0.0.0/24' },
        { cidr: ' 10.0.0.5/24 ' }, // same network, masked
      ],
    });
    expect(v.ok).toBe(false);
  });

  it('passes a valid disabled-with-rules document', () => {
    const v = validate({ enabled: false, rules: [{ cidr: '10.0.0.0/24', label: 'office' }] });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.rules[0].label).toBe('office');
  });
});

describe('ip-allowlist persistence', () => {
  it('round-trips a record per user and diffs cleanly', async () => {
    const before = await getRecord(dir, 'u1');
    expect(before.enabled).toBe(false);
    expect(before.rules).toEqual([]);
    const next = await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24', label: 'vpn' }],
    });
    expect(next.enabled).toBe(true);
    expect(next.rules.map((r) => r.cidr)).toEqual(['10.0.0.0/24']);
    const u2 = await getRecord(dir, 'u2');
    expect(u2.rules).toEqual([]); // per-user isolation
    const after = await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [
        { cidr: '10.0.0.0/24', label: 'vpn' },
        { cidr: '203.0.113.7', label: 'office' },
      ],
    });
    const d = diff(next, after);
    expect(d.added).toEqual(['203.0.113.7']);
    expect(d.removed).toEqual([]);
  });
});

// Plugin enforcement. Build a minimal Fastify app that stubs the parts of
// app.clawmind the plugin reads and asserts that allowed/denied requests
// behave correctly.
function buildApp(opts: { dataDir: string; userId: string | null; ip?: string }) {
  const app = Fastify();
  app.decorate('clawmind', {
    dataDir: opts.dataDir,
    audit: { write: async () => {} },
  } as unknown as never);
  app.register(
    fp(async (a) => {
      a.addHook('preHandler', async (req) => {
        if (opts.userId) {
          (req as unknown as { user: { id: string; via: string } }).user = {
            id: opts.userId,
            via: 'session',
          };
        }
        if (opts.ip) {
          Object.defineProperty(req, 'ip', { value: opts.ip, configurable: true });
        }
      });
    }, { name: 'auth' }),
  );
  app.register(ipAllowlistPlugin);
  app.get('/v1/ping', async () => ({ ok: true }));
  app.get('/v1/ip-allowlist', async () => ({ ok: 'controls-open' }));
  app.get('/health', async () => ({ ok: 'health' }));
  return app;
}

describe('ip-allowlist plugin', () => {
  it('lets every request through when the user has no enabled allowlist', async () => {
    const app = buildApp({ dataDir: dir, userId: 'u1', ip: '198.51.100.1' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies a request from outside the allowlist with 403', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24', label: 'vpn' }],
    });
    const app = buildApp({ dataDir: dir, userId: 'u1', ip: '198.51.100.7' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('ip_not_allowed');
    await app.close();
  });

  it('admits a request from inside the allowlist', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({ dataDir: dir, userId: 'u1', ip: '10.0.0.42' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('does not gate /health regardless of the allowlist state', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({ dataDir: dir, userId: null });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('never gates the allowlist management endpoint itself so users can recover', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    const app = buildApp({ dataDir: dir, userId: 'u1', ip: '198.51.100.99' });
    const res = await app.inject({ method: 'GET', url: '/v1/ip-allowlist' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('isolates allowlists per user: u1\'s deny does not affect u2', async () => {
    await replaceRecord(dir, 'u1', {
      enabled: true,
      rules: [{ cidr: '10.0.0.0/24' }],
    });
    // u2 has no record at all
    const app = buildApp({ dataDir: dir, userId: 'u2', ip: '198.51.100.7' });
    const res = await app.inject({ method: 'GET', url: '/v1/ping' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

describe('parseRule edge cases', () => {
  it('treats /0 as match-any of its family', () => {
    const r = parseRule('0.0.0.0/0');
    expect(r).not.toBeNull();
    expect(ipAllowed('1.2.3.4', [{ cidr: '0.0.0.0/0' }])).toBe(true);
  });
});
