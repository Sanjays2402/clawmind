import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Scopes } from '../scopes.js';
import { listForUser, listAll } from '../services/sign-in-log.js';

// HTTP surface for the sign-in activity log.
//
//   GET /v1/sign-in-log         scoped to the calling user, no extra role.
//   GET /v1/sign-in-log/all     admin+, the full feed including failures
//                               and attempts that did not resolve to a
//                               user (probing). Both endpoints are read
//                               only; writes happen inside the auth
//                               plugin on every login attempt.

const RecordSchema = z.object({
  id: z.string(),
  actor: z.string(),
  method: z.string(),
  outcome: z.enum(['success', 'failure', 'logout']),
  ip: z.string(),
  userAgent: z.string(),
  reason: z.string().optional(),
  at: z.number(),
});

const ListResponse = z.object({
  records: z.array(RecordSchema),
  nextCursor: z.string().nullable(),
  total: z.number(),
});

const Filters = z.object({
  outcome: z.enum(['success', 'failure', 'logout']).optional(),
  method: z.string().trim().min(1).max(64).optional(),
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(64).optional(),
});

const AllFilters = Filters.extend({
  actor: z.string().trim().min(1).max(200).optional(),
});

export const signInLogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/sign-in-log', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SignInLogRead)],
    schema: {
      querystring: Filters,
      response: { 200: ListResponse },
    },
    handler: async (req) => {
      const userId = req.user!.id;
      const out = await listForUser(app.clawmind.dataDir, userId, req.query);
      return out;
    },
  });

  app.get('/sign-in-log/all', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.SignInLogReadAll),
    ],
    schema: {
      querystring: AllFilters,
      response: { 200: ListResponse },
    },
    handler: async (req) => {
      const out = await listAll(app.clawmind.dataDir, req.query);
      return out;
    },
  });
};
