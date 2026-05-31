import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  KNOWN_REGIONS,
  ResidencyValidationError,
  currentServerRegion,
  getPolicy,
  setPolicy,
} from '../services/data-residency.js';
import { Scopes } from '../scopes.js';

// Workspace data residency endpoints.
//
//   GET /v1/data-residency   read policy + current server region (admin+)
//   PUT /v1/data-residency   set allowed regions + controller hint
//                            (owner + MFA step-up)
//
// The server region is reported here so a buyer can confirm via a
// single curl that the workspace policy and the runtime they connected
// to actually agree, without having to look at server logs or env vars.

const PutBody = z
  .object({
    allowedRegions: z.array(z.string()).optional(),
    controller: z.string().max(200).optional(),
  })
  .strict();

export const dataResidencyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/data-residency', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DataResidencyRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return {
        policy,
        serverRegion: currentServerRegion(),
        knownRegions: KNOWN_REGIONS,
      };
    },
  });

  app.put('/data-residency', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.DataResidencyManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          allowedRegions: req.body.allowedRegions,
          controller: req.body.controller,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'data-residency.update',
          resource: '/v1/data-residency',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: {
              allowedRegions: prev.allowedRegions,
              controller: prev.controller,
            },
            after: {
              allowedRegions: next.allowedRegions,
              controller: next.controller,
            },
          },
        });
        return {
          policy: next,
          serverRegion: currentServerRegion(),
          knownRegions: KNOWN_REGIONS,
        };
      } catch (err) {
        if (err instanceof ResidencyValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
