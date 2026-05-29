import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { createShare, readShare } from '../services/share.js';

export const shareRoutes: FastifyPluginAsync = async (app) => {
  app.post('/share', {
    schema: { body: z.object({ query: z.string(), answer: z.string(), sources: z.array(z.any()) }) },
    preHandler: app.requireAuth,
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
