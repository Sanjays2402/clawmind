import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { readFile } from 'node:fs/promises';

export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { path: string; start?: string; end?: string } }>('/sources/file', {
    schema: { querystring: z.object({ path: z.string(), start: z.string().optional(), end: z.string().optional() }) },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      try {
        const raw = await readFile(req.query.path, 'utf8');
        const lines = raw.split('\n');
        const start = req.query.start ? Math.max(1, Number(req.query.start)) : 1;
        const end = req.query.end ? Math.min(lines.length, Number(req.query.end)) : lines.length;
        return { path: req.query.path, start, end, content: lines.slice(start - 1, end).join('\n') };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  });
};
