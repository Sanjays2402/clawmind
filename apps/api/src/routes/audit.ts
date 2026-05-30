import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Scopes } from '../scopes.js';

// Compliance review endpoint for the persisted audit log. Owner role plus
// the audit:read scope are both required, so an API key issued for a
// narrow automation task cannot quietly tail user activity. The log is
// the source of truth a regulator or incident responder reads, so we
// expose filters (actor, action substring, resource prefix, time window)
// without exposing a way to mutate or delete entries.
//
//   GET /v1/admin/audit?actor=...&action=...&resource=...&since=...&until=...&limit=...&offset=...
//
// since / until are epoch milliseconds. limit is capped at 1000 by
// AuditLog.query so a buggy client cannot OOM the server.

const querySchema = z.object({
  actor: z.string().min(1).max(256).optional(),
  action: z.string().min(1).max(256).optional(),
  resource: z.string().min(1).max(512).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get('/admin/audit', {
    schema: { querystring: querySchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req) => {
      const q = req.query as z.infer<typeof querySchema>;
      const result = await app.clawmind.audit.query(q);
      // Record the review itself so a tampered or curious reader leaves a
      // trace in the very log they just inspected.
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.query',
        resource: '/v1/admin/audit',
        meta: {
          filters: q,
          returned: result.events.length,
          total: result.total,
        },
      });
      return result;
    },
  });
};
