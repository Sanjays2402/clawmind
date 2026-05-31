import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getDeletion,
  scheduleDeletion,
  cancelDeletion,
  markCompleted,
  WorkspaceDeletionValidationError,
  WorkspaceDeletionStateError,
  MAX_REASON,
  MAX_TICKET,
  MIN_GRACE_MS,
  MAX_GRACE_MS,
  DEFAULT_GRACE_MS,
  isPastDue,
} from '../services/workspace-deletion.js';
import { Scopes } from '../scopes.js';

// Workspace scheduled-deletion endpoints (GDPR right to erasure, tenant
// level). See services/workspace-deletion.ts for the state machine and
// the rationale for the grace-window clamp.
//
//   GET    /v1/workspace/deletion            read current schedule (admin+)
//   POST   /v1/workspace/deletion            schedule (owner + MFA)
//   DELETE /v1/workspace/deletion            cancel    (owner + MFA)
//   POST   /v1/workspace/deletion/complete   operator confirms wipe ran
//                                            (owner + MFA, must be past due)

const ScheduleBody = z
  .object({
    reason: z.string().max(MAX_REASON).nullable().optional(),
    ticket: z.string().max(MAX_TICKET).nullable().optional(),
    graceMs: z.number().int().min(MIN_GRACE_MS).max(MAX_GRACE_MS).nullable().optional(),
  })
  .strict();

function envelope(d: Awaited<ReturnType<typeof getDeletion>>) {
  return {
    deletion: d,
    pastDue: isPastDue(d),
    limits: {
      minGraceMs: MIN_GRACE_MS,
      defaultGraceMs: DEFAULT_GRACE_MS,
      maxGraceMs: MAX_GRACE_MS,
    },
  };
}

export const workspaceDeletionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace/deletion', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.WorkspaceDeletionRead),
    ],
    handler: async () => {
      const d = await getDeletion(app.clawmind.dataDir);
      return envelope(d);
    },
  });

  app.post('/workspace/deletion', {
    schema: { body: ScheduleBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WorkspaceDeletionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const d = await scheduleDeletion(app.clawmind.dataDir, userId, req.body ?? {});
        await app.clawmind.audit.write({
          actor: userId,
          action: 'workspace-deletion.scheduled',
          resource: '/v1/workspace/deletion',
          meta: {
            scheduledFor: d.scheduledFor,
            graceMs: d.graceMs,
            ticket: d.ticket,
            reason: d.reason,
          },
        });
        return envelope(d);
      } catch (err) {
        if (err instanceof WorkspaceDeletionValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        if (err instanceof WorkspaceDeletionStateError) {
          return reply
            .code(409)
            .send({ error: 'state', state: err.state, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/workspace/deletion', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WorkspaceDeletionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const before = await getDeletion(app.clawmind.dataDir);
        const d = await cancelDeletion(app.clawmind.dataDir, userId);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'workspace-deletion.cancelled',
          resource: '/v1/workspace/deletion',
          meta: {
            previouslyScheduledFor: before.scheduledFor,
            ticket: before.ticket,
          },
        });
        return envelope(d);
      } catch (err) {
        if (err instanceof WorkspaceDeletionStateError) {
          return reply
            .code(409)
            .send({ error: 'state', state: err.state, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/workspace/deletion/complete', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WorkspaceDeletionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const d = await markCompleted(app.clawmind.dataDir, userId);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'workspace-deletion.completed',
          resource: '/v1/workspace/deletion/complete',
          meta: {
            scheduledFor: d.scheduledFor,
            ticket: d.ticket,
          },
        });
        return envelope(d);
      } catch (err) {
        if (err instanceof WorkspaceDeletionStateError) {
          return reply
            .code(409)
            .send({ error: 'state', state: err.state, message: err.message });
        }
        throw err;
      }
    },
  });
};
