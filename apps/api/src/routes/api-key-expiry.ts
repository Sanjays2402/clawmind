import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setPolicy,
  findUpcomingKeys,
  ApiKeyExpiryValidationError,
  MAX_WARN_DAYS,
} from '../services/api-key-expiry.js';
import { loadKeys } from '../services/api-keys.js';
import { Scopes } from '../scopes.js';

// Workspace API-key expiry-warning endpoints.
//
//   GET    /v1/api-key-expiry            read policy + counts (admin+)
//   PUT    /v1/api-key-expiry            update warnDays (owner + MFA)
//   GET    /v1/api-key-expiry/upcoming   list keys inside the warning window (admin+)
//
// Mutations are owner+MFA because every authenticated API-key request
// reads the policy to decide whether to attach warning headers; a wrong
// value either spams customers with false warnings or silences a real
// imminent outage. Reads are admin+ so a delegated security reviewer
// can confirm the control is configured without being able to widen
// the window.

const PutBody = z
  .object({
    warnDays: z.number().int().min(0).max(MAX_WARN_DAYS),
  })
  .strict();

export const apiKeyExpiryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api-key-expiry', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ApiKeyExpiryRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      const keys = await loadKeys(app.clawmind.dataDir);
      const upcoming = findUpcomingKeys(policy, keys, Date.now());
      const activeKeys = keys.filter((k) => !k.revokedAt && k.isCanary !== true);
      const ttlKeys = activeKeys.filter((k) => k.expiresAt && k.expiresAt > Date.now());
      return {
        policy,
        limits: { maxWarnDays: MAX_WARN_DAYS },
        counts: {
          activeKeys: activeKeys.length,
          keysWithTtl: ttlKeys.length,
          keysExpiringSoon: upcoming.length,
        },
      };
    },
  });

  app.put('/api-key-expiry', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ApiKeyExpiryManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          warnDays: req.body.warnDays,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'api-key-expiry.update',
          resource: '/v1/api-key-expiry',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: { warnDays: prev.warnDays },
            after: { warnDays: next.warnDays },
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof ApiKeyExpiryValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.get('/api-key-expiry/upcoming', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ApiKeyExpiryRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      const keys = await loadKeys(app.clawmind.dataDir);
      const upcoming = findUpcomingKeys(policy, keys, Date.now());
      return { policy, upcoming };
    },
  });
};
