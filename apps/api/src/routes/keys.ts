import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { issueKey, listKeys, revokeKey, rotateKey, redact, SCOPE_RE, WILDCARD_SCOPE, loadKeys } from '../services/api-keys.js';
import { getUsageReport, purgeUsage } from '../services/api-key-usage.js';
import { Scopes, KNOWN_SCOPES } from '../scopes.js';
import { completeStep as completeOnboardingStep } from '../services/onboarding.js';

const UsageQuery = z.object({
  recent: z.coerce.number().int().positive().max(200).optional(),
  routes: z.coerce.number().int().positive().max(50).optional(),
});

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
      // Best-effort cleanup of the per-key usage log. Revoked keys cannot
      // generate new events and the log has no value once the credential
      // is dead.
      void purgeUsage(app.clawmind.dataDir, req.params.id).catch(() => undefined);
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'api_key.revoke', resource: req.params.id,
      });
      return { ok: true };
    },
  });

  // Per-key usage report. Answers "is this key actually used, and what is
  // it doing?" so a customer can rotate or revoke with confidence. Scoped
  // to the key's owner; cross-user lookups return 404 even if the id
  // happens to exist for someone else.
  app.get<{ Params: { id: string }; Querystring: z.infer<typeof UsageQuery> }>('/keys/:id/usage', {
    schema: { querystring: UsageQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const all = await loadKeys(app.clawmind.dataDir);
      const owned = all.find((k) => k.id === req.params.id && k.userId === req.user!.id);
      if (!owned) return reply.code(404).send({ error: 'not found' });
      const report = await getUsageReport(app.clawmind.dataDir, req.params.id, {
        recent: req.query.recent,
        routes: req.query.routes,
      });
      return report;
    },
  });

  // Rotate a key in place. Issues a fresh secret on the same id, keeping
  // label/role/scopes/expiry. The previous secret keeps working for a short
  // grace window so callers can swap credentials without an outage.
  app.post<{ Params: { id: string } }>('/keys/:id/rotate', {
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const rotated = await rotateKey(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!rotated) return reply.code(404).send({ error: 'not found or not rotatable' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'api_key.rotate',
        resource: rotated.record.id,
        meta: { previousHashExpiresAt: rotated.previousExpiresAt },
      });
      return {
        key: redact(rotated.record),
        secret: rotated.secret,
        previousExpiresAt: rotated.previousExpiresAt,
      };
    },
  });
};
