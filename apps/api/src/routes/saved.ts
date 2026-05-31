import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listSaved, addSaved, removeSaved } from '../services/saved.js';
import { Scopes } from '../scopes.js';

export const savedRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/saved', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedRead)],
    handler: async (req) => ({ items: await listSaved(app.clawmind.dataDir, req.user!.id) }),
  });
  app.post<{ Body: { title: string; query: string } }>('/saved', {
    schema: { body: z.object({ title: z.string().min(1), query: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedWrite)],
    handler: async (req) => ({ item: await addSaved(app.clawmind.dataDir, req.user!.id, req.body) }),
  });
  app.delete<{ Params: { id: string } }>('/saved/:id', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SavedWrite)],
    handler: async (req) => {
      await removeSaved(app.clawmind.dataDir, req.user!.id, req.params.id);
      return { ok: true };
    },
  });
};
