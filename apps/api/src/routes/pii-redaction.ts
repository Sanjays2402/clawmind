import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  updatePolicy,
  PiiValidationError,
  BUILTIN_CLASSES,
  MAX_CUSTOM_RULES,
  MAX_CUSTOM_LABEL_LEN,
  MAX_CUSTOM_PATTERN_LEN,
} from '../services/pii-redaction.js';
import { Scopes } from '../scopes.js';

// Workspace PII redaction policy endpoints.
//
//   GET  /v1/pii-redaction   read the current policy           (admin+)
//   PUT  /v1/pii-redaction   replace the policy                (owner+MFA)
//
// The policy is enforced at the request entry of /v1/ask, /v1/ask/stream,
// /v1/search, /v1/explain and /v1/batch via lib/pii-redaction-gate.ts
// before retrieval or the LLM runs. Matched secrets are either redacted
// in place ([REDACTED:<class>]) or, for 'block' classes, the request is
// rejected with 422 'pii-blocked'.

const Action = z.enum(['off', 'redact', 'block']);

const Builtins = z
  .object(
    Object.fromEntries(
      BUILTIN_CLASSES.map((c) => [c, Action.optional()]),
    ) as Record<(typeof BUILTIN_CLASSES)[number], z.ZodOptional<typeof Action>>,
  )
  .strict()
  .optional();

const Custom = z
  .array(
    z
      .object({
        id: z.string().min(1).max(64).optional(),
        label: z.string().min(1).max(MAX_CUSTOM_LABEL_LEN),
        pattern: z.string().min(1).max(MAX_CUSTOM_PATTERN_LEN),
        action: Action,
      })
      .strict(),
  )
  .max(MAX_CUSTOM_RULES)
  .optional();

const PutBody = z
  .object({
    builtins: Builtins,
    custom: Custom,
  })
  .strict();

export const piiRedactionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/pii-redaction', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.PiiRedactionRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return { policy };
    },
  });

  app.put('/pii-redaction', {
    schema: { body: PutBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.PiiRedactionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const policy = await updatePolicy(
          app.clawmind.dataDir,
          userId,
          req.body,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: 'pii-redaction.update',
          resource: '/v1/pii-redaction',
          // Patterns themselves are NOT logged: a custom rule can be a
          // regulated string (e.g. a customer code) by design. The rule
          // file is the source of truth.
          meta: {
            builtins: policy.builtins,
            customCount: policy.custom.length,
            customLabels: policy.custom.map((c) => c.label),
          },
        });
        return { policy };
      } catch (err) {
        if (err instanceof PiiValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
