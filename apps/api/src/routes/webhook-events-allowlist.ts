import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  getRecord,
  replaceRecord,
  diff,
} from '../services/webhook-events-allowlist.js';
import { WEBHOOK_EVENTS } from '../services/webhooks.js';
import { Scopes } from '../scopes.js';

// Workspace-managed allowlist over which webhook *event subjects* may be
// subscribed to. Companion to /v1/webhook-allowlist (destination hosts).
//
//   GET /v1/webhook-events-allowlist  read the current policy
//   PUT /v1/webhook-events-allowlist  replace it atomically (owner + MFA)
//
// PUT replaces the full document on purpose, same shape as the sibling
// allowlist routes (ip-allowlist, webhook-allowlist) so the UI is a
// single submitted form rather than a series of partial mutations.

const putSchema = z.object({
  enabled: z.boolean(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length),
});

export const webhookEventsAllowlistRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/webhook-events-allowlist', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.WebhookEventsAllowlistRead)],
    handler: async (req) => {
      const rec = await getRecord(app.clawmind.dataDir, req.user!.id);
      return {
        record: rec,
        events: WEBHOOK_EVENTS,
      };
    },
  });

  app.put('/webhook-events-allowlist', {
    schema: { body: putSchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.WebhookEventsAllowlistWrite),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const prev = await getRecord(app.clawmind.dataDir, userId);
      try {
        const next = await replaceRecord(app.clawmind.dataDir, userId, req.body);
        const d = diff(prev, next);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'webhook-events-allowlist.update',
          resource: '/v1/webhook-events-allowlist',
          meta: {
            enabled: d.enabled,
            added: d.added,
            removed: d.removed,
            requestId: req.id,
            ip: req.ip,
          },
        });
        return { record: next, events: WEBHOOK_EVENTS };
      } catch (err) {
        const e = err as Error & { field?: string };
        return reply
          .code(400)
          .send({ error: 'invalid', field: e.field ?? null, message: e.message });
      }
    },
  });
};
