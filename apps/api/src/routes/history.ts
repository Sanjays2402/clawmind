import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listHistory, pruneHistory, deleteHistoryItem } from '../services/history.js';
import { historyToCsv, historyToJson, historyToMarkdown } from '../services/history-export.js';
import { Scopes } from '../scopes.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  q: z.string().min(1).max(200).optional(),
  // Comma-separated list of namespaces; expanded server-side.
  namespaces: z.string().optional(),
});

const ExportQuery = z.object({
  limit: z.coerce.number().int().min(1).max(10000).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  q: z.string().min(1).max(200).optional(),
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

  // Export current user's history in the format hinted by the URL extension.
  // Filters mirror GET /history so a customer can download exactly what the
  // history UI is showing. Output is streamed as a download (Content-
  // Disposition: attachment) so browsers save it instead of rendering it.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/history/export.${fmt}`, {
      schema: { querystring: ExportQuery },
      preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryRead)],
      handler: async (req, reply) => {
        const { limit, since, until, q, namespaces } = req.query as z.infer<typeof ExportQuery>;
        const ns = namespaces
          ? namespaces.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const items = await listHistory(app.clawmind.dataDir, req.user!.id, {
          limit: limit ?? 1000, since, until, q, namespaces: ns,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-history-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(historyToJson(items));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(historyToCsv(items));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(historyToMarkdown(items));
      },
    });
  }

  // Delete a single history entry owned by the caller. Lets users purge one
  // bad answer or a private question without nuking their whole log. The id
  // must belong to the caller; mismatches return 404 to avoid leaking
  // whether another user owns it.
  app.delete('/history/:id', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await deleteHistoryItem(app.clawmind.dataDir, req.user!.id, id);
      if (!ok) {
        return reply.code(404).send({ error: 'history entry not found' });
      }
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'history.delete-item',
        resource: 'history',
        meta: { id },
      });
      return { id, deleted: true };
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
