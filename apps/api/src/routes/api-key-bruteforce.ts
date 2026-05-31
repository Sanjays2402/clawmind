import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  list as listIps,
  unlock as unlockIp,
  tail as tailLog,
  getConfig,
} from '../services/api-key-bruteforce.js';
import { Scopes } from '../scopes.js';

// Owner-facing view of the API-key brute-force throttle.
//
//   GET    /v1/api-key-bruteforce          current locks + failure counts + recent log
//   DELETE /v1/api-key-bruteforce/:ip      clear a lock so a legitimate IP can retry
//
// Read access is gated to the admin:read scope so an admin dashboard can
// surface posture; the unlock path requires the owner role and MFA the
// same way every other security-control endpoint does, because clearing
// a lock during an active attack should require a high-trust actor.

const ipParam = z.object({ ip: z.string().min(1).max(64) });

export const apiKeyBruteForceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/api-key-bruteforce', {
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.AdminRead)],
    handler: async () => {
      const cfg = getConfig();
      const ips = listIps();
      const recent = await tailLog(app.clawmind.dataDir, 100);
      return {
        config: cfg,
        ips,
        recent,
        summary: {
          tracked: ips.length,
          locked: ips.filter((i) => i.locked).length,
        },
      };
    },
  });

  app.delete('/api-key-bruteforce/:ip', {
    schema: { params: ipParam },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.Maintenance),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const ip = req.params.ip;
      const cleared = await unlockIp(app.clawmind.dataDir, ip, userId);
      if (!cleared) {
        return reply.code(404).send({ error: 'ip not tracked', ip });
      }
      await app.clawmind.audit.write({
        actor: userId,
        action: 'api_key.bruteforce.unlock',
        resource: ip,
        meta: { ip, requestId: req.id, viaIp: req.ip },
      });
      return { ok: true, ip };
    },
  });
};
