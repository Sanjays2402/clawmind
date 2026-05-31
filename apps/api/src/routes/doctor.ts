import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { runDoctor } from '../services/doctor.js';
import { Scopes } from '../scopes.js';

// Diagnostic endpoint. Counts chunks across the three stores, flags drift,
// and notes a stale index. Read-only; safe to expose to any authenticated
// user since it returns only aggregate metadata.

export const doctorRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/doctor', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.DoctorRead)],
    handler: async () => {
      const c = app.clawmind;
      return runDoctor({ manifest: c.manifest, bm25: c.bm25, lance: c.lance });
    },
  });
};
