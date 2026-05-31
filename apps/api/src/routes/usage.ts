import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getUsage, DEFAULT_FREE_LIMIT } from '../services/usage.js';
import { Scopes } from '../scopes.js';

export const usageRoutes: FastifyPluginAsyncZod = async (app) => {
  // Per-user monthly usage and quota. Powers the in-app meter and is the
  // contract a future Stripe integration will read from.
  app.get('/usage', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.UsageRead)],
    handler: async (req) => {
      const summary = await getUsage(
        app.clawmind.dataDir,
        req.user!.id,
        Date.now(),
        DEFAULT_FREE_LIMIT,
      );
      return summary;
    },
  });
};
