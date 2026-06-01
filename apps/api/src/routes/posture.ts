import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Scopes } from '../scopes.js';
import { buildPosture } from '../services/posture.js';

// Procurement Security Posture endpoint.
//
//   GET /v1/posture   owner + posture:read   structured scorecard
//
// Distinct from /v1/admin/overview: overview is the operator console
// with counters; posture is the "paste this into a vendor security
// questionnaire" derived scorecard. It is deliberately read-only,
// non-spoofable (every entry is computed from the live state of an
// existing service, never editable text), and self-audited so a
// regulator can prove who pulled it.

const ControlSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  family: z.string(),
  detail: z.string(),
  remediation: z.string().nullable(),
});

const PostureSchema = z.object({
  generatedAt: z.number().int().nonnegative(),
  score: z.number().int().min(0).max(100),
  counts: z.object({
    pass: z.number().int().nonnegative(),
    warn: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  ready: z.boolean(),
  controls: z.array(ControlSchema),
});

export const postureRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/posture', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.PostureRead),
    ],
    schema: { response: { 200: PostureSchema } },
    handler: async (req) => {
      const dataDir = app.clawmind.dataDir;
      const env = app.clawmind.env as Record<string, unknown>;

      const verify = await app.clawmind.audit
        .verify()
        .catch(() => ({ ok: false, headHash: null as string | null }));

      const report = await buildPosture({
        dataDir,
        env,
        auditVerified: Boolean(verify.ok),
        auditHeadHash: verify.headHash ?? null,
      });

      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'posture.read',
        resource: '/v1/posture',
        meta: {
          score: report.score,
          ready: report.ready,
          pass: report.counts.pass,
          warn: report.counts.warn,
          fail: report.counts.fail,
        },
      });

      return report;
    },
  });
};
