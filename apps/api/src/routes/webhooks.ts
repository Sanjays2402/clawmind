import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  WEBHOOK_EVENTS,
  type WebhookEvent,
  createWebhook,
  deleteWebhook,
  deliverOnce,
  listDeliveries,
  listForUser,
  loadAll,
  redact,
  redeliver,
  updateWebhook,
} from '../services/webhooks.js';
import { Scopes } from '../scopes.js';

const EventEnum = z.enum(WEBHOOK_EVENTS);

const CreateBody = z.object({
  url: z.string().url(),
  events: z.array(EventEnum).min(1).max(WEBHOOK_EVENTS.length),
});

const UpdateBody = z.object({
  url: z.string().url().optional(),
  events: z.array(EventEnum).min(1).max(WEBHOOK_EVENTS.length).optional(),
  active: z.boolean().optional(),
});

const ListDeliveriesQuery = z.object({
  webhookId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

// Webhooks let customers receive a real outbound POST when something happens
// inside ClawMind, instead of polling /v1/history. The full lifecycle lives
// here: register, list, update (pause/resume), delete, test fire, and read
// the delivery log to debug a failing receiver.
export const webhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/webhooks/events', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.WebhooksRead)],
    handler: async () => ({ events: WEBHOOK_EVENTS }),
  });

  app.get('/webhooks', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.WebhooksRead)],
    handler: async (req) => {
      const items = await listForUser(app.clawmind.dataDir, req.user!.id);
      return { items: items.map(redact) };
    },
  });

  app.post('/webhooks', {
    schema: { body: CreateBody },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.WebhooksManage)],
    handler: async (req, reply) => {
      try {
        const wh = await createWebhook(
          app.clawmind.dataDir,
          req.user!.id,
          req.body.url,
          req.body.events as WebhookEvent[],
        );
        await app.clawmind.audit.write({
          actor: req.user!.id, action: 'webhook.create', resource: wh.id,
          meta: { url: wh.url, events: wh.events },
        });
        // Return the secret exactly once; subsequent reads redact it.
        return reply.code(201).send({ webhook: wh });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.startsWith('unsafe url:')) {
          await app.clawmind.audit.write({
            actor: req.user!.id,
            action: 'webhook.blocked',
            resource: req.body.url,
            meta: { reason: msg, op: 'create' },
          });
        }
        return reply.code(400).send({ error: msg });
      }
    },
  });

  app.patch<{ Params: { id: string } }>('/webhooks/:id', {
    schema: { body: UpdateBody },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.WebhooksManage)],
    handler: async (req, reply) => {
      try {
        const wh = await updateWebhook(
          app.clawmind.dataDir,
          req.user!.id,
          req.params.id,
          req.body as Parameters<typeof updateWebhook>[3],
        );
        if (!wh) return reply.code(404).send({ error: 'not found' });
        await app.clawmind.audit.write({
          actor: req.user!.id, action: 'webhook.update', resource: wh.id,
          meta: req.body as Record<string, unknown>,
        });
        return { webhook: redact(wh) };
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.startsWith('unsafe url:')) {
          await app.clawmind.audit.write({
            actor: req.user!.id,
            action: 'webhook.blocked',
            resource: req.params.id,
            meta: { reason: msg, op: 'update' },
          });
        }
        return reply.code(400).send({ error: msg });
      }
    },
  });

  app.delete<{ Params: { id: string } }>('/webhooks/:id', {
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.WebhooksManage)],
    handler: async (req, reply) => {
      const ok = await deleteWebhook(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'webhook.delete', resource: req.params.id,
      });
      return { ok: true };
    },
  });

  // Fire a synthetic event so the user can verify their receiver is reachable
  // and the signature header validates before wiring up real traffic.
  app.post<{ Params: { id: string } }>('/webhooks/:id/test', {
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.WebhooksManage)],
    handler: async (req, reply) => {
      const all = await loadAll(app.clawmind.dataDir);
      const wh = all.find((w) => w.id === req.params.id && w.userId === req.user!.id);
      if (!wh) return reply.code(404).send({ error: 'not found' });
      const result = await deliverOnce(app.clawmind.dataDir, wh, 'ask.completed', {
        test: true, message: 'hello from clawmind',
      });
      return { delivery: result };
    },
  });

  app.get('/webhooks/deliveries', {
    schema: { querystring: ListDeliveriesQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.WebhooksRead)],
    handler: async (req) => {
      const { webhookId, limit } = req.query as z.infer<typeof ListDeliveriesQuery>;
      const items = await listDeliveries(app.clawmind.dataDir, req.user!.id, webhookId, limit);
      return { items };
    },
  });

  // Manually replay a past delivery. Returns the new delivery row so the
  // UI can show the result inline without forcing a list refresh.
  app.post<{ Params: { id: string } }>('/webhooks/deliveries/:id/redeliver', {
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.WebhooksManage)],
    handler: async (req, reply) => {
      const result = await redeliver(app.clawmind.dataDir, req.user!.id, req.params.id);
      if ('error' in result) {
        const code = result.error === 'not_found' ? 404 : result.error === 'webhook_gone' ? 410 : 409;
        return reply.code(code).send({ error: result.error });
      }
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'webhook.redeliver', resource: result.delivery.webhookId,
        meta: { originalId: req.params.id, newId: result.delivery.id, ok: result.delivery.ok, status: result.delivery.status },
      });
      return { delivery: result.delivery };
    },
  });
};
