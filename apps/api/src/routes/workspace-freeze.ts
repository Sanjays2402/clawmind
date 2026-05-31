import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getFreeze,
  freezeWorkspace,
  releaseFreeze,
  WorkspaceFreezeValidationError,
  MAX_REASON,
  MAX_TICKET,
} from '../services/workspace-freeze.js';
import { Scopes } from '../scopes.js';

// Workspace freeze (kill switch) endpoints.
//
//   GET    /v1/workspace/freeze   read current freeze state (admin+)
//   POST   /v1/workspace/freeze   activate / update metadata (owner + MFA)
//   DELETE /v1/workspace/freeze   release the freeze (owner + MFA)
//
// While frozen, every mutating route outside the allowlist (auth, MFA,
// GDPR export, the freeze endpoint itself) returns HTTP 423 Locked.
// See services/workspace-freeze.ts for the full contract.

const FreezeBody = z
  .object({
    reason: z.string().max(MAX_REASON).nullable().optional(),
    ticket: z.string().max(MAX_TICKET).nullable().optional(),
  })
  .strict();

export const workspaceFreezeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace/freeze', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.WorkspaceFreezeRead),
    ],
    handler: async () => {
      const freeze = await getFreeze(app.clawmind.dataDir);
      return { freeze };
    },
  });

  app.post('/workspace/freeze', {
    schema: { body: FreezeBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WorkspaceFreezeManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const before = await getFreeze(app.clawmind.dataDir);
        const freeze = await freezeWorkspace(app.clawmind.dataDir, userId, req.body ?? {});
        await app.clawmind.audit.write({
          actor: userId,
          action: before.active ? 'workspace-freeze.update' : 'workspace-freeze.activate',
          resource: '/v1/workspace/freeze',
          meta: {
            previouslyActive: before.active,
            reason: freeze.reason,
            ticket: freeze.ticket,
            frozenAt: freeze.frozenAt,
          },
        });
        return { freeze };
      } catch (err) {
        if (err instanceof WorkspaceFreezeValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/workspace/freeze', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WorkspaceFreezeManage),
    ],
    handler: async (req) => {
      const userId = req.user!.id;
      const before = await getFreeze(app.clawmind.dataDir);
      const freeze = await releaseFreeze(app.clawmind.dataDir, userId);
      if (before.active) {
        await app.clawmind.audit.write({
          actor: userId,
          action: 'workspace-freeze.release',
          resource: '/v1/workspace/freeze',
          meta: {
            previouslyFrozenAt: before.frozenAt,
            ticket: before.ticket,
          },
        });
      }
      return { freeze };
    },
  });
};
