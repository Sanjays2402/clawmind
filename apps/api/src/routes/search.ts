import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { retrieve } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.post('/search', {
    schema: {
      body: QuerySchema,
      response: { 200: z.object({ hits: z.array(z.any()) }) },
    },
    preHandler: app.requireAuth,
    handler: async (req) => {
      const hits = await retrieve(app.rag, req.body);
      return { hits };
    },
  });
};
