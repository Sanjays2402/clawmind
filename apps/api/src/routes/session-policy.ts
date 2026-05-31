import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setPolicy,
  SessionPolicyValidationError,
  MAX_LIFETIME_MIN,
  MAX_IDLE_MIN,
  DEFAULT_LIFETIME_MIN,
  DEFAULT_IDLE_MIN,
} from '../services/session-policy.js';
import { Scopes } from '../scopes.js';

// Workspace session lifetime policy endpoints.
//
//   GET /v1/session-policy   read current policy (admin+)
//   PUT /v1/session-policy   update lifetime + idle caps (owner + MFA step-up)
//
// Mutations are gated on owner + MFA step-up to match the rest of the
// workspace-security family (mfa-policy, legal-hold, workspace-freeze).
// Tightening the policy will revoke any session that has already
// exceeded the new caps the next time it hits the API.

const PutBody = z
  .object({
    maxLifetimeMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_LIFETIME_MIN)
      .optional(),
    idleTimeoutMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_IDLE_MIN)
      .optional(),
  })
  .strict();

export const sessionPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/session-policy', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.SessionPolicyRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return {
        policy,
        limits: {
          maxLifetimeMinutes: MAX_LIFETIME_MIN,
          maxIdleMinutes: MAX_IDLE_MIN,
          defaultLifetimeMinutes: DEFAULT_LIFETIME_MIN,
          defaultIdleMinutes: DEFAULT_IDLE_MIN,
        },
      };
    },
  });

  app.put('/session-policy', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SessionPolicyManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          maxLifetimeMinutes: req.body.maxLifetimeMinutes,
          idleTimeoutMinutes: req.body.idleTimeoutMinutes,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'session-policy.update',
          resource: '/v1/session-policy',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: {
              maxLifetimeMinutes: prev.maxLifetimeMinutes,
              idleTimeoutMinutes: prev.idleTimeoutMinutes,
            },
            after: {
              maxLifetimeMinutes: next.maxLifetimeMinutes,
              idleTimeoutMinutes: next.idleTimeoutMinutes,
            },
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof SessionPolicyValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
