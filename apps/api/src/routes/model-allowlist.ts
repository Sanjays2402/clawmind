import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setMode,
  addRule,
  removeRule,
  AllowlistValidationError,
  MAX_MODEL_ID_LEN,
  MAX_LABEL_LEN,
} from '../services/model-allowlist.js';
import { Scopes } from '../scopes.js';

// Workspace model-allowlist endpoints.
//
//   GET    /v1/model-allowlist           read policy (admin+)
//   PUT    /v1/model-allowlist/mode      change mode (owner+MFA)
//   POST   /v1/model-allowlist           add a model (owner+MFA)
//   DELETE /v1/model-allowlist/:id       remove a model (owner+MFA)
//
// Enforced at /v1/ask and /v1/ask/stream AFTER the LLM returns its
// model tag. A non-approved model is rejected with 422
// 'model-not-allowed' before history/webhook fanout.

const ModeBody = z
  .object({ mode: z.enum(['disabled', 'allow', 'block']) })
  .strict();

const AddBody = z
  .object({
    model: z.string().min(1).max(MAX_MODEL_ID_LEN),
    label: z.string().max(MAX_LABEL_LEN).nullable().optional(),
  })
  .strict();

const IdParams = z.object({ id: z.string().min(1).max(64) });

export const modelAllowlistRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/model-allowlist', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ModelAllowlistRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return { policy };
    },
  });

  app.put('/model-allowlist/mode', {
    schema: { body: ModeBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ModelAllowlistManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const policy = await setMode(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'model-allowlist.set-mode',
          resource: '/v1/model-allowlist/mode',
          meta: { mode: policy.mode },
        });
        return { policy };
      } catch (err) {
        if (err instanceof AllowlistValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/model-allowlist', {
    schema: { body: AddBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ModelAllowlistManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const rule = await addRule(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'model-allowlist.add',
          resource: '/v1/model-allowlist',
          meta: { ruleId: rule.id, model: rule.model, label: rule.label },
        });
        return reply.code(201).send({ rule });
      } catch (err) {
        if (err instanceof AllowlistValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/model-allowlist/:id', {
    schema: { params: IdParams },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ModelAllowlistManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const { id } = req.params as z.infer<typeof IdParams>;
      const removed = await removeRule(app.clawmind.dataDir, id);
      if (!removed) {
        return reply.code(404).send({ error: 'not-found', id });
      }
      await app.clawmind.audit.write({
        actor: userId,
        action: 'model-allowlist.remove',
        resource: `/v1/model-allowlist/${id}`,
        meta: { ruleId: id, model: removed.model, label: removed.label },
      });
      return { rule: removed };
    },
  });
};
