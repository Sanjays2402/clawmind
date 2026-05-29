import type { FastifyPluginAsync } from 'fastify';
import { listHistory } from '../services/history.js';

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/history', {
    preHandler: app.requireAuth,
    handler: async (req) => ({
      items: await listHistory(app.clawmind.dataDir, req.user!.id, 50),
    }),
  });
};
