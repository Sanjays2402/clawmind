import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listHistory, pruneHistory } from '../services/history.js';
import { Scopes } from '../scopes.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  q: z.string().min(1).max(200).optional(),
  // Comma-separated list of namespaces; expanded server-side.
  namespaces: z.string().optional(),
});

const PruneQuery = z.object({
  before: z.coerce.number().int().nonnegative().optional(),
  keepPerUser: z.coerce.number().int().nonnegative().max(10000).optional(),
});

export const historyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/history', {
    schema: { querystring: ListQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryRead)],
    handler: async (req) => {
      const { limit, since, until, q, namespaces } = req.query as z.infer<typeof ListQuery>;
      const ns = namespaces
        ? namespaces.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const items = await listHistory(app.clawmind.dataDir, req.user!.id, {
        limit, since, until, q, namespaces: ns,
      });
      return { items, total: items.length };
    },
  });

  app.delete('/history', {
    schema: { querystring: PruneQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req, reply) => {
      const { before, keepPerUser } = req.query as z.infer<typeof PruneQuery>;
      if (before === undefined && keepPerUser === undefined) {
        return reply.code(400).send({ error: 'specify at least one of: before, keepPerUser' });
      }
      const result = await pruneHistory(app.clawmind.dataDir, req.user!.id, {
        before, keepPerUser,
      });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'history.prune', resource: 'history',
        meta: { before, keepPerUser, ...result },
      });
      return result;
    },
  });
};
