import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { issueKey, listKeys, revokeKey, redact } from '../services/api-keys.js';

const IssueBody = z.object({
  label: z.string().min(1).max(80),
  role: z.enum(['owner', 'reader']).default('owner'),
  ttlMs: z.number().int().positive().max(365 * 24 * 60 * 60_000).nullable().optional(),
});

export const keyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/keys', {
    preHandler: app.requireAuth,
    handler: async (req) => {
      const keys = await listKeys(app.clawmind.dataDir, req.user!.id);
      return { items: keys.map(redact) };
    },
  });

  app.post('/keys', {
    schema: { body: IssueBody },
    preHandler: app.requireRole('owner'),
    handler: async (req) => {
      const issued = await issueKey(app.clawmind.dataDir, {
        userId: req.user!.id,
        label: req.body.label,
        role: req.body.role,
        ttlMs: req.body.ttlMs ?? null,
      });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'api_key.issue', resource: issued.record.id,
        meta: { label: issued.record.label, role: issued.record.role },
      });
      return { key: redact(issued.record), secret: issued.secret };
    },
  });

  app.delete<{ Params: { id: string } }>('/keys/:id', {
    preHandler: app.requireRole('owner'),
    handler: async (req, reply) => {
      const ok = await revokeKey(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'api_key.revoke', resource: req.params.id,
      });
      return { ok: true };
    },
  });
};
