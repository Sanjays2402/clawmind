import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { loadFeedback, recordVote, clearVote, boostFor, getFeedback, filterFeedback } from '../services/feedback.js';
import { feedbackToCsv, feedbackToJson, feedbackToMarkdown } from '../services/feedback-export.js';
import { Scopes } from '../scopes.js';

// Source-level upvote/downvote endpoints. Votes are owned per user but the
// boost map is shared so consensus moves the needle. Bounded so a single
// downvote can't bury a doc.
//
//   POST   /v1/feedback        { path, vote: 1 | -1 }
//   DELETE /v1/feedback        { path }
//   GET    /v1/feedback        list current entries (admin/debug)

export const feedbackRoutes: FastifyPluginAsyncZod = async (app) => {
  // Optional ?q= substring filter on the source path. Case-insensitive,
  // matches the bulk-export filter below so the on-screen list and the
  // downloaded file always agree on which entries are in scope.
  app.get<{ Querystring: { q?: string } }>('/feedback', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    handler: async (req) => {
      const map = await loadFeedback(app.clawmind.dataDir);
      const entries = filterFeedback(Object.values(map), (req.query as { q?: string }).q);
      return {
        items: entries.map((e) => ({
          path: e.path,
          ups: e.ups,
          downs: e.downs,
          boost: boostFor(e),
          updatedAt: e.updatedAt,
        })),
      };
    },
  });

  // Bulk export of the feedback map in the format hinted by the URL
  // extension. Mirrors /saved/export.<fmt> and /history/export.<fmt> so the
  // download buttons in the web UI behave consistently. Items are sorted
  // by most-recently-updated first to match the on-screen list, and the
  // JSON envelope is versioned so downstream tooling can detect breaks.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get<{ Querystring: { q?: string } }>(`/feedback/export.${fmt}`, {
      schema: {
        querystring: z.object({
          q: z.string().trim().min(1).max(200).optional(),
        }),
      },
      preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
      handler: async (req, reply) => {
        const map = await loadFeedback(app.clawmind.dataDir);
        const items = filterFeedback(Object.values(map), (req.query as { q?: string }).q)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-feedback-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(feedbackToJson(items));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(feedbackToCsv(items));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(feedbackToMarkdown(items));
      },
    });
  }

  // Single-entry fetch by source path. Feedback is keyed by arbitrary
  // workspace paths (slashes, dots, spaces), so the path comes through as
  // a query parameter instead of a URL segment. Returns 404 when the path
  // has no recorded votes so callers can distinguish "never voted" from
  // "voted to zero".
  app.get('/feedback/entry', {
    schema: { querystring: z.object({ path: z.string().min(1).max(1024) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    handler: async (req, reply) => {
      const entry = await getFeedback(app.clawmind.dataDir, req.query.path);
      if (!entry) return reply.notFound('feedback not found');
      return {
        item: {
          path: entry.path,
          ups: entry.ups,
          downs: entry.downs,
          boost: boostFor(entry),
          updatedAt: entry.updatedAt,
        },
      };
    },
  });

  // Per-entry export. Lets a curator download or share votes for one
  // source as a self-contained file without exporting the entire feedback
  // map. Reuses the same formatters as the bulk /feedback/export.<fmt>
  // endpoints so the JSON envelope and Markdown layout match. Path is a
  // query parameter to avoid clashing with the bulk export route.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/feedback/entry/export.${fmt}`, {
      schema: { querystring: z.object({ path: z.string().min(1).max(1024) }) },
      preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
      handler: async (req, reply) => {
        const entry = await getFeedback(app.clawmind.dataDir, req.query.path);
        if (!entry) return reply.notFound('feedback not found');
        const stamp = new Date(entry.updatedAt).toISOString().slice(0, 10);
        const safePath = entry.path.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 64) || 'entry';
        const filename = `clawmind-feedback-${stamp}-${safePath}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(feedbackToJson([entry]));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(feedbackToCsv([entry]));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(feedbackToMarkdown([entry]));
      },
    });
  }

  app.post('/feedback', {
    schema: { body: z.object({ path: z.string().min(1), vote: z.union([z.literal(1), z.literal(-1)]) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.FeedbackWrite)],
    handler: async (req) => {
      const entry = await recordVote(app.clawmind.dataDir, req.user!.id, req.body.path, req.body.vote);
      await app.feedback.reload();
      return { path: entry.path, ups: entry.ups, downs: entry.downs, boost: boostFor(entry) };
    },
  });

  app.delete('/feedback', {
    schema: { body: z.object({ path: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.FeedbackWrite)],
    handler: async (req) => {
      await clearVote(app.clawmind.dataDir, req.user!.id, req.body.path);
      await app.feedback.reload();
      return { ok: true };
    },
  });
};
