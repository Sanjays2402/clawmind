import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  publishPolicy,
  listPolicies,
  getCurrentPolicies,
  acceptPolicy,
  listAcceptances,
  unmetPolicies,
  acceptanceSummary,
  PolicyValidationError,
  MAX_TITLE,
  MAX_BODY,
  POLICY_KINDS,
} from '../services/policies.js';
import { Scopes } from '../scopes.js';

// Policy acceptance endpoints (TOS / DPA / AUP).
//
//   GET  /v1/policies                 list currently-in-force policies
//   GET  /v1/policies/all             list every version including superseded (admin+)
//   POST /v1/policies                 publish a new version (owner+MFA)
//   GET  /v1/policies/me              my acceptance status + unmet policies
//   POST /v1/policies/:id/accept      affirmatively accept a policy
//   GET  /v1/policies/acceptances     list every acceptance (admin+)
//   GET  /v1/policies/summary         per-policy acceptance counts (admin+)
//
// The policy-gate plugin enforces unmet required policies on every
// non-essential request so a workspace with a published required DPA
// will return 451 until the user accepts.

const KindEnum = z.enum(POLICY_KINDS as readonly [string, ...string[]]);

const PublishBody = z.object({
  kind: KindEnum,
  title: z.string().min(1).max(MAX_TITLE),
  body: z.string().min(1).max(MAX_BODY),
  required: z.boolean().optional(),
  effectiveAt: z.number().int().nonnegative().nullable().optional(),
}).strict();

const ListQuery = z.object({
  kind: KindEnum.optional(),
  include_superseded: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
}).strict();

const AcceptancesQuery = z.object({
  user_id: z.string().min(1).max(256).optional(),
  policy_id: z.string().min(1).max(256).optional(),
}).strict();

export const policyRoutes: FastifyPluginAsyncZod = async (app) => {
  // Currently-in-force policies. Auth-gated (not public) because a
  // workspace may publish internal-only AUP language.
  app.get('/policies', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.PoliciesRead)],
    handler: async () => {
      const items = await getCurrentPolicies(app.clawmind.dataDir);
      return { items };
    },
  });

  // Full version history, including superseded. Admin+ only because
  // historic body text is part of the legal record and should not be
  // browseable by a viewer-role API key.
  app.get('/policies/all', {
    schema: { querystring: ListQuery },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.PoliciesRead),
    ],
    handler: async (req) => {
      const includeSuperseded = req.query.include_superseded === 'true' || req.query.include_superseded === '1';
      const items = await listPolicies(app.clawmind.dataDir, {
        kind: req.query.kind as any,
        includeSuperseded,
      });
      return { items };
    },
  });

  // My acceptance status + the list of unmet required policies. Used by
  // the UI to drive the accept screen and by clients to detect the 451
  // condition proactively.
  app.get('/policies/me', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.PoliciesRead)],
    handler: async (req) => {
      const userId = req.user!.id;
      const [accepted, unmet, current] = await Promise.all([
        listAcceptances(app.clawmind.dataDir, { userId }),
        unmetPolicies(app.clawmind.dataDir, userId),
        getCurrentPolicies(app.clawmind.dataDir),
      ]);
      return { acceptances: accepted, unmet, current };
    },
  });

  // Publish a new version. Owner role + MFA step-up + dedicated scope
  // because a new required policy can immediately gate every other
  // user out of the API until they accept.
  app.post('/policies', {
    schema: { body: PublishBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.PoliciesManage),
    ],
    handler: async (req, reply) => {
      try {
        const policy = await publishPolicy(app.clawmind.dataDir, req.user!.id, {
          kind: req.body.kind as any,
          title: req.body.title,
          body: req.body.body,
          required: req.body.required,
          effectiveAt: req.body.effectiveAt ?? null,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'policy.publish',
          resource: policy.id,
          meta: {
            kind: policy.kind,
            title: policy.title,
            required: policy.required,
            bodyHash: policy.bodyHash,
            effectiveAt: policy.effectiveAt,
          },
        });
        return { policy };
      } catch (err) {
        if (err instanceof PolicyValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  // Affirmative acceptance. The acting user identity is taken from the
  // session / API key owner; we never accept "on behalf of" another
  // user, even for an owner role, so the audit record is unambiguous.
  app.post<{ Params: { id: string } }>('/policies/:id/accept', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.PoliciesAccept)],
    handler: async (req, reply) => {
      try {
        const accepted = await acceptPolicy(app.clawmind.dataDir, {
          policyId: req.params.id,
          userId: req.user!.id,
          ip: req.ip ?? '',
          userAgent: String(req.headers['user-agent'] ?? ''),
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'policy.accept',
          resource: accepted.policyId,
          meta: { acceptedAt: accepted.acceptedAt, ip: accepted.ip },
        });
        return { acceptance: accepted };
      } catch (err) {
        if (err instanceof PolicyValidationError) {
          return reply.code(404).send({ error: 'not_found', message: err.message });
        }
        throw err;
      }
    },
  });

  // Acceptance log readable by admins+ for compliance review. Cannot
  // filter or mutate by anything that would let an operator delete
  // history.
  app.get('/policies/acceptances', {
    schema: { querystring: AcceptancesQuery },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.PoliciesRead),
    ],
    handler: async (req) => {
      const items = await listAcceptances(app.clawmind.dataDir, {
        userId: req.query.user_id,
        policyId: req.query.policy_id,
      });
      return { items };
    },
  });

  // Per-policy acceptance counts for the admin console.
  app.get('/policies/summary', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.PoliciesRead),
    ],
    handler: async () => {
      const items = await acceptanceSummary(app.clawmind.dataDir);
      return { items };
    },
  });
};
