import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AuditLog } from '@clawmind/store';
import { piiRedactionRoutes } from '../src/routes/pii-redaction.js';
import {
  applyRedaction,
  getPolicy,
  updatePolicy,
} from '../src/services/pii-redaction.js';
import { enforcePiiRedaction } from '../src/lib/pii-redaction-gate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-pii-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

type Role = 'owner' | 'admin' | 'member' | 'viewer' | 'reader';
const RANK: Record<Role, number> = { reader: 0, viewer: 0, member: 1, admin: 2, owner: 3 };

function buildApp(opts: {
  user: { id: string; role: Role; scopes?: string[] | null; mfa?: boolean } | null;
}) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(sensible);
  const audit = new AuditLog(join(dir, 'audit.log'));
  app.decorate('clawmind', { audit, dataDir: dir } as never);
  app.addHook('preHandler', async (req) => {
    if (opts.user) (req as any).user = { ...opts.user, github: null, via: 'session' };
  });
  app.decorate('requireAuth', async (req: any, reply: any) => {
    if (!req.user) reply.code(401).send({ error: 'auth required' });
  });
  app.decorate('requireMinRole', (min: Role) => async (req: any, reply: any) => {
    if (!req.user) return reply.code(401).send({ error: 'auth required' });
    if (RANK[req.user.role as Role] < RANK[min]) {
      reply.code(403).send({ error: 'role insufficient', required: min });
    }
  });
  app.decorate('requireScope', (scope: string) => async (req: any, reply: any) => {
    const s = req.user?.scopes;
    if (s && !s.includes('*') && !s.includes(scope)) {
      reply.code(403).send({ error: 'scope required', scope });
    }
  });
  app.decorate('requireMfa', async (req: any, reply: any) => {
    if (!req.user?.mfa) reply.code(401).send({ error: 'mfa required' });
  });
  app.register(piiRedactionRoutes, { prefix: '/v1' });
  return { app, audit };
}

describe('pii-redaction service', () => {
  it('returns built-in defaults when no policy file exists', async () => {
    const p = await getPolicy(dir);
    expect(p.builtins.email).toBe('redact');
    expect(p.builtins.ssn).toBe('block');
    expect(p.builtins.credit_card).toBe('block');
    expect(p.builtins.ipv4).toBe('off');
    expect(p.custom).toEqual([]);
  });

  it('redacts an email in place under default policy', () => {
    const p = {
      version: 1 as const,
      builtins: { email: 'redact', phone: 'off', ssn: 'off', credit_card: 'off', ipv4: 'off' } as any,
      custom: [],
      updatedAt: 0,
      updatedBy: null,
    };
    const r = applyRedaction('contact alice@example.com about the bug', p);
    expect(r.redacted).toBe('contact [REDACTED:email] about the bug');
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.className).toBe('email');
    expect(r.matches[0]!.count).toBe(1);
    expect(r.blockedBy).toBeNull();
  });

  it('blocks a Luhn-valid credit card and does not modify the query', () => {
    const p = {
      version: 1 as const,
      builtins: { email: 'off', phone: 'off', ssn: 'off', credit_card: 'block', ipv4: 'off' } as any,
      custom: [],
      updatedAt: 0,
      updatedBy: null,
    };
    // 4242 4242 4242 4242 is the canonical Stripe test number; Luhn-valid.
    const r = applyRedaction('charge 4242 4242 4242 4242 now', p);
    expect(r.blockedBy).toBe('credit_card');
    expect(r.matches[0]!.action).toBe('block');
  });

  it('does NOT flag a random 16-digit non-Luhn number as a card', () => {
    const p = {
      version: 1 as const,
      builtins: { email: 'off', phone: 'off', ssn: 'off', credit_card: 'block', ipv4: 'off' } as any,
      custom: [],
      updatedAt: 0,
      updatedBy: null,
    };
    const r = applyRedaction('order id 1234567890123456 details', p);
    expect(r.blockedBy).toBeNull();
    expect(r.matches).toHaveLength(0);
  });

  it('blocks SSN pattern with default policy', () => {
    const p = {
      version: 1 as const,
      builtins: { email: 'off', phone: 'off', ssn: 'block', credit_card: 'off', ipv4: 'off' } as any,
      custom: [],
      updatedAt: 0,
      updatedBy: null,
    };
    const r = applyRedaction('the patient ssn is 123-45-6789', p);
    expect(r.blockedBy).toBe('ssn');
  });

  it('rejects an invalid custom regex at write time', async () => {
    await expect(
      updatePolicy(dir, 'u', { custom: [{ label: 'bad', pattern: '([unterminated', action: 'redact' }] }),
    ).rejects.toThrow(/invalid regex/);
  });

  it('rejects a custom label with unsafe characters', async () => {
    await expect(
      updatePolicy(dir, 'u', { custom: [{ label: 'bad label!', pattern: 'x', action: 'redact' }] }),
    ).rejects.toThrow(/alphanumeric/);
  });

  it('persists a custom rule and applies it', async () => {
    await updatePolicy(dir, 'u', {
      builtins: { email: 'off', phone: 'off', ssn: 'off', credit_card: 'off', ipv4: 'off' },
      custom: [{ label: 'acct', pattern: 'ACME-\\d{4}', action: 'redact' }],
    });
    const p = await getPolicy(dir);
    expect(p.custom).toHaveLength(1);
    const r = applyRedaction('ticket ACME-9981 is open', p);
    expect(r.redacted).toBe('ticket [REDACTED:acct] is open');
    expect(r.matches[0]!.className).toBe('acct');
  });
});

describe('pii-redaction routes', () => {
  it('returns 403 to a member with read scope', async () => {
    const { app } = buildApp({ user: { id: 'u1', role: 'member', scopes: ['pii-redaction:read'] } });
    const res = await app.inject({ method: 'GET', url: '/v1/pii-redaction' });
    expect(res.statusCode).toBe(403);
  });

  it('returns the policy for an admin with read scope', async () => {
    const { app } = buildApp({ user: { id: 'u1', role: 'admin', scopes: ['pii-redaction:read'] } });
    const res = await app.inject({ method: 'GET', url: '/v1/pii-redaction' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.policy.builtins.ssn).toBe('block');
  });

  it('requires owner + MFA + manage scope to update the policy', async () => {
    const { app } = buildApp({ user: { id: 'u1', role: 'admin', scopes: ['pii-redaction:admin'], mfa: true } });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/pii-redaction',
      payload: { builtins: { ipv4: 'redact' } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner with MFA can update the policy and the change is audit-logged', async () => {
    const { app, audit } = buildApp({
      user: { id: 'u1', role: 'owner', scopes: ['*'], mfa: true },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/pii-redaction',
      payload: { builtins: { ipv4: 'redact' } },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as any).policy.builtins.ipv4).toBe('redact');
    const lines = (await audit.query({ limit: 10 })).events;
    expect(lines.some((l) => l.action === 'pii-redaction.update')).toBe(true);
  });

  it('rejects an invalid custom regex with a structured 400', async () => {
    const { app } = buildApp({
      user: { id: 'u1', role: 'owner', scopes: ['*'], mfa: true },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/pii-redaction',
      payload: { custom: [{ label: 'bad', pattern: '([unterminated', action: 'redact' }] },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as any).field).toBe('custom.pattern');
  });
});

describe('pii-redaction gate', () => {
  it('redacts the query in place and returns ok with the rewritten value', async () => {
    const { app } = buildApp({ user: { id: 'u1', role: 'owner', scopes: ['*'], mfa: true } });
    // Use the default policy (email = redact)
    const fakeReply = {
      code: () => fakeReply,
      send: () => fakeReply,
    } as any;
    const r = await enforcePiiRedaction(
      app as any,
      fakeReply,
      'u1',
      '/v1/ask',
      'email me at bob@example.com please',
    );
    expect(r.ok).toBe(true);
    expect(r.query).toBe('email me at [REDACTED:email] please');
  });

  it('blocks a query containing an SSN and replies 422 with pii-blocked', async () => {
    const { app } = buildApp({ user: { id: 'u1', role: 'owner', scopes: ['*'], mfa: true } });
    let status: number | null = null;
    let payload: any = null;
    const fakeReply = {
      code(c: number) {
        status = c;
        return this;
      },
      send(p: any) {
        payload = p;
        return this;
      },
    } as any;
    const r = await enforcePiiRedaction(
      app as any,
      fakeReply,
      'u1',
      '/v1/ask',
      'lookup patient 123-45-6789 history',
    );
    expect(r.ok).toBe(false);
    expect(status).toBe(422);
    expect(payload.error).toBe('pii-blocked');
    expect(payload.class).toBe('ssn');
  });
});
