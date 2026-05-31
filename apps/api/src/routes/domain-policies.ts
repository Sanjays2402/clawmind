import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AUTO_JOIN_ROLES,
  MAX_DOMAIN_LEN,
  MAX_POLICIES,
  listPolicies,
  replacePolicies,
  type AutoJoinRole,
} from '../services/domain-policies.js';
import { Scopes } from '../scopes.js';

// Workspace-level domain auto-join policy management. Backs the
// onboarding-for-orgs flow: an owner says "anyone @acme.com is a member"
// and the auth preHandler picks that up on first login. Every mutation is
// MFA-stepped and audit-logged with a before/after diff.
//
//   GET /v1/domain-policies      list (admin+, domain-policies:read)
//   PUT /v1/domain-policies      atomic replace (owner+admin, MFA, manage)

const PolicyEntry = z.object({
  domain: z.string().trim().min(1).max(MAX_DOMAIN_LEN),
  role: z.enum(AUTO_JOIN_ROLES as readonly [AutoJoinRole, ...AutoJoinRole[]]),
  enabled: z.boolean().optional(),
});

const ReplaceBody = z.object({
  policies: z.array(PolicyEntry).max(MAX_POLICIES),
  dryRun: z.boolean().optional(),
});

const PolicyResponse = z.object({
  domain: z.string(),
  role: z.enum(AUTO_JOIN_ROLES as readonly [AutoJoinRole, ...AutoJoinRole[]]),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const domainPoliciesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/domain-policies', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DomainPoliciesRead),
    ],
    schema: {
      response: {
        200: z.object({
          policies: z.array(PolicyResponse),
          assignableRoles: z.array(z.enum(AUTO_JOIN_ROLES as readonly [AutoJoinRole, ...AutoJoinRole[]])),
          maxPolicies: z.number(),
        }),
      },
    },
    handler: async () => ({
      policies: await listPolicies(app.clawmind.dataDir),
      assignableRoles: [...AUTO_JOIN_ROLES],
      maxPolicies: MAX_POLICIES,
    }),
  });

  app.put('/domain-policies', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireMfa,
      app.requireScope(Scopes.DomainPoliciesManage),
    ],
    schema: { body: ReplaceBody },
    handler: async (req, reply) => {
      const me = req.user!;
      if (req.body.dryRun) {
        return {
          dryRun: true,
          wouldReplaceWith: req.body.policies.map((p) => ({
            domain: p.domain,
            role: p.role,
            enabled: p.enabled !== false,
          })),
        };
      }
      const result = await replacePolicies(app.clawmind.dataDir, req.body.policies);
      if (!result.ok) {
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'domain_policies.replace.denied',
          resource: '/v1/domain-policies',
          meta: { code: result.code, ip: req.ip },
        });
        return reply.code(400).send({ error: result.code, message: describe(result) });
      }
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'domain_policies.replace',
        resource: '/v1/domain-policies',
        meta: {
          before: result.before.map(slim),
          after: result.after.map(slim),
          ip: req.ip,
        },
      });
      return { policies: result.after };
    },
  });
};

function slim(p: { domain: string; role: AutoJoinRole; enabled: boolean }) {
  return { domain: p.domain, role: p.role, enabled: p.enabled };
}

function describe(err: { code: string } & Record<string, unknown>): string {
  switch (err.code) {
    case 'too-many': return `at most ${String(err.max)} policies allowed`;
    case 'invalid-domain': return `invalid domain: ${String(err.value)}`;
    case 'invalid-role': return `invalid role: ${String(err.value)}`;
    case 'duplicate': return `duplicate domain: ${String(err.value)}`;
    default: return err.code;
  }
}
