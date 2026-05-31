import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createRequest,
  listRequests,
  approveRequest,
  denyRequest,
  revokeRequest,
  sweepExpired,
  RoleElevationError,
  MIN_DURATION_MIN,
  MAX_DURATION_MIN,
  MAX_REASON_LEN,
} from '../services/role-elevation.js';
import { type MemberRole } from '../services/members.js';
import { Scopes } from '../scopes.js';

// Time-bound role elevation routes (break-glass / JIT privilege).
//
//   GET  /v1/role-elevation/requests              admin+ list (sweeps expired)
//   POST /v1/role-elevation/requests              auth: anyone can request up
//   POST /v1/role-elevation/requests/:id/approve  owner+ four-eyes approval
//   POST /v1/role-elevation/requests/:id/deny     owner+ four-eyes denial
//   POST /v1/role-elevation/requests/:id/revoke   owner+ pull an active grant
//
// Every mutating call lands in the audit chain (the global onResponse
// audit plugin captures the route hit; the explicit writes below tag
// the elevation id and the role transition so a SOC2 reviewer can
// reconstruct "who held what role between T0 and T1, on whose
// approval, and why").
//
// Notes for procurement reviewers:
//   - the requester cannot approve their own elevation (4-eyes)
//   - duration is hard-capped at MAX_DURATION_MIN minutes
//   - reason is required, length-bounded, immutable after submission
//   - the auth plugin overlays the elevated role for the window and
//     drops back automatically when expiresAt passes (no cron needed)

const CreateBody = z
  .object({
    toRole: z.enum(['admin', 'owner']),
    reason: z.string().min(1).max(MAX_REASON_LEN),
    durationMinutes: z.number().int().min(MIN_DURATION_MIN).max(MAX_DURATION_MIN),
  })
  .strict();

const DenyBody = z
  .object({ reason: z.string().max(MAX_REASON_LEN).optional() })
  .strict();

const IdParams = z.object({ id: z.string().min(4).max(64) });

export const roleElevationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/role-elevation/requests', {
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.RoleElevationRead)],
    handler: async () => {
      await sweepExpired(app.clawmind.dataDir).catch(() => undefined);
      const records = await listRequests(app.clawmind.dataDir);
      return { records };
    },
  });

  app.post('/role-elevation/requests', {
    schema: { body: CreateBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.RoleElevationRequest)],
    handler: async (req, reply) => {
      const base = (req.user!.role === 'reader' ? 'viewer' : req.user!.role) as MemberRole;
      try {
        const rec = await createRequest(app.clawmind.dataDir, {
          userId: req.user!.id,
          fromRole: base,
          toRole: req.body.toRole,
          reason: req.body.reason,
          durationMinutes: req.body.durationMinutes,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'role-elevation.request',
          resource: rec.id,
          meta: {
            fromRole: rec.fromRole,
            toRole: rec.toRole,
            durationMinutes: rec.durationMinutes,
            reason: rec.reason,
          },
        });
        return reply.code(201).send({ request: rec });
      } catch (err) {
        if (err instanceof RoleElevationError) {
          return reply.code(400).send({ error: 'invalid_request', message: err.message, field: err.field ?? null });
        }
        throw err;
      }
    },
  });

  app.post('/role-elevation/requests/:id/approve', {
    schema: { params: IdParams },
    preHandler: [app.requireAuth, app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.RoleElevationManage)],
    handler: async (req, reply) => {
      try {
        const rec = await approveRequest(app.clawmind.dataDir, req.params.id, req.user!.id);
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'role-elevation.approve',
          resource: rec.id,
          meta: {
            subject: rec.userId,
            fromRole: rec.fromRole,
            toRole: rec.toRole,
            expiresAt: rec.expiresAt,
            durationMinutes: rec.durationMinutes,
          },
        });
        return { request: rec };
      } catch (err) {
        if (err instanceof RoleElevationError) {
          return reply.code(409).send({ error: 'cannot_approve', message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/role-elevation/requests/:id/deny', {
    schema: { params: IdParams, body: DenyBody },
    preHandler: [app.requireAuth, app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.RoleElevationManage)],
    handler: async (req, reply) => {
      try {
        const rec = await denyRequest(
          app.clawmind.dataDir,
          req.params.id,
          req.user!.id,
          req.body.reason ?? null,
        );
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'role-elevation.deny',
          resource: rec.id,
          meta: { subject: rec.userId, reason: rec.decisionReason },
        });
        return { request: rec };
      } catch (err) {
        if (err instanceof RoleElevationError) {
          return reply.code(409).send({ error: 'cannot_deny', message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/role-elevation/requests/:id/revoke', {
    schema: { params: IdParams },
    preHandler: [app.requireAuth, app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.RoleElevationManage)],
    handler: async (req, reply) => {
      try {
        const rec = await revokeRequest(app.clawmind.dataDir, req.params.id, req.user!.id);
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'role-elevation.revoke',
          resource: rec.id,
          meta: { subject: rec.userId, toRole: rec.toRole },
        });
        return { request: rec };
      } catch (err) {
        if (err instanceof RoleElevationError) {
          return reply.code(409).send({ error: 'cannot_revoke', message: err.message });
        }
        throw err;
      }
    },
  });
};
