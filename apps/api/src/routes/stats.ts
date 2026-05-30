import type { FastifyPluginAsync } from 'fastify';
import { statsFromManifest } from '../services/stats.js';
import { Scopes } from '../scopes.js';

// Aggregate index stats grouped by namespace, computed on demand from the
// ingest manifest. Cheap enough to recompute per request given typical
// workspace sizes; if a workspace grows large enough to need caching, the
// corpusVersion decorator already tracks ingest churn and can key a cache.

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stats', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.StatsRead)],
    handler: async () => {
      return statsFromManifest(app.clawmind.manifest);
    },
  });
};
