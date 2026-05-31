import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  updatePolicy,
  applyPolicy,
  RETENTION_LIMITS,
  RetentionValidationError,
} from '../services/retention.js';
import { Scopes } from '../scopes.js';
import { assertNotOnHold, LegalHoldActiveError } from '../services/legal-hold.js';

// Per-user data retention policy. Required for GDPR/CCPA reviews where
// "indefinite retention" is a procurement blocker.
//
//   GET    /v1/retention             read the caller's policy
//   PUT    /v1/retention             upsert historyDays / conversationDays / auditDays
//   POST   /v1/retention/apply       run the sweep now; supports ?dry_run=true
//
// All mutations are audit-logged. The audit log itself is never silently
// truncated by a policy: the auditDays field is surfaced for reporting
// only, the chain stays intact for evidentiary use.

const DaysOrNull = z.union([
  z.number().int().min(RETENTION_LIMITS.minDays).max(RETENTION_LIMITS.maxDays),
  z.null(),
]);

const PutBody = z
  .object({
    historyDays: DaysOrNull.optional(),
    conversationDays: DaysOrNull.optional(),
    auditDays: DaysOrNull.optional(),
  })
  .strict();

const ApplyQuery = z.object({
  dry_run: z
    .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
});

export const retentionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/retention', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.RetentionRead)],
    handler: async (req) => {
      const policy = await getPolicy(app.clawmind.dataDir, req.user!.id);
      return { policy, limits: RETENTION_LIMITS };
    },
  });

  app.put('/retention', {
    schema: { body: PutBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.RetentionManage)],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const before = await getPolicy(app.clawmind.dataDir, userId);
        const policy = await updatePolicy(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'retention.update',
          resource: '/v1/retention',
          meta: {
            before: {
              historyDays: before.historyDays,
              conversationDays: before.conversationDays,
              auditDays: before.auditDays,
            },
            after: {
              historyDays: policy.historyDays,
              conversationDays: policy.conversationDays,
              auditDays: policy.auditDays,
            },
          },
        });
        return { policy };
      } catch (err) {
        if (err instanceof RetentionValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/retention/apply', {
    schema: { querystring: ApplyQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.RetentionManage)],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = (req.query as { dry_run?: boolean }).dry_run === true;
      try {
        if (!dryRun) await assertNotOnHold(app.clawmind.dataDir);
      } catch (err) {
        if (err instanceof LegalHoldActiveError) {
          await app.clawmind.audit.write({
            actor: userId,
            action: 'retention.apply.blocked',
            resource: '/v1/retention/apply',
            meta: { reason: 'legal-hold', ticket: err.hold.ticket },
          });
          return reply.code(409).send({
            error: 'legal_hold_active',
            message:
              'Workspace is under a legal hold; scheduled retention sweep is suppressed.',
            hold: {
              imposedAt: err.hold.imposedAt,
              ticket: err.hold.ticket,
              reason: err.hold.reason,
            },
          });
        }
        throw err;
      }
      const report = await applyPolicy(app.clawmind.dataDir, userId, { dryRun });
      if (!dryRun) {
        await app.clawmind.audit.write({
          actor: userId,
          action: 'retention.apply',
          resource: '/v1/retention/apply',
          meta: {
            historyRemoved: report.history.removed,
            conversationsRemoved: report.conversations.removed,
          },
        });
      }
      return { report };
    },
  });
};
