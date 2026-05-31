import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setPolicy,
  SharePolicyValidationError,
  MAX_POLICY_TTL_DAYS,
} from '../services/share-policy.js';
import { Scopes } from '../scopes.js';

// Workspace public-share policy endpoints.
//
//   GET /v1/share-policy   read current policy (admin+)
//   PUT /v1/share-policy   update knobs (owner + MFA step-up)
//
// Mutations are gated on owner + MFA step-up to match the rest of the
// workspace-security family (session-policy, mfa-policy, legal-hold).
// Tightening the policy takes effect on the very next POST /v1/share
// thanks to the 1s policy cache.

const PutBody = z
  .object({
    disableShares: z.boolean().optional(),
    requireExpiry: z.boolean().optional(),
    maxTtlDays: z.number().int().min(0).max(MAX_POLICY_TTL_DAYS).optional(),
  })
  .strict();

export const sharePolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/share-policy', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.SharePolicyRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return {
        policy,
        limits: {
          maxTtlDays: MAX_POLICY_TTL_DAYS,
        },
      };
    },
  });

  app.put('/share-policy', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SharePolicyManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          disableShares: req.body.disableShares,
          requireExpiry: req.body.requireExpiry,
          maxTtlDays: req.body.maxTtlDays,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'share-policy.update',
          resource: '/v1/share-policy',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: {
              disableShares: prev.disableShares,
              requireExpiry: prev.requireExpiry,
              maxTtlDays: prev.maxTtlDays,
            },
            after: {
              disableShares: next.disableShares,
              requireExpiry: next.requireExpiry,
              maxTtlDays: next.maxTtlDays,
            },
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof SharePolicyValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
