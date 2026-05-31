import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { issueKey, listKeys, revokeKey, redact, SCOPE_RE, WILDCARD_SCOPE } from '../services/api-keys.js';
import { Scopes, KNOWN_SCOPES } from '../scopes.js';
import { completeStep as completeOnboardingStep } from '../services/onboarding.js';

const ScopeSchema = z.string()
  .refine(
    (s) => s === WILDCARD_SCOPE || SCOPE_RE.test(s),
    { message: "scope must be '*' or '<resource>:(read|write|admin)'" },
  )
  // Reject scopes that no route actually enforces. Without this check a typo
  // like 'searh:read' would silently grant nothing extra but also restrict
  // nothing, so a key that looks scoped is in practice unrestricted.
  .refine(
    (s) => s === WILDCARD_SCOPE || (KNOWN_SCOPES as readonly string[]).includes(s),
    { message: 'unknown scope; GET /v1/keys/scopes for the list' },
  );

const IssueBody = z.object({
  label: z.string().min(1).max(80),
  role: z.enum(['owner', 'reader']).default('owner'),
  scopes: z.array(ScopeSchema).max(32).optional(),
  ttlMs: z.number().int().positive().max(365 * 24 * 60 * 60_000).nullable().optional(),
});

export const keyRoutes: FastifyPluginAsyncZod = async (app) => {
  // Catalogue of every scope the server currently enforces. Useful for UIs
  // that render checkboxes when issuing a key. Auth-gated so it does not
  // leak from an internet-exposed instance.
  app.get('/keys/scopes', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.KeysManage)],
    handler: async () => ({ scopes: KNOWN_SCOPES, wildcard: WILDCARD_SCOPE }),
  });

  app.get('/keys', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.KeysManage)],
    handler: async (req) => {
      const keys = await listKeys(app.clawmind.dataDir, req.user!.id);
      return { items: keys.map(redact) };
    },
  });

  app.post('/keys', {
    schema: { body: IssueBody },
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.KeysManage)],
    handler: async (req) => {
      const issued = await issueKey(app.clawmind.dataDir, {
        userId: req.user!.id,
        label: req.body.label,
        role: req.body.role,
        scopes: req.body.scopes,
        ttlMs: req.body.ttlMs ?? null,
      });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'api_key.issue', resource: issued.record.id,
        meta: { label: issued.record.label, role: issued.record.role, scopes: issued.record.scopes ?? null },
      });
      void completeOnboardingStep(app.clawmind.dataDir, req.user!.id, 'configure').catch(() => undefined);
      return { key: redact(issued.record), secret: issued.secret };
    },
  });

  app.delete<{ Params: { id: string } }>('/keys/:id', {
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const ok = await revokeKey(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'api_key.revoke', resource: req.params.id,
      });
      return { ok: true };
    },
  });
};
