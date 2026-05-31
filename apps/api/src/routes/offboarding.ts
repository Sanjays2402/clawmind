import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Scopes } from '../scopes.js';
import { findOrphanedKeys, revokeOrphanedKey } from '../services/offboarding.js';

// Offboarding cleanup endpoints.
//
//   GET    /v1/offboarding/orphans         list API keys whose owning userId
//                                          is no longer a workspace member
//                                          (admin+, offboarding:read)
//   POST   /v1/offboarding/orphans/:id/revoke
//                                          revoke a single orphaned key
//                                          (owner+MFA, offboarding:admin)
//
// New removals (members DELETE, SCIM DELETE) sweep keys + sessions in the
// same operation, so orphans should converge to zero. This route exists to
// surface debris from before the sweep landed and to give an owner a manual
// kill switch for any race that bypassed it.

const OrphanIdParams = z.object({ id: z.string().trim().min(1).max(200) });

export const offboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/offboarding/orphans', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.OffboardingRead),
    ],
    handler: async () => {
      const orphans = await findOrphanedKeys(app.clawmind.dataDir);
      return { count: orphans.length, orphans };
    },
  });

  app.post<{ Params: { id: string } }>('/offboarding/orphans/:id/revoke', {
    schema: { params: OrphanIdParams },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.OffboardingManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      const result = await revokeOrphanedKey(app.clawmind.dataDir, req.params.id);
      if (!result.ok) {
        const status = result.reason === 'not-found' ? 404 : 409;
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'offboarding.orphan.revoke.denied',
          resource: req.params.id,
          meta: { code: result.reason, ip: req.ip },
        });
        return reply.code(status).send({ error: result.reason });
      }
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'offboarding.orphan.revoke',
        resource: req.params.id,
        meta: { ip: req.ip },
      });
      return { ok: true, id: req.params.id };
    },
  });
};
