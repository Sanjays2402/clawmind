import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  MEMBER_ROLES,
  type MemberRole,
} from '../services/members.js';
import {
  closeReview,
  getReview,
  listReviews,
  openReview,
  setDecision,
  summarise,
} from '../services/access-reviews.js';
import { Scopes } from '../scopes.js';

// HTTP surface for access-reviews. SOC2 CC6.3 calls for periodic
// recertification of who has what access; this is the route owners use
// to walk the member list, mark each row keep/downgrade/revoke, and
// attest the result. Every mutation is audit-logged; closing a review
// emits one audit record per applied member change so an external
// reviewer reading the audit chain can reconstruct the decision and
// the resulting role/membership delta without joining tables.
//
//   GET    /v1/access-reviews                      (admin+, read)
//   GET    /v1/access-reviews/summary              (admin+, read)
//   GET    /v1/access-reviews/:id                  (admin+, read)
//   POST   /v1/access-reviews                      (owner, manage, MFA)
//   POST   /v1/access-reviews/:id/decisions/:uid   (owner, manage, MFA)
//   POST   /v1/access-reviews/:id/close            (owner, manage, MFA)

const RoleEnum = z.enum(MEMBER_ROLES as readonly [MemberRole, ...MemberRole[]]);

const OpenSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dryRun: z.boolean().optional(),
});

const DecideSchema = z.object({
  decision: z.enum(['keep', 'downgrade', 'revoke']),
  downgradeTo: RoleEnum.nullish(),
  note: z.string().trim().max(1000).nullish(),
});

const CloseSchema = z.object({
  attestation: z.string().trim().max(1000).nullish(),
  dryRun: z.boolean().optional(),
});

function actorRole(role: string): MemberRole {
  if (role === 'reader') return 'viewer';
  if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') return role;
  return 'viewer';
}

export const accessReviewsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/access-reviews', {
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.AccessReviewsRead)],
    handler: async () => {
      const reviews = await listReviews(app.clawmind.dataDir);
      return { reviews };
    },
  });

  app.get('/access-reviews/summary', {
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.AccessReviewsRead)],
    handler: async () => summarise(app.clawmind.dataDir),
  });

  app.get<{ Params: { id: string } }>('/access-reviews/:id', {
    schema: { params: z.object({ id: z.string().min(1).max(200) }) },
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.AccessReviewsRead)],
    handler: async (req, reply) => {
      const rec = await getReview(app.clawmind.dataDir, req.params.id);
      if (!rec) return reply.code(404).send({ error: 'not-found' });
      return { review: rec };
    },
  });

  app.post<{ Body: z.infer<typeof OpenSchema> }>('/access-reviews', {
    schema: { body: OpenSchema },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AccessReviewsManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      if (req.body.dryRun) {
        return { dryRun: true, wouldOpen: { title: req.body.title } };
      }
      const rec = await openReview(app.clawmind.dataDir, {
        title: req.body.title,
        openedBy: me.id,
      });
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'access-reviews.open',
        resource: rec.id,
        meta: { title: rec.title, items: rec.items.length, ip: req.ip },
      });
      reply.code(201);
      return { review: rec };
    },
  });

  app.post<{ Params: { id: string; userId: string }; Body: z.infer<typeof DecideSchema> }>(
    '/access-reviews/:id/decisions/:userId',
    {
      schema: {
        params: z.object({
          id: z.string().min(1).max(200),
          userId: z.string().min(1).max(200),
        }),
        body: DecideSchema,
      },
      preHandler: [
        app.requireAuth,
        app.requireMinRole('owner'),
        app.requireMfa,
        app.requireScope(Scopes.AccessReviewsManage),
      ],
      handler: async (req, reply) => {
        const me = req.user!;
        const r = await setDecision(app.clawmind.dataDir, req.params.id, req.params.userId, {
          decision: req.body.decision,
          downgradeTo: req.body.downgradeTo ?? null,
          note: req.body.note ?? null,
          decidedBy: me.id,
        });
        if (!r.ok) {
          const status = r.code === 'not-found' || r.code === 'item-not-found' ? 404 : 409;
          return reply.code(status).send({ error: r.code });
        }
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'access-reviews.decide',
          resource: `${req.params.id}/${req.params.userId}`,
          meta: {
            decision: req.body.decision,
            downgradeTo: req.body.downgradeTo ?? null,
            ip: req.ip,
          },
        });
        return { review: r.review };
      },
    },
  );

  app.post<{ Params: { id: string }; Body: z.infer<typeof CloseSchema> }>(
    '/access-reviews/:id/close',
    {
      schema: {
        params: z.object({ id: z.string().min(1).max(200) }),
        body: CloseSchema,
      },
      preHandler: [
        app.requireAuth,
        app.requireMinRole('owner'),
        app.requireMfa,
        app.requireScope(Scopes.AccessReviewsManage),
      ],
      handler: async (req, reply) => {
        const me = req.user!;
        if (req.body.dryRun) {
          const preview = await getReview(app.clawmind.dataDir, req.params.id);
          if (!preview) return reply.code(404).send({ error: 'not-found' });
          return {
            dryRun: true,
            pending: preview.items.filter((i) => i.decision === 'pending').map((i) => i.userId),
            toDowngrade: preview.items.filter((i) => i.decision === 'downgrade').length,
            toRevoke: preview.items.filter((i) => i.decision === 'revoke').length,
            toKeep: preview.items.filter((i) => i.decision === 'keep').length,
          };
        }
        const r = await closeReview(app.clawmind.dataDir, req.params.id, {
          closedBy: me.id,
          closerRole: actorRole(me.role),
          attestation: req.body.attestation ?? null,
        });
        if (!r.ok) {
          const status = r.code === 'not-found' ? 404 : 409;
          await app.clawmind.audit.write({
            actor: me.id,
            action: 'access-reviews.close.denied',
            resource: req.params.id,
            meta: { code: r.code, ip: req.ip },
          });
          return reply.code(status).send({ error: r.code, ...(r.code === 'pending-decisions' ? { pending: r.pending } : {}) });
        }
        // One audit record per applied change so the chain reflects the
        // real-world effect of the close, plus a summary record naming
        // the attesting owner.
        for (const change of r.applied) {
          await app.clawmind.audit.write({
            actor: me.id,
            action: `access-reviews.applied.${change.action}`,
            resource: `${req.params.id}/${change.userId}`,
            meta: { error: change.error, ip: req.ip },
          });
        }
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'access-reviews.close',
          resource: req.params.id,
          meta: {
            items: r.review.items.length,
            applied: r.applied.length,
            attestation: r.review.attestation,
            ip: req.ip,
          },
        });
        return { review: r.review, applied: r.applied };
      },
    },
  );
};
