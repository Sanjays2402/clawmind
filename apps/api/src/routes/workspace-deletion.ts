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
import {
  consumeApproval,
  createRequest as createApprovalRequest,
  DualControlStateError,
} from '../services/dual-control.js';

const DUAL_CONTROL_ACTION = 'workspace-deletion.schedule';
const DUAL_CONTROL_RESOURCE = '/v1/workspace/deletion';
const DUAL_CONTROL_HEADER = 'x-dualcontrol-approval';

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
      // Four-eyes gate (NIST AC-3(2) two-person integrity). Scheduling a
      // workspace wipe is the most destructive single call in the API,
      // so it cannot be executed by one human. The caller must present
      // an X-DualControl-Approval id pointing at an approval that was
      // (a) created for this action+resource pair, (b) approved by a
      // different owner, and (c) not yet consumed. On a missing or
      // invalid header we mint a fresh approval request and return 412
      // Precondition Required so the UI / runbook can hand the id to a
      // second owner.
      const headerVal = req.headers[DUAL_CONTROL_HEADER];
      const approvalId = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (!approvalId || typeof approvalId !== 'string') {
        try {
          const pending = await createApprovalRequest(app.clawmind.dataDir, userId, {
            action: DUAL_CONTROL_ACTION,
            resource: DUAL_CONTROL_RESOURCE,
            reason: (req.body as any)?.reason ?? null,
          });
          await app.clawmind.audit.write({
            actor: userId,
            action: 'dual-control.request',
            resource: '/v1/dual-control',
            meta: { id: pending.id, forAction: DUAL_CONTROL_ACTION, source: 'workspace-deletion' },
          });
          return reply.code(412).send({
            error: 'dual-control-required',
            message:
              'A second owner must approve this destructive action. Use the returned approvalId.',
            approvalId: pending.id,
            expiresAt: pending.expiresAt,
            header: 'X-DualControl-Approval',
          });
        } catch (e) {
          throw e;
        }
      }
      try {
        await consumeApproval(app.clawmind.dataDir, userId, approvalId, {
          action: DUAL_CONTROL_ACTION,
          resource: DUAL_CONTROL_RESOURCE,
        });
      } catch (err) {
        if (err instanceof DualControlStateError) {
          const code = err.code === 'not-found' ? 404 : 409;
          return reply.code(code).send({ error: err.code, message: err.message });
        }
        throw err;
      }
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
            dualControlApproval: approvalId,
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
