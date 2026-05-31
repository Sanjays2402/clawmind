import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listSaved, addSaved, removeSaved, updateSaved } from '../services/saved.js';
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
