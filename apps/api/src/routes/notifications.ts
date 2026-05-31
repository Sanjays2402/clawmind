import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  list,
  unreadCount,
  markRead,
  markAllRead,
  remove,
  clear,
  countAll,
} from '../services/notifications.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// In-app notification inbox.
//
//   GET    /v1/notifications              list, newest first
//   GET    /v1/notifications/unread-count cheap badge fetch
//   POST   /v1/notifications/read         { ids: [] } | { all: true }
//   DELETE /v1/notifications/:id          remove one
//   DELETE /v1/notifications              clear inbox
//
// All routes are owner-scoped: the data dir stores one file per user id, so
// a token authenticated as user A cannot read user B's inbox.

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  unread: z.coerce.boolean().optional(),
});

const ReadBody = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

const IdParam = z.object({ id: z.string().min(1).max(64) });

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/notifications', {
    schema: { querystring: ListQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationsRead)],
    handler: async (req) => {
      const items = await list(app.clawmind.dataDir, req.user!.id, {
        limit: req.query.limit ?? 50,
        unreadOnly: req.query.unread ?? false,
      });
      const unread = await unreadCount(app.clawmind.dataDir, req.user!.id);
      return { items, unread };
    },
  });

  app.get('/notifications/unread-count', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationsRead)],
    handler: async (req) => {
      const unread = await unreadCount(app.clawmind.dataDir, req.user!.id);
      return { unread };
    },
  });

  app.post('/notifications/read', {
    schema: { body: ReadBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationsWrite)],
    handler: async (req) => {
      const body = req.body as { ids?: string[]; all?: true };
      const touched = body.all
        ? await markAllRead(app.clawmind.dataDir, req.user!.id)
        : await markRead(app.clawmind.dataDir, req.user!.id, body.ids ?? []);
      return { touched };
    },
  });

  app.delete('/notifications/:id', {
    schema: { params: IdParam, querystring: DryRunQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationsWrite)],
    handler: async (req, reply) => {
      const dryRun = isDryRun((req.query as { dry_run?: string }).dry_run);
      if (dryRun) {
        const items = await list(app.clawmind.dataDir, req.user!.id, { limit: 200 });
        const exists = items.some((i) => i.id === req.params.id);
        if (!exists) return reply.code(404).send({ error: 'not found' });
        await app.clawmind.audit.write({
          actor: req.user!.id, action: auditAction('notification.delete', true),
          resource: req.params.id, meta: { dryRun: true, wouldRemove: 1 },
        });
        return { dryRun: true, id: req.params.id, wouldRemove: 1 };
      }
      const ok = await remove(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      return { id: req.params.id, deleted: true };
    },
  });

  app.delete('/notifications', {
    schema: { querystring: DryRunQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationsWrite)],
    handler: async (req) => {
      const dryRun = isDryRun((req.query as { dry_run?: string }).dry_run);
      if (dryRun) {
        const wouldClear = await countAll(app.clawmind.dataDir, req.user!.id);
        await app.clawmind.audit.write({
          actor: req.user!.id, action: auditAction('notifications.clear', true),
          resource: 'notifications', meta: { dryRun: true, wouldClear },
        });
        return { dryRun: true, wouldClear };
      }
      const cleared = await clear(app.clawmind.dataDir, req.user!.id);
      return { cleared };
    },
  });
};
