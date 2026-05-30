import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { findStaleSources, DEFAULT_STALE_DAYS } from '../services/stale.js';
import { Scopes } from '../scopes.js';

// Diagnostic endpoint for surfacing sources whose last successful ingest is
// older than a configurable threshold. Returned items are sorted oldest
// first so an operator can prioritise the worst drift. Bounded by `limit`
// so a huge corpus doesn't blow up the response payload.

export const staleRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { olderThanDays?: string; limit?: string } }>('/sources/stale', {
    schema: {
      querystring: z.object({
        olderThanDays: z.string().regex(/^\d+$/).optional(),
        limit: z.string().regex(/^\d+$/).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.StaleRead)],
    handler: async (req) => {
      const thresholdDays = req.query.olderThanDays
        ? Number(req.query.olderThanDays)
        : DEFAULT_STALE_DAYS;
      const limit = req.query.limit ? Number(req.query.limit) : 200;
      return findStaleSources(app.clawmind.manifest, { thresholdDays, limit });
    },
  });
};
