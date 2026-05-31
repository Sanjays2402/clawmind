import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  enablePolicy,
  disablePolicy,
  MfaPolicyValidationError,
  MAX_GRACE_DAYS,
  DEFAULT_GRACE_DAYS,
} from '../services/mfa-policy.js';
import { Scopes } from '../scopes.js';

// Workspace MFA enforcement policy endpoints.
//
//   GET    /v1/mfa-policy           current policy (admin+)
//   PUT    /v1/mfa-policy           turn on / adjust grace window (owner + MFA step-up)
//   DELETE /v1/mfa-policy           turn off (owner + MFA step-up)
//
// Mutations always require the caller themselves to be MFA-enrolled and
// recently stepped-up. An owner with no MFA cannot enable workspace MFA
// because that would immediately lock themselves out at the next call.

const PutBody = z.object({
  enforced: z.literal(true),
  graceDays: z.number().int().min(0).max(MAX_GRACE_DAYS).optional(),
}).strict();

export const mfaPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/mfa-policy', {
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.MfaPolicyRead)],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return {
        policy,
        limits: { maxGraceDays: MAX_GRACE_DAYS, defaultGraceDays: DEFAULT_GRACE_DAYS },
      };
    },
  });

  app.put('/mfa-policy', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.MfaPolicyManage),
    ],
    handler: async (req, reply) => {
      try {
        const next = await enablePolicy(
          app.clawmind.dataDir,
          req.user!.id,
          { graceDays: req.body.graceDays },
        );
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'mfa-policy.enable',
          resource: '/v1/mfa-policy',
          meta: {
            graceDays: next.graceDays,
            enforcedAt: next.enforcedAt,
            ip: req.ip,
            requestId: req.id,
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof MfaPolicyValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/mfa-policy', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.MfaPolicyManage),
    ],
    handler: async (req) => {
      const next = await disablePolicy(app.clawmind.dataDir, req.user!.id);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'mfa-policy.disable',
        resource: '/v1/mfa-policy',
        meta: {
          disabledAt: next.disabledAt,
          ip: req.ip,
          requestId: req.id,
        },
      });
      return { policy: next };
    },
  });
};
