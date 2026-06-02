import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  listForUser,
  listAll,
  acknowledge,
  countOpen,
  IMPOSSIBLE_SPEED_KMH,
  MAX_RECORDS,
} from '../services/sign-in-anomalies.js';
import { Scopes } from '../scopes.js';

// HTTP surface for the sign-in anomaly feed (impossible-travel detector).
//
//   GET  /v1/sign-in-anomalies              the calling user's anomalies
//   GET  /v1/sign-in-anomalies/all          admin+, workspace-wide feed
//   POST /v1/sign-in-anomalies/:id/ack      mark acknowledged; self for own
//                                           records, admins for any record
//   GET  /v1/sign-in-anomalies/limits       static config the UI renders
//
// Detection itself runs inside plugins/auth.ts immediately after a
// successful sign-in records its row, so the policy is consistent across
// GitHub OAuth and OIDC callbacks. These routes only surface what was
// already detected.

const AnomalyEndpoint = z.object({
  ip: z.string(),
  country: z.string(),
  at: z.number(),
  method: z.string(),
});

const RecordSchema = z.object({
  id: z.string(),
  actor: z.string(),
  current: AnomalyEndpoint,
  previous: AnomalyEndpoint,
  distanceKm: z.number(),
  elapsedMinutes: z.number(),
  speedKmh: z.number(),
  thresholdKmh: z.number(),
  acknowledgedAt: z.number().nullable(),
  acknowledgedBy: z.string().nullable(),
  createdAt: z.number(),
});

const ListResponse = z.object({
  records: z.array(RecordSchema),
  nextCursor: z.string().nullable(),
  total: z.number(),
  openCount: z.number(),
});

const SelfFilters = z.object({
  acknowledged: z.coerce.boolean().optional(),
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().min(1).max(64).optional(),
});

const AllFilters = SelfFilters.extend({
  actor: z.string().trim().min(1).max(200).optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

const Params = z.object({ id: z.string().min(1).max(80) });

export const signInAnomaliesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/sign-in-anomalies/limits', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SignInAnomaliesRead)],
    handler: async () => ({
      thresholdKmh: IMPOSSIBLE_SPEED_KMH,
      maxRecords: MAX_RECORDS,
    }),
  });

  app.get('/sign-in-anomalies', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SignInAnomaliesRead)],
    schema: { querystring: SelfFilters, response: { 200: ListResponse } },
    handler: async (req) => {
      const userId = req.user!.id;
      const out = await listForUser(app.clawmind.dataDir, userId, req.query);
      const openCount = await countOpen(app.clawmind.dataDir, userId);
      return { ...out, openCount };
    },
  });

  app.get('/sign-in-anomalies/all', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.SignInAnomaliesReadAll),
    ],
    schema: { querystring: AllFilters, response: { 200: ListResponse } },
    handler: async (req) => {
      const out = await listAll(app.clawmind.dataDir, req.query);
      const openCount = await countOpen(app.clawmind.dataDir);
      return { ...out, openCount };
    },
  });

  app.post('/sign-in-anomalies/:id/ack', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SignInAnomaliesRead)],
    schema: {
      params: Params,
      response: { 200: z.object({ record: RecordSchema }) },
    },
    handler: async (req, reply) => {
      const user = req.user!;
      // Admins can acknowledge any record; everyone else can only
      // acknowledge their own. The service enforces this when scope
      // is 'self' by checking actor==userId before mutating.
      const isAdmin = user.role === 'admin' || user.role === 'owner';
      const rec = await acknowledge(app.clawmind.dataDir, {
        id: req.params.id,
        actor: user.id,
        scope: isAdmin ? 'admin' : 'self',
        userId: user.id,
      });
      if (!rec) {
        throw app.httpErrors.notFound('anomaly not found or not visible to this user');
      }
      await app.clawmind.audit.write({
        actor: user.id,
        action: 'sign-in.anomaly.acknowledged',
        resource: rec.id,
        meta: {
          subject: rec.actor,
          requestId: req.id,
          speedKmh: rec.speedKmh,
          distanceKm: rec.distanceKm,
          fromCountry: rec.previous.country,
          toCountry: rec.current.country,
        },
      }).catch(() => undefined);
      return { record: rec };
    },
  });
};
