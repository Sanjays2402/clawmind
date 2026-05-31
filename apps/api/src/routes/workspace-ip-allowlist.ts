import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRecord,
  replaceRecord,
  validate,
  diff,
} from '../services/workspace-ip-allowlist.js';
import { MAX_RULES, MAX_LABEL, parseRule, ipInRule } from '../services/ip-allowlist.js';
import { Scopes } from '../scopes.js';

// Workspace-wide IP allowlist management.
//
//   GET  /v1/workspace-ip-allowlist   read current workspace allowlist
//   PUT  /v1/workspace-ip-allowlist   replace it atomically (owner+MFA)
//
// PUT replaces the full document on purpose to sidestep optimistic-
// concurrency bugs when the settings page is open in two tabs. The UI
// submits the canonical state and the server is the single source of
// truth.
//
// We deliberately accept the caller's CURRENT IP in the request body as
// an explicit "confirm I will still be allowed in" field. When the
// allowlist is being enabled and the caller's IP would not match the
// proposed rules, we refuse with 422 so the owner cannot lock themselves
// (and every other member) out with a single typo.

const ruleSchema = z.object({
  cidr: z.string().min(1).max(64),
  label: z.string().max(MAX_LABEL).optional(),
});

const putSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(ruleSchema).max(MAX_RULES),
  confirmSelfLockoutAccepted: z.boolean().optional(),
});

export const workspaceIpAllowlistRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace-ip-allowlist', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.IpAllowlistRead)],
    handler: async () => {
      const rec = await getRecord(app.clawmind.dataDir);
      return { record: rec, limits: { maxRules: MAX_RULES, maxLabel: MAX_LABEL } };
    },
  });

  app.put('/workspace-ip-allowlist', {
    schema: { body: putSchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.IpAllowlistWrite),
    ],
    handler: async (req, reply) => {
      const actor = req.user!.id;
      const prev = await getRecord(app.clawmind.dataDir);

      // Block the foot-gun: enabling with rules that exclude the caller's
      // own IP, unless they explicitly accepted the self-lockout warning
      // (used by automation/break-glass tooling that is calling from a
      // bastion that isn't itself on the corporate range yet).
      if (req.body.enabled) {
        const v = validate({ enabled: true, rules: req.body.rules });
        if (v.ok) {
          const selfAllowed = v.value.rules.some((r) => {
            const p = parseRule(r.cidr);
            return p ? ipInRule(req.ip, p) : false;
          });
          if (!selfAllowed && !req.body.confirmSelfLockoutAccepted) {
            return reply.code(422).send({
              error: 'self_lockout',
              message: 'Your current IP would not match the proposed rules. Add it, or set confirmSelfLockoutAccepted=true.',
              ip: req.ip,
            });
          }
        }
      }

      try {
        const next = await replaceRecord(app.clawmind.dataDir, actor, req.body);
        const d = diff(prev, next);
        await app.clawmind.audit.write({
          actor,
          action: 'workspace-ip-allowlist.update',
          resource: '/v1/workspace-ip-allowlist',
          meta: {
            enabled: next.enabled,
            toggled: d.toggled,
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
