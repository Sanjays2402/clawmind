import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setPolicy,
  findAtRiskKeys,
  sweep,
  ApiKeyInactivityValidationError,
  MAX_IDLE_DAYS,
  MAX_WARN_DAYS,
} from '../services/api-key-inactivity.js';
import { loadKeys } from '../services/api-keys.js';
import { Scopes } from '../scopes.js';

// Workspace API-key inactivity sweep endpoints.
//
//   GET    /v1/api-key-inactivity            read policy + status (admin+)
//   PUT    /v1/api-key-inactivity            update thresholds (owner + MFA)
//   GET    /v1/api-key-inactivity/at-risk    preview keys that will be revoked (admin+)
//   POST   /v1/api-key-inactivity/sweep      run sweep now, supports dry_run (owner + MFA)
//
// Mutations are owner+MFA because sweeping immediately invalidates
// credentials. Reads are admin+ so a delegated security reviewer can
// confirm the control is configured and recently exercised without
// being able to flip the thresholds.

const PutBody = z
  .object({
    idleDays: z.number().int().min(0).max(MAX_IDLE_DAYS).optional(),
    warnDays: z.number().int().min(0).max(MAX_WARN_DAYS).optional(),
  })
  .strict();

const SweepBody = z
  .object({
    dryRun: z.boolean().optional(),
  })
  .strict()
  .optional();

export const apiKeyInactivityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api-key-inactivity', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ApiKeyInactivityRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      const keys = await loadKeys(app.clawmind.dataDir);
      const atRisk = findAtRiskKeys(policy, keys, Date.now());
      const warnCount = atRisk.filter((k) => k.status === 'warn').length;
      const expiredCount = atRisk.filter((k) => k.status === 'expired').length;
      return {
        policy,
        limits: {
          maxIdleDays: MAX_IDLE_DAYS,
          maxWarnDays: MAX_WARN_DAYS,
        },
        counts: {
          activeKeys: keys.filter((k) => !k.revokedAt).length,
          warnKeys: warnCount,
          expiredKeys: expiredCount,
        },
      };
    },
  });

  app.put('/api-key-inactivity', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ApiKeyInactivityManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          idleDays: req.body.idleDays,
          warnDays: req.body.warnDays,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'api-key-inactivity.update',
          resource: '/v1/api-key-inactivity',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: {
              idleDays: prev.idleDays,
              warnDays: prev.warnDays,
            },
            after: {
              idleDays: next.idleDays,
              warnDays: next.warnDays,
            },
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof ApiKeyInactivityValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.get('/api-key-inactivity/at-risk', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ApiKeyInactivityRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      const keys = await loadKeys(app.clawmind.dataDir);
      const atRisk = findAtRiskKeys(policy, keys, Date.now());
      return { policy, atRisk };
    },
  });

  app.post('/api-key-inactivity/sweep', {
    schema: { body: SweepBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ApiKeyInactivityManage),
    ],
    handler: async (req) => {
      const dryRun = req.body?.dryRun === true;
      const result = await sweep(
        app.clawmind.dataDir,
        () => loadKeys(app.clawmind.dataDir),
        { dryRun },
      );
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: dryRun ? 'api-key-inactivity.sweep.dryRun' : 'api-key-inactivity.sweep',
        resource: '/v1/api-key-inactivity/sweep',
        meta: {
          ip: req.ip,
          requestId: req.id,
          revokedCount: result.revokedIds.length,
          revokedIds: result.revokedIds,
        },
      });
      return result;
    },
  });
};
