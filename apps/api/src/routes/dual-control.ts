import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createRequest,
  listRequests,
  getRequest,
  approveRequest,
  rejectRequest,
  DualControlValidationError,
  DualControlStateError,
  MAX_REASON,
  MIN_TTL_MS,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
} from '../services/dual-control.js';
import { Scopes } from '../scopes.js';

// Dual-control (four-eyes) approval endpoints.
//
//   GET    /v1/dual-control                 list all approvals (admin+)
//   GET    /v1/dual-control/:id             read one (admin+)
//   POST   /v1/dual-control                 request a new approval (owner+MFA)
//   POST   /v1/dual-control/:id/approve     approve (owner+MFA, different actor)
//   POST   /v1/dual-control/:id/reject      reject (owner+MFA)
//
// See services/dual-control.ts for the state machine. Consumption of an
// approval happens implicitly when a gated route presents the matching
// `X-DualControl-Approval: <id>` header (currently:
// POST /v1/workspace/deletion).

const CreateBody = z
  .object({
    action: z.string().min(1).max(120),
    resource: z.string().min(1).max(200),
    reason: z.string().max(MAX_REASON).nullable().optional(),
    ttlMs: z.number().int().min(MIN_TTL_MS).max(MAX_TTL_MS).nullable().optional(),
  })
  .strict();

const IdParam = z.object({ id: z.string().min(3).max(64) }).strict();

function limits() {
  return { minTtlMs: MIN_TTL_MS, defaultTtlMs: DEFAULT_TTL_MS, maxTtlMs: MAX_TTL_MS };
}

export const dualControlRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/dual-control', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DualControlRead),
    ],
    handler: async () => {
      const items = await listRequests(app.clawmind.dataDir);
      return { items, limits: limits() };
    },
  });

  app.get('/dual-control/:id', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DualControlRead),
    ],
    handler: async (req, reply) => {
      const rec = await getRequest(app.clawmind.dataDir, req.params.id);
      if (!rec) return reply.code(404).send({ error: 'not-found' });
      return { item: rec };
    },
  });

  app.post('/dual-control', {
    schema: { body: CreateBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.DualControlManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const rec = await createRequest(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'dual-control.request',
          resource: '/v1/dual-control',
          meta: {
            id: rec.id,
            forAction: rec.action,
            forResource: rec.resource,
            expiresAt: rec.expiresAt,
          },
        });
        return reply.code(201).send({ item: rec });
      } catch (err) {
        if (err instanceof DualControlValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/dual-control/:id/approve', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.DualControlManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const rec = await approveRequest(app.clawmind.dataDir, userId, req.params.id);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'dual-control.approve',
          resource: `/v1/dual-control/${rec.id}`,
          meta: { id: rec.id, forAction: rec.action, requestedBy: rec.requestedBy },
        });
        return { item: rec };
      } catch (err) {
        if (err instanceof DualControlStateError) {
          const code = err.code === 'not-found' ? 404 : 409;
          return reply.code(code).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/dual-control/:id/reject', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.DualControlManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const rec = await rejectRequest(app.clawmind.dataDir, userId, req.params.id);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'dual-control.reject',
          resource: `/v1/dual-control/${rec.id}`,
          meta: { id: rec.id, forAction: rec.action, requestedBy: rec.requestedBy },
        });
        return { item: rec };
      } catch (err) {
        if (err instanceof DualControlStateError) {
          const code = err.code === 'not-found' ? 404 : 409;
          return reply.code(code).send({ error: err.code, message: err.message });
        }
        throw err;
      }
    },
  });
};
