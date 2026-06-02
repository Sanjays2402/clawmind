import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listSaved, addSaved, removeSaved, updateSaved, getSaved } from '../services/saved.js';
import { savedToCsv, savedToJson, savedToMarkdown } from '../services/saved-export.js';
import { Scopes } from '../scopes.js';

const tagsSchema = z.array(z.string()).max(16);

export const savedRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/saved', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedRead)],
    handler: async (req) => ({ items: await listSaved(app.clawmind.dataDir, req.user!.id) }),
  });

  app.post('/saved', {
    schema: { body: z.object({
      title: z.string().min(1).max(120),
      query: z.string().min(1).max(2000),
      tags: tagsSchema.optional(),
    }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedWrite)],
    handler: async (req) => ({
      item: await addSaved(app.clawmind.dataDir, req.user!.id, req.body as { title: string; query: string; tags?: string[] }),
    }),
  });

  // Fetch a single saved search owned by the caller. Lets the UI deep-
  // link to one entry (permalink, share with a teammate by id, re-open in
  // a new tab) without re-fetching the full list. Other users' entries
  // surface as 404 so ownership is never leaked.
  // Export the caller's saved searches in the format hinted by the URL
  // extension. Mirrors the per-user history export so the same download
  // buttons in the web UI behave consistently. Output is streamed as a
  // download (Content-Disposition: attachment) so browsers save it instead
  // of rendering it. Items are returned in the same order as GET /saved
  // (newest first), and tags are preserved across all three formats.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/saved/export.${fmt}`, {
      preHandler: [app.requireAuth, app.requireScope(Scopes.SavedRead)],
      handler: async (req, reply) => {
        const items = (await listSaved(app.clawmind.dataDir, req.user!.id))
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-saved-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(savedToJson(items));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(savedToCsv(items));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(savedToMarkdown(items));
      },
    });
  }

  app.get('/saved/:id', {
    schema: { params: z.object({ id: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedRead)],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = await getSaved(app.clawmind.dataDir, req.user!.id, id);
      if (!item) return reply.code(404).send({ error: 'saved search not found' });
      return { item };
    },
  });

  app.patch('/saved/:id', {
    schema: {
      params: z.object({ id: z.string().min(1) }),
      body: z.object({
        title: z.string().min(1).max(120).optional(),
        query: z.string().min(1).max(2000).optional(),
        tags: tagsSchema.optional(),
      }).refine((b) => b.title !== undefined || b.query !== undefined || b.tags !== undefined, {
        message: 'at least one of title, query, tags is required',
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedWrite)],
    handler: async (req, reply) => {
      const params = req.params as { id: string };
      const body = req.body as { title?: string; query?: string; tags?: string[] };
      try {
        const item = await updateSaved(app.clawmind.dataDir, req.user!.id, params.id, body);
        if (!item) return reply.code(404).send({ error: 'not found' });
        if (app.clawmind?.audit?.write) {
          await app.clawmind.audit.write({
            actor: req.user!.id, action: 'saved.update', resource: item.id,
            meta: { title: item.title, tags: item.tags },
          });
        }
        return { item };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  });

  app.delete('/saved/:id', {
    schema: { params: z.object({ id: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedWrite)],
    handler: async (req) => {
      const params = req.params as { id: string };
      await removeSaved(app.clawmind.dataDir, req.user!.id, params.id);
      return { ok: true };
    },
  });
};
