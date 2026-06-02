import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getState,
  getPolicy,
  updatePolicy,
  grantAccess,
  revokeAccess,
  VendorAccessValidationError,
  VendorAccessPolicyError,
  MAX_REASON,
  MAX_TICKET,
  MIN_DURATION_SEC,
  ABSOLUTE_MAX_DURATION_SEC,
  type VendorAccessGrant,
} from '../services/vendor-access.js';
import { Scopes } from '../scopes.js';

// Vendor Support Access Lockbox routes.
//
//   GET    /v1/workspace/vendor-access          read policy + current grant + history (admin+)
//   PUT    /v1/workspace/vendor-access/policy   update policy (owner + MFA)
//   POST   /v1/workspace/vendor-access/grants   open a time-bound grant (owner + MFA), returns raw token once
//   DELETE /v1/workspace/vendor-access/grants/current  revoke the active grant (owner + MFA)
//
// Every mutation produces an audit log entry with a before/after diff
// so a procurement reviewer can prove who opened the lockbox, when,
// for how long, and against which incident ticket.

const StateQuery = z
  .object({
    q: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const PolicyBody = z
  .object({
    enabled: z.boolean().optional(),
    maxDurationSec: z
      .number()
      .int()
      .min(MIN_DURATION_SEC)
      .max(ABSOLUTE_MAX_DURATION_SEC)
      .optional(),
    requireJustification: z.boolean().optional(),
    requireTicket: z.boolean().optional(),
  })
  .strict();

const GrantBody = z
  .object({
    durationSec: z.number().int().min(MIN_DURATION_SEC).max(ABSOLUTE_MAX_DURATION_SEC),
    reason: z.string().max(MAX_REASON).nullable().optional(),
    ticket: z.string().max(MAX_TICKET).nullable().optional(),
  })
  .strict();

function sanitizeGrant(g: VendorAccessGrant | null) {
  if (!g) return null;
  // Never echo the tokenHash to clients. The raw token is returned
  // exactly once at grant time; afterwards there is no way to recover
  // it, which is the property procurement reviewers want.
  const { tokenHash: _hash, ...rest } = g;
  return rest;
}

export const vendorAccessRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace/vendor-access', {
    schema: { querystring: StateQuery },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.VendorAccessRead),
    ],
    handler: async (req) => {
      const { q } = req.query as z.infer<typeof StateQuery>;
      const state = await getState(app.clawmind.dataDir, undefined, { q });
      return {
        policy: state.policy,
        current: sanitizeGrant(state.current),
        history: state.history.map((g) => sanitizeGrant(g)),
      };
    },
  });

  app.put('/workspace/vendor-access/policy', {
    schema: { body: PolicyBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.VendorAccessManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const before = await getPolicy(app.clawmind.dataDir);
        const after = await updatePolicy(app.clawmind.dataDir, userId, req.body ?? {});
        await app.clawmind.audit.write({
          actor: userId,
          action: 'vendor-access.policy.update',
          resource: '/v1/workspace/vendor-access/policy',
          meta: {
            before: {
              enabled: before.enabled,
              maxDurationSec: before.maxDurationSec,
              requireJustification: before.requireJustification,
              requireTicket: before.requireTicket,
            },
            after: {
              enabled: after.enabled,
              maxDurationSec: after.maxDurationSec,
              requireJustification: after.requireJustification,
              requireTicket: after.requireTicket,
            },
          },
        });
        return { policy: after };
      } catch (err) {
        if (err instanceof VendorAccessValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/workspace/vendor-access/grants', {
    schema: { body: GrantBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.VendorAccessManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const result = await grantAccess(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'vendor-access.grant.create',
          resource: '/v1/workspace/vendor-access/grants',
          meta: {
            grantId: result.grant.id,
            expiresAt: result.grant.expiresAt,
            reason: result.grant.reason,
            ticket: result.grant.ticket,
          },
        });
        return reply.code(201).send({
          grant: sanitizeGrant(result.grant),
          // Returned exactly once. Owner must hand this token to the
          // support engineer over a secure channel; the server never
          // returns it again.
          token: result.token,
        });
      } catch (err) {
        if (err instanceof VendorAccessValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        if (err instanceof VendorAccessPolicyError) {
          return reply
            .code(409)
            .send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/workspace/vendor-access/grants/current', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.VendorAccessManage),
    ],
    handler: async (req) => {
      const userId = req.user!.id;
      const revoked = await revokeAccess(app.clawmind.dataDir, userId);
      if (revoked) {
        await app.clawmind.audit.write({
          actor: userId,
          action: 'vendor-access.grant.revoke',
          resource: '/v1/workspace/vendor-access/grants/current',
          meta: {
            grantId: revoked.id,
            grantedBy: revoked.grantedBy,
            originalExpiresAt: revoked.expiresAt,
          },
        });
      }
      return { grant: sanitizeGrant(revoked) };
    },
  });
};
