import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listRules,
  addRule,
  removeRule,
  setMode,
  getPolicy,
  PolicyValidationError,
  MAX_PATTERN_LEN,
  MAX_LABEL_LEN,
} from '../services/prompt-injection-policy.js';
import { Scopes } from '../scopes.js';

// Workspace prompt-injection policy endpoints.
//
//   GET    /v1/prompt-injection-policy        mode + active rule set     (admin+)
//   PUT    /v1/prompt-injection-policy/mode   set mode off|monitor|flag|block (owner+MFA)
//   POST   /v1/prompt-injection-policy/rules  add custom rule            (owner+MFA)
//   DELETE /v1/prompt-injection-policy/rules/:id  remove rule
//                                            (custom -> delete row,
//                                             builtin -> disable seed)
//                                                                       (owner+MFA)
//
// Built-in seed rules (OWASP LLM Top 10 jailbreak / exfil patterns)
// are exposed in the list response with builtin=true. Deleting one
// disables the seed for this workspace; future deployments still ship
// it on by default.

const ModeBody = z.object({ mode: z.enum(['off', 'monitor', 'flag', 'block']) }).strict();

const AddRuleBody = z
  .object({
    pattern: z.string().min(1).max(MAX_PATTERN_LEN),
    severity: z.enum(['low', 'med', 'high']).optional().default('med'),
    label: z.string().max(MAX_LABEL_LEN).nullable().optional(),
  })
  .strict();

const IdParams = z.object({ id: z.string().min(1).max(64) });

export const promptInjectionPolicyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/prompt-injection-policy', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.PromptInjectionRead),
    ],
    handler: async () => {
      const view = await listRules(app.clawmind.dataDir);
      return view;
    },
  });

  app.put('/prompt-injection-policy/mode', {
    schema: { body: ModeBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.PromptInjectionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const before = await getPolicy(app.clawmind.dataDir);
      try {
        const updated = await setMode(app.clawmind.dataDir, req.body.mode);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'prompt-injection.mode.set',
          resource: '/v1/prompt-injection-policy/mode',
          meta: { from: before.mode, to: updated.mode },
        });
        return { mode: updated.mode };
      } catch (err) {
        if (err instanceof PolicyValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/prompt-injection-policy/rules', {
    schema: { body: AddRuleBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.PromptInjectionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const rule = await addRule(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'prompt-injection.rule.add',
          resource: '/v1/prompt-injection-policy/rules',
          meta: {
            ruleId: rule.id,
            severity: rule.severity,
            label: rule.label,
            // pattern omitted from the audit chain for the same
            // reason query-blocklist patterns are: the rule is
            // sensitive defensive material on disk, not a fact to
            // replay into the tamper-evident log.
          },
        });
        return reply.code(201).send({ rule });
      } catch (err) {
        if (err instanceof PolicyValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/prompt-injection-policy/rules/:id', {
    schema: { params: IdParams },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.PromptInjectionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const removed = await removeRule(app.clawmind.dataDir, req.params.id);
      if (!removed) {
        return reply.code(404).send({ error: 'not-found', id: req.params.id });
      }
      await app.clawmind.audit.write({
        actor: userId,
        action: 'prompt-injection.rule.remove',
        resource: '/v1/prompt-injection-policy/rules',
        meta: { ruleId: req.params.id },
      });
      return { ok: true, id: req.params.id };
    },
  });
};
