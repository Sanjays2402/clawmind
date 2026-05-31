import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRecord,
  replaceRecord,
  diff,
  MAX_RULES,
  MAX_LABEL,
} from '../services/ip-allowlist.js';
import { Scopes } from '../scopes.js';

// IP allowlist management endpoints.
//
//   GET  /v1/ip-allowlist   read the caller's current allowlist + enabled flag
//   PUT  /v1/ip-allowlist   replace the entire allowlist atomically
//
// PUT replaces the full document on purpose: it sidesteps a class of
// concurrency bugs that an "append rule" style endpoint would introduce when
// the settings page is open in two tabs at once. The UI submits the
// canonical state and the server is the single source of truth.

const ruleSchema = z.object({
  cidr: z.string().min(1).max(64),
  label: z.string().max(MAX_LABEL).optional(),
});

const putSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(ruleSchema).max(MAX_RULES),
});

export const ipAllowlistRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/ip-allowlist', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.IpAllowlistRead)],
    handler: async (req) => {
      const rec = await getRecord(app.clawmind.dataDir, req.user!.id);
      return { record: rec, limits: { maxRules: MAX_RULES, maxLabel: MAX_LABEL } };
    },
  });

  app.put('/ip-allowlist', {
    schema: { body: putSchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.IpAllowlistWrite),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const prev = await getRecord(app.clawmind.dataDir, userId);
      try {
        const next = await replaceRecord(app.clawmind.dataDir, userId, req.body);
        const d = diff(prev, next);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'ip-allowlist.update',
          resource: '/v1/ip-allowlist',
          meta: {
            enabled: d.enabled,
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
