import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listRules,
  filterRules,
  addRule,
  removeRule,
  BlocklistValidationError,
  MAX_PATTERN_LEN,
  MAX_LABEL_LEN,
} from '../services/query-blocklist.js';
import { Scopes } from '../scopes.js';

// Workspace query blocklist endpoints.
//
//   GET    /v1/query-blocklist        list rules            (admin+)
//   POST   /v1/query-blocklist        add a rule            (owner+MFA)
//   DELETE /v1/query-blocklist/:id    remove a rule         (owner+MFA)
//
// Rules are enforced at the request entry of /v1/ask, /v1/ask/stream,
// /v1/search and /v1/explain. A matched query is rejected with 422
// `query-blocked` before retrieval or the LLM runs.

const AddBody = z
  .object({
    pattern: z.string().min(1).max(MAX_PATTERN_LEN),
    mode: z.enum(['literal', 'regex']).optional().default('literal'),
    label: z.string().max(MAX_LABEL_LEN).nullable().optional(),
  })
  .strict();

const IdParams = z.object({ id: z.string().min(1).max(64) });

export const queryBlocklistRoutes: FastifyPluginAsyncZod = async (app) => {
  // Optional `q` filters by a case-insensitive substring of the rule's
  // pattern or label. Mirrors the same filter on /mutes and /pins so a
  // workspace with a long, prompt-injection-driven blocklist can be
  // searched from the admin UI (e.g. all rules labelled
  // "prompt-injection", or any pattern mentioning "ssn").
  app.get<{ Querystring: { q?: string } }>('/query-blocklist', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.QueryBlocklistRead),
    ],
    handler: async (req) => {
      const all = await listRules(app.clawmind.dataDir);
      const rules = filterRules(all, req.query.q);
      return { rules };
    },
  });

  app.post('/query-blocklist', {
    schema: { body: AddBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.QueryBlocklistManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const rule = await addRule(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'query-blocklist.add',
          resource: '/v1/query-blocklist',
          meta: {
            ruleId: rule.id,
            mode: rule.mode,
            label: rule.label,
            // pattern intentionally omitted from the audit log; the
            // rule itself is the source of truth and patterns may
            // contain regulated terms by design.
          },
        });
        return reply.code(201).send({ rule });
      } catch (err) {
        if (err instanceof BlocklistValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/query-blocklist/:id', {
    schema: { params: IdParams },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.QueryBlocklistManage),
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
        action: 'query-blocklist.remove',
        resource: `/v1/query-blocklist/${id}`,
        meta: { ruleId: id, mode: removed.mode, label: removed.label },
      });
      return { rule: removed };
    },
  });
};
