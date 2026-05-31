import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setPolicy,
  ApiKeyPolicyValidationError,
  MAX_TTL_MIN,
  MAX_KEYS_PER_USER,
  MAX_SCOPES_PER_KEY,
  MAX_FORCED_ROTATION_DAYS,
} from '../services/api-key-policy.js';
import { Scopes } from '../scopes.js';

// Workspace API-key issuance policy endpoints.
//
//   GET /v1/api-key-policy   read current policy (admin+)
//   PUT /v1/api-key-policy   update caps (owner + MFA step-up)
//
// Mutations are gated on owner + MFA step-up to match the rest of the
// workspace-security family (session-policy, mfa-policy, legal-hold,
// workspace-freeze). Tightening the policy takes effect immediately on
// the next attempt to mint or rotate a key; existing keys keep working
// (revoking active credentials in flight would be hostile). The
// forcedRotationDays knob is reported to operators via the keys list
// so they can rotate proactively.

const PutBody = z
  .object({
    maxTtlMinutes: z.number().int().min(0).max(MAX_TTL_MIN).optional(),
    requireExpiry: z.boolean().optional(),
    maxActiveKeysPerUser: z
      .number()
      .int()
      .min(0)
      .max(MAX_KEYS_PER_USER)
      .optional(),
    maxScopesPerKey: z
      .number()
      .int()
      .min(0)
      .max(MAX_SCOPES_PER_KEY)
      .optional(),
    allowWildcardScope: z.boolean().optional(),
    forcedRotationDays: z
      .number()
      .int()
      .min(0)
      .max(MAX_FORCED_ROTATION_DAYS)
      .optional(),
  })
  .strict();

export const apiKeyPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api-key-policy', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ApiKeyPolicyRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return {
        policy,
        limits: {
          maxTtlMinutes: MAX_TTL_MIN,
          maxActiveKeysPerUser: MAX_KEYS_PER_USER,
          maxScopesPerKey: MAX_SCOPES_PER_KEY,
          maxForcedRotationDays: MAX_FORCED_ROTATION_DAYS,
        },
      };
    },
  });

  app.put('/api-key-policy', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ApiKeyPolicyManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          maxTtlMinutes: req.body.maxTtlMinutes,
          requireExpiry: req.body.requireExpiry,
          maxActiveKeysPerUser: req.body.maxActiveKeysPerUser,
          maxScopesPerKey: req.body.maxScopesPerKey,
          allowWildcardScope: req.body.allowWildcardScope,
          forcedRotationDays: req.body.forcedRotationDays,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'api-key-policy.update',
          resource: '/v1/api-key-policy',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: {
              maxTtlMinutes: prev.maxTtlMinutes,
              requireExpiry: prev.requireExpiry,
              maxActiveKeysPerUser: prev.maxActiveKeysPerUser,
              maxScopesPerKey: prev.maxScopesPerKey,
              allowWildcardScope: prev.allowWildcardScope,
              forcedRotationDays: prev.forcedRotationDays,
            },
            after: {
              maxTtlMinutes: next.maxTtlMinutes,
              requireExpiry: next.requireExpiry,
              maxActiveKeysPerUser: next.maxActiveKeysPerUser,
              maxScopesPerKey: next.maxScopesPerKey,
              allowWildcardScope: next.allowWildcardScope,
              forcedRotationDays: next.forcedRotationDays,
            },
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof ApiKeyPolicyValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
