import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createShare,
  readShareRaw,
  bumpViews,
  listSharesByUser,
  deleteShare,
  isExpired,
  DEFAULT_SHARE_TTL_MS,
  MAX_SHARE_TTL_MS,
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
//
// Shares expire by default. The TTL bounds the blast radius of a leaked
// URL: even if a recipient forwards it to the public internet, the link
// silently 410s once the TTL elapses. ttlDays=null requests "never
// expires" and is still hard-capped by MAX_SHARE_TTL_MS in the service.

const MAX_TTL_DAYS = Math.floor(MAX_SHARE_TTL_MS / (24 * 60 * 60 * 1000));
const DEFAULT_TTL_DAYS = Math.floor(DEFAULT_SHARE_TTL_MS / (24 * 60 * 60 * 1000));

const ShareBody = z.object({
  query: z.string().min(1).max(4000),
  answer: z.string().min(1).max(40_000),
  sources: z.array(z.any()).max(64),
  // Optional. Omit for the default 30d TTL. Pass null for "no expiry"
  // (still capped at MAX_TTL_DAYS server-side). Pass a positive integer to
  // request a shorter window, e.g. 1 for a one-day link.
  ttlDays: z.union([z.number().int().min(1).max(MAX_TTL_DAYS), z.null()]).optional(),
});

const IdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/share', {
    schema: { body: ShareBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ShareWrite)],
    handler: async (req) => {
      const ttlDays = req.body.ttlDays;
      const ttlMs =
        ttlDays === null
          ? null
          : ttlDays === undefined
            ? undefined
            : ttlDays * 24 * 60 * 60 * 1000;
      const { id, expiresAt } = await createShare(app.clawmind.dataDir, {
        query: req.body.query,
        answer: req.body.answer,
        sources: req.body.sources,
        userId: req.user!.id,
        ttlMs,
      });
      // Audit every mint so security teams can see who exposed what and
      // when it auto-revokes.
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'share.create',
        resource: id,
        meta: {
          query: req.body.query.slice(0, 200),
          expiresAt,
          ttlDays: ttlDays === null ? null : ttlDays ?? DEFAULT_TTL_DAYS,
        },
      });
      return { id, url: `/s/${id}`, expiresAt };
    },
  });

  // Public read. Intentionally has no auth so /s/<id> works from incognito,
  // embeds, and link previews. Expired shares return 410 Gone so search
  // engines and clients understand the resource is intentionally retired.
  app.get('/share/:id', {
    schema: { params: IdParam },
    handler: async (req, reply) => {
      const item = await readShareRaw(app.clawmind.dataDir, req.params.id);
      if (!item) return reply.code(404).send({ error: 'not found' });
      if (isExpired(item)) {
        return reply.code(410).send({
          error: 'share expired',
          expiredAt: item.expiresAt,
        });
      }
      // Fire and forget. We do not await the bump on the response path so a
      // slow disk write never adds latency to the public viewer.
      void bumpViews(app.clawmind.dataDir, req.params.id).then((views) => {
        // Notify the share owner on every view, but dedupe on the share id so
        // refreshes don't spam the inbox; the row's title is overwritten with
        // the latest count.
        if (item.userId) {
          const noun = views === 1 ? 'view' : 'views';
          void notify(app.clawmind.dataDir, {
            userId: item.userId,
            kind: 'share.viewed',
            title: `Your shared answer has ${views} ${noun}`,
            body: item.query.slice(0, 200),
            href: `/shares`,
            dedupeKey: `share:${req.params.id}`,
            meta: { shareId: req.params.id, views },
          });
        }
      });
      return item;
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
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: auditAction('share.delete', false),
        resource: req.params.id,
      });
      return { id: req.params.id, deleted: true };
    },
  });
};
