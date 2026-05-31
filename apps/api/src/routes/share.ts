import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createShare, readShare } from '../services/share.js';
import { Scopes } from '../scopes.js';

export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post<{ Body: { query: string; answer: string; sources: unknown[] } }>('/share', {
    schema: { body: z.object({ query: z.string(), answer: z.string(), sources: z.array(z.any()) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ShareWrite)],
    handler: async (req) => {
      const id = await createShare(app.clawmind.dataDir, req.body);
      return { id, url: `/s/${id}` };
    },
  });

  app.get<{ Params: { id: string } }>('/share/:id', {
    handler: async (req, reply) => {
      const data = await readShare(app.clawmind.dataDir, req.params.id);
      if (!data) return reply.code(404).send({ error: 'not found' });
      return data;
    },
  });
};
