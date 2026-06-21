import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { runDoctor } from '../services/doctor.js';
import { Scopes } from '../scopes.js';

// Diagnostic endpoint. Counts chunks across the three stores, flags drift,
// and notes a stale index. Read-only; safe to expose to any authenticated
// user since it returns only aggregate metadata.

export const doctorRoutes: FastifyPluginAsyncZod = async (app) => {
  // Optional ?staleAfterDays=<n> overrides the built-in 30-day stale
  // threshold for the STALE_INDEX finding. The natural use is a cron
  // smoke check that defines its own freshness SLO (e.g. "fail if the
  // index has not seen an ingest in the last 6 hours"). The handler
  // converts days -> ms before passing to runDoctor (which takes ms
  // because the broader Doctor service uses raw ms internally and we
  // do not want the route schema to leak that). Bounded to 0..3650
  // days so a typo cannot trip a number conversion edge case; zero
  // means "any age is stale" which is a useful tripwire for a CI
  // check that wants to fire on a never-ingested index regardless
  // of the default threshold.
  app.get<{ Querystring: { staleAfterDays?: string } }>('/doctor', {
    schema: {
      querystring: z.object({
        staleAfterDays: z.string().regex(/^\d+$/).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.DoctorRead)],
    handler: async (req) => {
      const c = app.clawmind;
      let staleAfterMs: number | undefined;
      if (req.query.staleAfterDays !== undefined) {
        const days = Number(req.query.staleAfterDays);
        if (Number.isFinite(days) && days >= 0 && days <= 3650) {
          staleAfterMs = days * 24 * 60 * 60 * 1000;
        }
      }
      return runDoctor({ manifest: c.manifest, bm25: c.bm25, lance: c.lance, staleAfterMs });
    },
  });
};
