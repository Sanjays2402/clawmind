import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Scopes } from '../scopes.js';
import {
  createDrain,
  listDrains,
  getDrain,
  updateDrain,
  deleteDrain,
  rotateSecret,
  listDeadLetters,
  runOnce,
  validateKind,
} from '../services/audit-drains.js';

// Audit-log SIEM drains.
//
//   GET    /v1/audit/drains                list (admin+)
//   POST   /v1/audit/drains                create (owner + MFA)  -> returns plaintext secret once
//   GET    /v1/audit/drains/:id            single (admin+)
//   PATCH  /v1/audit/drains/:id            toggle/edit URL (owner + MFA)
//   POST   /v1/audit/drains/:id/rotate     mint a fresh shared secret (owner + MFA)
//   DELETE /v1/audit/drains/:id            remove (owner + MFA)
//   GET    /v1/audit/drains/:id/dead       dead-lettered batches (admin+)
//   POST   /v1/audit/drains/:id/flush      force a one-shot worker pass for this drain (owner + MFA)
//
// Every mutation lands in the audit log itself (which then flows back
// through the drain on the next tick), giving a procurement reviewer a
// full record of who pointed the audit feed where.

const KIND = z.enum(['generic', 'splunk-hec', 'datadog']);
const URL_SCHEMA = z.string().min(8).max(2048);

const CreateBody = z
  .object({
    kind: KIND,
    url: URL_SCHEMA,
    secret: z.string().min(16).max(256).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const PatchBody = z
  .object({
    url: URL_SCHEMA.optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.url !== undefined || b.enabled !== undefined, {
    message: 'no_fields',
  });

const IdParam = z.object({ id: z.string().min(1).max(64) });

export const auditDrainsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/audit/drains', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.AuditDrainsRead),
    ],
    handler: async () => {
      const drains = await listDrains(app.clawmind.dataDir);
      return { total: drains.length, drains };
    },
  });

  app.get('/audit/drains/:id', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.AuditDrainsRead),
    ],
    handler: async (req, reply) => {
      const d = await getDrain(app.clawmind.dataDir, req.params.id);
      if (!d) return reply.code(404).send({ error: 'not_found' });
      return { drain: d };
    },
  });

  app.post('/audit/drains', {
    schema: { body: CreateBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AuditDrainsManage),
    ],
    handler: async (req, reply) => {
      if (!validateKind(req.body.kind)) {
        return reply.code(400).send({ error: 'invalid', field: 'kind' });
      }
      const r = await createDrain(app.clawmind.dataDir, req.user!.id, req.body);
      if (!r.ok) return reply.code(400).send({ error: 'invalid', reason: r.reason });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit-drain.create',
        resource: '/v1/audit/drains',
        meta: {
          drainId: r.drain.id,
          kind: r.drain.kind,
          urlHost: safeHost(r.drain.url),
          ip: req.ip,
          requestId: req.id,
        },
      });
      reply.code(201);
      // The secret is surfaced exactly once at create time. After this
      // response the only way to authenticate the receiver again is to
      // rotate, which itself lands in the audit log.
      return {
        drain: {
          id: r.drain.id,
          kind: r.drain.kind,
          url: r.drain.url,
          enabled: r.drain.enabled,
          createdAt: r.drain.createdAt,
          createdBy: r.drain.createdBy,
        },
        secret: r.drain.secret,
      };
    },
  });

  app.patch('/audit/drains/:id', {
    schema: { params: IdParam, body: PatchBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AuditDrainsManage),
    ],
    handler: async (req, reply) => {
      const r = await updateDrain(
        app.clawmind.dataDir,
        req.params.id,
        req.user!.id,
        req.body,
      );
      if (!r.ok) {
        const code = r.reason === 'not_found' ? 404 : 400;
        return reply.code(code).send({ error: r.reason });
      }
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit-drain.update',
        resource: `/v1/audit/drains/${req.params.id}`,
        meta: {
          drainId: req.params.id,
          enabled: r.drain.enabled,
          urlHost: safeHost(r.drain.url),
          ip: req.ip,
          requestId: req.id,
        },
      });
      return { drain: r.drain };
    },
  });

  app.post('/audit/drains/:id/rotate', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AuditDrainsManage),
    ],
    handler: async (req, reply) => {
      const r = await rotateSecret(
        app.clawmind.dataDir,
        req.params.id,
        req.user!.id,
      );
      if (!r.ok) {
        return reply.code(r.reason === 'not_found' ? 404 : 400).send({ error: r.reason });
      }
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit-drain.rotate-secret',
        resource: `/v1/audit/drains/${req.params.id}`,
        meta: { drainId: req.params.id, ip: req.ip, requestId: req.id },
      });
      // Again, returned exactly once.
      return { secret: r.secret };
    },
  });

  app.delete('/audit/drains/:id', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AuditDrainsManage),
    ],
    handler: async (req, reply) => {
      const r = await deleteDrain(app.clawmind.dataDir, req.params.id);
      if (!r.ok) return reply.code(404).send({ error: 'not_found' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit-drain.delete',
        resource: `/v1/audit/drains/${req.params.id}`,
        meta: { drainId: req.params.id, ip: req.ip, requestId: req.id },
      });
      return { ok: true };
    },
  });

  app.get('/audit/drains/:id/dead', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.AuditDrainsRead),
    ],
    handler: async (req) => {
      const dead = await listDeadLetters(app.clawmind.dataDir, req.params.id);
      return { total: dead.length, dead };
    },
  });

  app.post('/audit/drains/:id/flush', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AuditDrainsManage),
    ],
    handler: async (req, reply) => {
      const d = await getDrain(app.clawmind.dataDir, req.params.id);
      if (!d) return reply.code(404).send({ error: 'not_found' });
      const result = await runOnce({
        dataDir: app.clawmind.dataDir,
        iterate: (since) => app.clawmind.audit.iterate({ since }),
      });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit-drain.flush',
        resource: `/v1/audit/drains/${req.params.id}/flush`,
        meta: {
          drainId: req.params.id,
          result,
          ip: req.ip,
          requestId: req.id,
        },
      });
      return { ok: true, result };
    },
  });
};

// Hosts are logged so an operator can spot a misdirected drain without
// us echoing the whole URL (which may carry path tokens like a Splunk
// HEC ingest token in the URL). Stripping anything but the hostname is
// the safe default; the full URL is still readable to scopes with
// AuditDrainsRead.
function safeHost(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return 'invalid';
  }
}
