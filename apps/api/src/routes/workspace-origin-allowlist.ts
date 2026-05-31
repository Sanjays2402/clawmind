import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRecord,
  replaceRecord,
  diff,
  MAX_ORIGIN_RULES,
  MAX_LABEL,
} from '../services/workspace-origin-allowlist.js';
import { Scopes } from '../scopes.js';

// Workspace-wide browser Origin (CORS) allowlist management.
//
//   GET  /v1/workspace-origin-allowlist   read current allowlist (admins+)
//   PUT  /v1/workspace-origin-allowlist   replace it atomically (owner+MFA)
//
// PUT replaces the full document on purpose so two tabs of the settings
// page cannot race a partial update through. The static
// CLAWMIND_API_CORS_ORIGIN env value remains the vendor-controlled baseline;
// this list is additive and gives workspace owners a self-service way to
// admit their own dashboard origin without filing a support ticket.

const ruleSchema = z.object({
  origin: z.string().min(1).max(256),
  label: z.string().max(MAX_LABEL).optional(),
});

const putSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(ruleSchema).max(MAX_ORIGIN_RULES),
});

export const workspaceOriginAllowlistRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace-origin-allowlist', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.OriginAllowlistRead)],
    handler: async () => {
      const rec = await getRecord(app.clawmind.dataDir);
      return { record: rec, limits: { maxRules: MAX_ORIGIN_RULES, maxLabel: MAX_LABEL } };
    },
  });

  app.put('/workspace-origin-allowlist', {
    schema: { body: putSchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.OriginAllowlistWrite),
    ],
    handler: async (req, reply) => {
      const actor = req.user!.id;
      const prev = await getRecord(app.clawmind.dataDir);
      try {
        const next = await replaceRecord(app.clawmind.dataDir, actor, req.body);
        const d = diff(prev, next);
        await app.clawmind.audit.write({
          actor,
          action: 'workspace-origin-allowlist.update',
          resource: '/v1/workspace-origin-allowlist',
          meta: {
            enabled: next.enabled,
            toggled: d.toggled,
            added: d.added,
            removed: d.removed,
            requestId: req.id,
            ip: req.ip,
          },
        });
        return { record: next };
      } catch (err) {
        const e = err as Error & { field?: string };
        return reply.code(400).send({ error: 'invalid', field: e.field ?? null, message: e.message });
      }
    },
  });
};
