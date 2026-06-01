import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { issueKey, listKeys, revokeKey, rotateKey, redact, SCOPE_RE, WILDCARD_SCOPE, loadKeys, setKeyRateLimit, MIN_RATE_MAX, MAX_RATE_MAX, MIN_RATE_WINDOW_MS, MAX_RATE_WINDOW_MS, setKeyAllowedIps, normaliseKeyIpRules, MAX_KEY_IP_RULES, setKeyAllowedOrigins, normaliseKeyOriginRules, MAX_KEY_ORIGIN_RULES, MAX_ORIGIN_LENGTH } from '../services/api-keys.js';
import { getUsageReport, purgeUsage } from '../services/api-key-usage.js';
import { Scopes, KNOWN_SCOPES } from '../scopes.js';
import { completeStep as completeOnboardingStep } from '../services/onboarding.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';
import {
  getPolicyCached as getApiKeyPolicy,
  evaluateIssue as evaluateApiKeyIssue,
  needsRotation as keyNeedsRotation,
} from '../services/api-key-policy.js';
import {
  getPolicyCached as getInactivityPolicy,
  classifyKey as classifyKeyInactivity,
} from '../services/api-key-inactivity.js';

const UsageQuery = z.object({
  recent: z.coerce.number().int().positive().max(200).optional(),
  routes: z.coerce.number().int().positive().max(50).optional(),
  // Forensic IP aggregation cap. Bounded so a polling UI cannot ask for
  // an unbounded scan of the per-key log.
  ips: z.coerce.number().int().positive().max(50).optional(),
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
      const policy = await getApiKeyPolicy(app.clawmind.dataDir);
      const inactivity = await getInactivityPolicy(app.clawmind.dataDir);
      const now = Date.now();
      // Annotate each key with whether the workspace rotation policy
      // says it is overdue. The list is the canonical surface admins
      // see so they can act before an auditor flags it. The inactivity
      // status field surfaces the same warning for the dormant-key
      // sweep policy so the admin UI does not need a separate fetch.
      const items = keys.map((k) => {
        const c = classifyKeyInactivity(inactivity, k, now);
        return {
          ...redact(k),
          needsRotation: keyNeedsRotation(policy, k, now),
          inactivity: {
            status: c.status,
            ageDays: c.ageDays,
            willRevokeAt: c.willRevokeAt,
          },
        };
      });
      return {
        items,
        policy: { forcedRotationDays: policy.forcedRotationDays },
        inactivity: {
          idleDays: inactivity.idleDays,
          warnDays: inactivity.warnDays,
          lastSweepAt: inactivity.lastSweepAt,
        },
      };
    },
  });

  app.post('/keys', {
    schema: { body: IssueBody },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      // Workspace-wide issuance policy: cap TTL, cap active key count,
      // forbid wildcard scopes, etc. Enforced here BEFORE the secret is
      // minted so a rejected request leaves no credential in the store.
      const policy = await getApiKeyPolicy(app.clawmind.dataDir);
      const existing = await listKeys(app.clawmind.dataDir, req.user!.id);
      const now = Date.now();
      const activeKeyCount = existing.filter((k) => {
        if (k.revokedAt) return false;
        if (k.expiresAt && k.expiresAt <= now) return false;
        return true;
      }).length;
      const verdict = evaluateApiKeyIssue(policy, {
        ttlMs: req.body.ttlMs ?? null,
        scopes: req.body.scopes,
        activeKeyCount,
      });
      if (!verdict.ok) {
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'api_key.issue.denied',
          resource: 'policy',
          meta: { reason: verdict.reason, field: verdict.field, limit: verdict.limit ?? null },
        });
        return reply.code(409).send({
          error: 'workspace_policy',
          reason: verdict.reason,
          field: verdict.field,
          limit: verdict.limit ?? null,
          message: verdict.message,
        });
      }
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

  app.delete<{ Params: { id: string }; Querystring: { dry_run?: string } }>('/keys/:id', {
    schema: { querystring: DryRunQuery },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const dryRun = isDryRun(req.query.dry_run);
      const all = await loadKeys(app.clawmind.dataDir);
      const owned = all.find((k) => k.id === req.params.id && k.userId === req.user!.id);
      if (!owned) return reply.code(404).send({ error: 'not found' });
      if (dryRun) {
        await app.clawmind.audit.write({
          actor: req.user!.id, action: auditAction('api_key.revoke', true), resource: req.params.id,
          meta: { dryRun: true, label: owned.label, role: owned.role, scopes: owned.scopes ?? null },
        });
        return { dryRun: true, id: req.params.id, wouldRevoke: true, key: redact(owned) };
      }
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
        ips: req.query.ips,
      });
      return report;
    },
  });

  // Rotate a key in place. Issues a fresh secret on the same id, keeping
  // label/role/scopes/expiry. The previous secret keeps working for a short
  // grace window so callers can swap credentials without an outage.
  app.post<{ Params: { id: string } }>('/keys/:id/rotate', {
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
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

  // Set or clear the per-key custom rate limit. Pass { rateLimit: { max, windowMs } }
  // to enforce a stricter ceiling than the global limiter, or { rateLimit: null }
  // (or omit) to remove the limit. Audited.
  app.put<{ Params: { id: string }; Body: { rateLimit?: { max: number; windowMs: number } | null } }>('/keys/:id/rate-limit', {
    schema: {
      body: z.object({
        rateLimit: z.object({
          max: z.number().int().min(MIN_RATE_MAX).max(MAX_RATE_MAX),
          windowMs: z.number().int().min(MIN_RATE_WINDOW_MS).max(MAX_RATE_WINDOW_MS),
        }).nullable().optional(),
      }),
    },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const limit = req.body.rateLimit ?? null;
      const updated = await setKeyRateLimit(app.clawmind.dataDir, req.user!.id, req.params.id, limit);
      if (!updated) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: limit ? 'api_key.rate_limit.set' : 'api_key.rate_limit.clear',
        resource: req.params.id,
        meta: limit ? { max: limit.max, windowMs: limit.windowMs } : {},
      });
      return { key: redact(updated) };
    },
  });

  // Set or clear the per-key IP allowlist. The list is a small array of
  // IPv4/IPv6 addresses or CIDR blocks. An empty list (or null) removes
  // the restriction. Audited on every change so an admin can prove who
  // narrowed or widened a credential's blast radius.
  app.put<{ Params: { id: string }; Body: { allowedIps?: string[] | null } }>('/keys/:id/ip-allowlist', {
    schema: {
      body: z.object({
        allowedIps: z.array(z.string().min(1).max(64)).max(MAX_KEY_IP_RULES).nullable().optional(),
      }),
    },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const raw = req.body.allowedIps ?? null;
      const v = normaliseKeyIpRules(raw);
      if (!v.ok) {
        return reply.code(400).send({
          error: 'invalid ip allowlist',
          message: v.message,
          index: v.index,
        });
      }
      const normalised = v.rules ?? [];
      const updated = await setKeyAllowedIps(
        app.clawmind.dataDir,
        req.user!.id,
        req.params.id,
        normalised.length > 0 ? normalised : null,
      );
      if (!updated) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: normalised.length > 0 ? 'api_key.ip_allowlist.set' : 'api_key.ip_allowlist.clear',
        resource: req.params.id,
        meta: { count: normalised.length, rules: normalised },
      });
      return { key: redact(updated) };
    },
  });

  // Set or clear the per-key Origin allowlist. Useful when a key is
  // deliberately embedded in a first-party browser bundle: server-to-server
  // callers (which omit Origin) keep working unchanged, but a stolen key
  // replayed from a different web origin is rejected with 403. Each entry
  // must be a bare scheme+host[:port] origin; wildcards are intentionally
  // not supported. Audited on every change.
  app.put<{ Params: { id: string }; Body: { allowedOrigins?: string[] | null } }>('/keys/:id/origin-allowlist', {
    schema: {
      body: z.object({
        allowedOrigins: z
          .array(z.string().min(1).max(MAX_ORIGIN_LENGTH))
          .max(MAX_KEY_ORIGIN_RULES)
          .nullable()
          .optional(),
      }),
    },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const raw = req.body.allowedOrigins ?? null;
      const v = normaliseKeyOriginRules(raw);
      if (!v.ok) {
        return reply.code(400).send({
          error: 'invalid origin allowlist',
          message: v.message,
          index: v.index,
        });
      }
      const normalised = v.rules ?? [];
      const updated = await setKeyAllowedOrigins(
        app.clawmind.dataDir,
        req.user!.id,
        req.params.id,
        normalised.length > 0 ? normalised : null,
      );
      if (!updated) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: normalised.length > 0 ? 'api_key.origin_allowlist.set' : 'api_key.origin_allowlist.clear',
        resource: req.params.id,
        meta: { count: normalised.length, origins: normalised },
      });
      return { key: redact(updated) };
    },
  });
};
