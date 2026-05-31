import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  listForUser,
  revokeById,
  revokeAllForUser,
} from '../services/sessions.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Active session management. Enterprise security reviewers expect every
// signed-in user to be able to see "where am I logged in" and force-logout
// a specific browser or every other browser (the classic stolen-laptop
// workflow). Revocation is enforced by the auth preHandler on the next
// request from the revoked sid, so the cookie is dead end-to-end.
export const sessionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/sessions',
    {
      preHandler: [app.requireAuth, app.requireScope(Scopes.SessionsRead)],
      schema: {
        response: {
          200: z.object({
            sessions: z.array(
              z.object({
                id: z.string(),
                userAgent: z.string(),
                ip: z.string(),
                createdAt: z.number(),
                lastSeenAt: z.number(),
                revokedAt: z.number().optional(),
                current: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const sid = (req.session as unknown as { sessionId?: string }).sessionId;
      const sessions = await listForUser(app.clawmind.dataDir, req.user!.id, sid);
      return { sessions };
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { dry_run?: string } }>(
    '/sessions/:id',
    {
      preHandler: [app.requireAuth, app.requireMfa, app.requireScope(Scopes.SessionsManage)],
      schema: {
        params: z.object({ id: z.string().regex(/^[0-9a-f]{6,64}$/i) }),
        querystring: DryRunQuery,
        response: {
          200: z.union([
            z.object({ revoked: z.number() }),
            z.object({ dryRun: z.literal(true), id: z.string(), wouldRevoke: z.literal(true) }),
          ]),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const userId = req.user!.id;
      const sid = req.params.id.toLowerCase();
      const dryRun = isDryRun(req.query.dry_run);
      if (dryRun) {
        const sessions = await listForUser(app.clawmind.dataDir, userId, undefined);
        const found = sessions.some((s) => s.id === sid);
        if (!found) return reply.code(404).send({ error: 'session not found' });
        await app.clawmind.audit.write({
          actor: userId, action: auditAction('session.revoke', true),
          resource: sid, meta: { dryRun: true },
        });
        return { dryRun: true, id: sid, wouldRevoke: true } as const;
      }
      const out = await revokeById(app.clawmind.dataDir, userId, sid);
      if (out.revoked === 0) return reply.code(404).send({ error: 'session not found' });
      await app.clawmind.audit.write({
        actor: userId,
        action: 'session.revoke',
        resource: req.params.id,
      });
      return out;
    },
  );

  app.post(
    '/sessions/revoke-all',
    {
      preHandler: [app.requireAuth, app.requireMfa, app.requireScope(Scopes.SessionsManage)],
      schema: {
        body: z
          .object({
            keepCurrent: z.boolean().optional(),
          })
          .optional(),
        response: {
          200: z.object({ revoked: z.number() }),
        },
      },
    },
    async (req) => {
      const userId = req.user!.id;
      const keepCurrent = req.body?.keepCurrent ?? true;
      const sid = (req.session as unknown as { sessionId?: string }).sessionId;
      const out = await revokeAllForUser(
        app.clawmind.dataDir,
        userId,
        keepCurrent ? sid : undefined,
      );
      await app.clawmind.audit.write({
        actor: userId,
        action: 'session.revoke-all',
        resource: keepCurrent ? 'others' : 'all',
        meta: { revoked: out.revoked },
      });
      return out;
    },
  );
};
