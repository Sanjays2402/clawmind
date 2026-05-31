import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getProfile, updateProfile, validatePatch, PROFILE_LIMITS } from '../services/profile.js';
import { Scopes } from '../scopes.js';

// Profile endpoints. Complement /v1/me/export and /v1/me/data which live in
// lifecycle.ts. The TODO comment in lifecycle.ts explicitly reserved /v1/me
// for the profile read; this is the route that fills that slot.
//
//   GET   /v1/me          read the authenticated user's profile (auto-creates defaults on first read)
//   PATCH /v1/me          update displayName / timezone / defaultModel
//
// Per-user isolation is enforced by reading req.user!.id; an API key with
// scope 'profile:read' can only ever see its own owner's profile because the
// service layer keys on userId, not on a path parameter.

const patchSchema = z
  .object({
    displayName: z.string().min(1).max(PROFILE_LIMITS.MAX_NAME).optional(),
    timezone: z.string().min(1).max(PROFILE_LIMITS.MAX_TZ).optional(),
    defaultModel: z.string().max(PROFILE_LIMITS.MAX_MODEL).nullable().optional(),
  })
  .strict();

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ProfileRead)],
    handler: async (req) => {
      const userId = req.user!.id;
      const profile = await getProfile(app.clawmind.dataDir, userId);
      return { profile };
    },
  });

  app.patch('/me', {
    schema: { body: patchSchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ProfileWrite)],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const check = validatePatch(req.body as Record<string, unknown>);
      if (!check.ok) {
        return reply.code(400).send({ error: 'invalid', field: check.field, message: check.message });
      }
      const profile = await updateProfile(app.clawmind.dataDir, userId, check.value);
      await app.clawmind.audit.write({
        actor: userId,
        action: 'profile.update',
        resource: '/v1/me',
        meta: { fields: Object.keys(check.value) },
      });
      return { profile };
    },
  });
};
