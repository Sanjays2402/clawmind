import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { loadFeedback, recordVote, clearVote, boostFor } from '../services/feedback.js';
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
  app.get('/feedback', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    handler: async () => {
      const map = await loadFeedback(app.clawmind.dataDir);
      return {
        items: Object.values(map).map((e) => ({
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
    app.get(`/feedback/export.${fmt}`, {
      preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
      handler: async (_req, reply) => {
        const map = await loadFeedback(app.clawmind.dataDir);
        const items = Object.values(map).sort((a, b) => b.updatedAt - a.updatedAt);
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
