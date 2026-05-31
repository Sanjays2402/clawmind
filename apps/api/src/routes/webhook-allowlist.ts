import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRecord,
  replaceRecord,
  diff,
  MAX_HOSTS,
  MAX_LABEL,
  MAX_HOST_LEN,
} from '../services/webhook-allowlist.js';
import { Scopes } from '../scopes.js';

// Workspace-managed outbound webhook destination allowlist.
//
//   GET  /v1/webhook-allowlist   read the workspace's current allowlist
//   PUT  /v1/webhook-allowlist   replace the entire allowlist atomically
//
// PUT replaces the full document on purpose: it avoids the concurrency
// trap an "append host" style endpoint hits when two admins edit the
// page in different tabs. The client submits the canonical state and
// the server is the single source of truth, same shape as
// /v1/ip-allowlist.

const hostSchema = z.object({
  host: z.string().min(1).max(MAX_HOST_LEN),
  label: z.string().max(MAX_LABEL).optional(),
});

const putSchema = z.object({
  enabled: z.boolean(),
  hosts: z.array(hostSchema).max(MAX_HOSTS),
});

export const webhookAllowlistRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/webhook-allowlist', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.WebhookAllowlistRead)],
    handler: async (req) => {
      const rec = await getRecord(app.clawmind.dataDir, req.user!.id);
      return {
        record: rec,
        limits: { maxHosts: MAX_HOSTS, maxLabel: MAX_LABEL, maxHostLen: MAX_HOST_LEN },
      };
    },
  });

  app.put('/webhook-allowlist', {
    schema: { body: putSchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WebhookAllowlistWrite),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const prev = await getRecord(app.clawmind.dataDir, userId);
      try {
        const next = await replaceRecord(app.clawmind.dataDir, userId, req.body);
        const d = diff(prev, next);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'webhook-allowlist.update',
          resource: '/v1/webhook-allowlist',
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
        return reply
          .code(400)
          .send({ error: 'invalid', field: e.field ?? null, message: e.message });
      }
    },
  });
};
