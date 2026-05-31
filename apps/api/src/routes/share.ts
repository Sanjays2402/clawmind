import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createShare,
  readShare,
  bumpViews,
  listSharesByUser,
  deleteShare,
} from '../services/share.js';
import { Scopes } from '../scopes.js';
import { notify } from '../services/notifications.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Public shares: any signed-in user can mint a /s/<id> link that anyone on
// the internet can read without auth. We also let owners list and revoke
// their shares so a leaked link is easy to kill.
//
//   POST   /v1/share              create a share (auth required)
//   GET    /v1/share/:id          read share + bump view count (public)
//   GET    /v1/shares             list shares I created (auth required)
//   DELETE /v1/share/:id          revoke a share I created (auth required)

const ShareBody = z.object({
  query: z.string().min(1).max(4000),
  answer: z.string().min(1).max(40_000),
  sources: z.array(z.any()).max(64),
});

const IdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/share', {
    schema: { body: ShareBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ShareWrite)],
    handler: async (req) => {
      const id = await createShare(app.clawmind.dataDir, {
        ...req.body,
        userId: req.user!.id,
      });
      return { id, url: `/s/${id}` };
    },
  });

  // Public read. Intentionally has no auth so /s/<id> works from incognito,
  // embeds, and link previews.
  app.get('/share/:id', {
    schema: { params: IdParam },
    handler: async (req, reply) => {
      const data = await readShare(app.clawmind.dataDir, req.params.id);
      if (!data) return reply.code(404).send({ error: 'not found' });
      // Fire and forget. We do not await the bump on the response path so a
      // slow disk write never adds latency to the public viewer.
      void bumpViews(app.clawmind.dataDir, req.params.id).then((views) => {
        // Notify the share owner on every view, but dedupe on the share id so
        // refreshes don't spam the inbox; the row's title is overwritten with
        // the latest count.
        if (data.userId) {
          const noun = views === 1 ? 'view' : 'views';
          void notify(app.clawmind.dataDir, {
            userId: data.userId,
            kind: 'share.viewed',
            title: `Your shared answer has ${views} ${noun}`,
            body: data.query.slice(0, 200),
            href: `/shares`,
            dedupeKey: `share:${req.params.id}`,
            meta: { shareId: req.params.id, views },
          });
        }
      });
      return data;
    },
  });

  app.get('/shares', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ShareRead)],
    handler: async (req) => {
      const items = await listSharesByUser(app.clawmind.dataDir, req.user!.id);
      return { items };
    },
  });

  app.delete('/share/:id', {
    schema: { params: IdParam, querystring: DryRunQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ShareWrite)],
    handler: async (req, reply) => {
      const dryRun = isDryRun((req.query as { dry_run?: string }).dry_run);
      if (dryRun) {
        const all = await listSharesByUser(app.clawmind.dataDir, req.user!.id);
        const target = all.find((s) => s.id === req.params.id);
        if (!target) return reply.code(404).send({ error: 'not found' });
        await app.clawmind.audit.write({
          actor: req.user!.id, action: auditAction('share.delete', true),
          resource: req.params.id, meta: { dryRun: true, query: target.query, createdAt: target.createdAt },
        });
        return { dryRun: true, id: req.params.id, wouldRevoke: true };
      }
      const ok = await deleteShare(app.clawmind.dataDir, req.params.id, req.user!.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      return { id: req.params.id, deleted: true };
    },
  });
};
