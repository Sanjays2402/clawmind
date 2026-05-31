import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getHold,
  imposeHold,
  releaseHold,
  LegalHoldValidationError,
  MAX_REASON,
  MAX_TICKET,
} from '../services/legal-hold.js';
import { Scopes } from '../scopes.js';

// Workspace-wide legal hold endpoints.
//
//   GET    /v1/legal-hold        read current hold status (admin+)
//   POST   /v1/legal-hold        impose / refresh metadata on a hold (owner+MFA)
//   DELETE /v1/legal-hold        release the hold (owner+MFA)
//
// When active, the hold blocks self-service GDPR erase and scheduled
// retention sweeps. See services/legal-hold.ts for the full contract.

const ImposeBody = z
  .object({
    reason: z.string().max(MAX_REASON).nullable().optional(),
    ticket: z.string().max(MAX_TICKET).nullable().optional(),
  })
  .strict();

export const legalHoldRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/legal-hold', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.LegalHoldRead),
    ],
    handler: async () => {
      const hold = await getHold(app.clawmind.dataDir);
      return { hold };
    },
  });

  app.post('/legal-hold', {
    schema: { body: ImposeBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.LegalHoldManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const before = await getHold(app.clawmind.dataDir);
        const hold = await imposeHold(app.clawmind.dataDir, userId, req.body ?? {});
        await app.clawmind.audit.write({
          actor: userId,
          action: before.active ? 'legal-hold.update' : 'legal-hold.impose',
          resource: '/v1/legal-hold',
          meta: {
            previouslyActive: before.active,
            reason: hold.reason,
            ticket: hold.ticket,
            imposedAt: hold.imposedAt,
          },
        });
        return { hold };
      } catch (err) {
        if (err instanceof LegalHoldValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/legal-hold', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.LegalHoldManage),
    ],
    handler: async (req) => {
      const userId = req.user!.id;
      const before = await getHold(app.clawmind.dataDir);
      const hold = await releaseHold(app.clawmind.dataDir, userId);
      if (before.active) {
        await app.clawmind.audit.write({
          actor: userId,
          action: 'legal-hold.release',
          resource: '/v1/legal-hold',
          meta: {
            heldSinceMs: before.imposedAt,
            ticket: before.ticket,
          },
        });
      }
      return { hold };
    },
  });
};
