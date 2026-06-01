import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getDocument,
  updateSettings,
  signAttestation,
  withdrawCurrent,
  publicView,
  deriveStatus,
  CanaryValidationError,
  CANARY_LIMITS,
} from '../services/warrant-canary.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Warrant canary endpoints.
//
//   GET    /v1/warrant-canary               public, no auth (procurement bait)
//   GET    /v1/warrant-canary/admin         admin+, full incl. attestedBy
//   PUT    /v1/warrant-canary/settings      owner+MFA, audit (enable / cadence / preamble)
//   POST   /v1/warrant-canary/attestations  owner+MFA, audit (sign a new attestation)
//   POST   /v1/warrant-canary/withdraw      owner+MFA, audit (explicit revocation)
//
// The unauthenticated GET is the URL a buyer's vendor-review tool will
// pin in their own record; keeping it auth-free is the whole point of
// the feature. The admin GET surfaces operator-only metadata
// (attestedBy / withdrawnBy / updatedBy) that should never leak from
// an internet-exposed instance.
//
// Every mutating call is gated by owner role + MFA step-up because a
// warrant canary is a regulatory-adjacent public statement: a silent
// edit is a much louder signal than the canary itself.

const SETTINGS_BODY = z
  .object({
    enabled: z.boolean().optional(),
    defaultCadenceDays: z
      .number()
      .int()
      .min(CANARY_LIMITS.minCadenceDays)
      .max(CANARY_LIMITS.maxCadenceDays)
      .optional(),
    preamble: z.string().max(CANARY_LIMITS.preamble).optional(),
  })
  .strict();

const ATTEST_BODY = z
  .object({
    statement: z.string().min(1).max(CANARY_LIMITS.statement),
    cadenceDays: z
      .number()
      .int()
      .min(CANARY_LIMITS.minCadenceDays)
      .max(CANARY_LIMITS.maxCadenceDays)
      .optional(),
  })
  .strict();

const WITHDRAW_BODY = z
  .object({
    reason: z.string().min(1).max(CANARY_LIMITS.reason),
  })
  .strict();

export const warrantCanaryRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public projection. This is the URL a procurement reviewer or a
  // buyer's vendor-review tool will hit; if it 401s, the conversation
  // ends before it starts.
  app.get('/warrant-canary', {
    handler: async (_req, reply) => {
      const doc = await getDocument(app.clawmind.dataDir);
      reply.header('cache-control', 'public, max-age=300');
      return publicView(doc);
    },
  });

  // Operator view. Same shape plus attestedBy / withdrawnBy /
  // updatedBy and the raw enabled flag without status normalisation.
  app.get('/warrant-canary/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.WarrantCanaryRead),
    ],
    handler: async () => {
      const doc = await getDocument(app.clawmind.dataDir);
      return { ...doc, status: deriveStatus(doc, Date.now()) };
    },
  });

  // Owner updates the operator-editable settings. Audit + dry-run.
  app.put('/warrant-canary/settings', {
    schema: { body: SETTINGS_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WarrantCanaryManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('warrant_canary.settings', true),
            resource: '/v1/warrant-canary/settings',
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await updateSettings(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('warrant_canary.settings', false),
          resource: '/v1/warrant-canary/settings',
          meta: {
            ip: req.ip,
            requestId: req.id,
            enabled: next.enabled,
            defaultCadenceDays: next.defaultCadenceDays,
          },
        });
        return reply.code(200).send(next);
      } catch (err) {
        if (err instanceof CanaryValidationError) {
          return reply.code(400).send({ error: 'invalid canary settings', message: err.message });
        }
        throw err;
      }
    },
  });

  // Owner signs a new attestation. The previous record stays in
  // history; only the latest is "current" for public-status purposes.
  app.post('/warrant-canary/attestations', {
    schema: { body: ATTEST_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WarrantCanaryManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('warrant_canary.attest', true),
            resource: '/v1/warrant-canary/attestations',
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const { record } = await signAttestation(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('warrant_canary.attest', false),
          resource: '/v1/warrant-canary/attestations',
          meta: {
            ip: req.ip,
            requestId: req.id,
            attestationId: record.id,
            cadenceDays: record.cadenceDays,
            fingerprint: record.fingerprint,
            expiresAt: record.expiresAt,
          },
        });
        return reply.code(201).send(record);
      } catch (err) {
        if (err instanceof CanaryValidationError) {
          return reply.code(400).send({ error: 'invalid attestation', message: err.message });
        }
        throw err;
      }
    },
  });

  // Owner explicitly withdraws the current attestation. The audit row
  // captures the withdrawal reason verbatim because the public surface
  // will surface "withdrawn" without further explanation, and the
  // operator needs to be able to reconstruct why later.
  app.post('/warrant-canary/withdraw', {
    schema: { body: WITHDRAW_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WarrantCanaryManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('warrant_canary.withdraw', true),
            resource: '/v1/warrant-canary/withdraw',
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const { record } = await withdrawCurrent(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('warrant_canary.withdraw', false),
          resource: '/v1/warrant-canary/withdraw',
          meta: {
            ip: req.ip,
            requestId: req.id,
            attestationId: record.id,
            reason: record.withdrawnReason,
          },
        });
        return reply.code(200).send(record);
      } catch (err) {
        if (err instanceof CanaryValidationError) {
          return reply.code(400).send({ error: 'invalid withdrawal', message: err.message });
        }
        throw err;
      }
    },
  });
};
