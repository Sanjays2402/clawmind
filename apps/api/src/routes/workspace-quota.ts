import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  updatePolicy,
  validatePatch,
  QUOTA_LIMITS,
  effectiveWorkspaceLimit,
  effectiveUserLimit,
  WorkspaceQuotaValidationError,
} from '../services/workspace-quota.js';
import { getWorkspaceUsage } from '../services/usage.js';
import { Scopes } from '../scopes.js';

// Workspace-wide monthly quota policy.
//
//   GET  /v1/workspace-quota        read the policy + current month rollup
//   PUT  /v1/workspace-quota        owner-only upsert, audit-logged
//
// The policy is the single knob enterprise buyers ask for during
// procurement: "what stops a runaway integration from burning our
// monthly budget?". The PUT route is wrapped in the standard audit
// chain entry so SOC2 reviewers can prove who raised or lowered the
// cap. Read is admin-or-higher because the configured number is the
// input to internal spend forecasts and not something a viewer needs.

const NullableLimit = z.union([
  z.number().int().min(QUOTA_LIMITS.minLimit).max(QUOTA_LIMITS.maxLimit),
  z.null(),
]);

const PutBody = z
  .object({
    monthlyLimit: NullableLimit.optional(),
    perUserMonthlyLimit: NullableLimit.optional(),
  })
  .strict();

function shape(limit: number): number | null {
  return Number.isFinite(limit) ? limit : null;
}

export const workspaceQuotaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace-quota', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.WorkspaceQuotaRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      const wsLimit = effectiveWorkspaceLimit(policy);
      const userLimit = effectiveUserLimit(policy);
      const usage = await getWorkspaceUsage(app.clawmind.dataDir, Date.now(), wsLimit);
      return {
        policy,
        // Surface Infinity as null on the wire so JSON.stringify does not
        // emit `null` for `Infinity` ambiguously and clients can render
        // an "Unlimited" badge deterministically.
        effective: {
          monthlyLimit: shape(wsLimit),
          perUserMonthlyLimit: shape(userLimit),
        },
        usage: {
          period: usage.period,
          used: usage.used,
          remaining: shape(usage.remaining),
          resetsAt: usage.resetsAt,
          byKind: usage.byKind,
          members: usage.members,
        },
      };
    },
  });

  app.put('/workspace-quota', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.WorkspaceQuotaManage),
      app.requireMfa,
    ],
    handler: async (req, reply) => {
      try {
        const next = await updatePolicy(app.clawmind.dataDir, req.user!.id, req.body);
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'workspace-quota.update',
          resource: '/v1/workspace-quota',
          meta: {
            monthlyLimit: next.monthlyLimit,
            perUserMonthlyLimit: next.perUserMonthlyLimit,
          },
        });
        return next;
      } catch (err) {
        if (err instanceof WorkspaceQuotaValidationError) {
          return reply.code(400).send({ error: 'invalid quota', message: err.message });
        }
        throw err;
      }
    },
  });
};
