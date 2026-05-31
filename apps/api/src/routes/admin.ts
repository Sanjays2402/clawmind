import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Scopes } from '../scopes.js';
import { listKeys } from '../services/api-keys.js';
import { listForUser as listSessions } from '../services/sessions.js';
import { listForUser as listWebhooks, listDeliveries } from '../services/webhooks.js';
import { loadMfa } from '../services/mfa.js';
import { getRecord as getIpAllowlist } from '../services/ip-allowlist.js';
import { getPolicy as getRetention } from '../services/retention.js';
import { settingsFromEnv as oidcSettingsFromEnv, isConfigured as oidcIsConfigured } from '../services/oidc.js';
import { getFreeze } from '../services/workspace-freeze.js';

// Unified admin console aggregator. Exposed at GET /v1/admin/overview.
//
// Enterprise security reviewers ask "show me the one screen where I can
// see what controls are live on this tenant" and walking eight separate
// settings pages is exactly the failure mode they reject. This endpoint
// is the single source of truth that the /admin web page renders.
//
// It owner-gates the same way audit and lifecycle do, requires the
// admin:read scope so a narrow automation key cannot quietly enumerate
// the tenant's security posture, and self-logs every fetch into the
// audit chain so a regulator can prove the console was reviewed.
//
// Every field in the response answers a yes/no question a procurement
// checklist asks: is MFA on, is SSO enforced, is the IP allowlist
// enabled, how many active sessions, how many live API keys, how many
// webhooks failing, what is the retention policy. No counts are
// estimated; all come from the same services the dedicated routes use,
// so the overview cannot drift away from reality.

const overviewSchema = z.object({
  user: z.object({
    id: z.string(),
    role: z.string(),
  }),
  mfa: z.object({
    enrolled: z.boolean(),
    confirmed: z.boolean(),
    recoveryCodes: z.number().int().nonnegative(),
  }),
  sso: z.object({
    configured: z.boolean(),
    issuer: z.string().nullable(),
    clientId: z.string().nullable(),
    allowedDomains: z.array(z.string()),
  }),
  sessions: z.object({
    active: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative().nullable(),
  }),
  apiKeys: z.object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    revoked: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().nullable(),
  }),
  webhooks: z.object({
    configured: z.number().int().nonnegative(),
    deliveriesRecent: z.number().int().nonnegative(),
    failuresRecent: z.number().int().nonnegative(),
    lastDeliveryAt: z.number().int().nonnegative().nullable(),
  }),
  ipAllowlist: z.object({
    enabled: z.boolean(),
    rules: z.number().int().nonnegative(),
  }),
  retention: z.object({
    historyDays: z.number().int().nullable(),
    conversationDays: z.number().int().nullable(),
    auditDays: z.number().int().nullable(),
    lastSweepAt: z.number().int().nonnegative().nullable(),
  }),
  audit: z.object({
    headHash: z.string().nullable(),
    verified: z.boolean(),
    recentEvents: z.number().int().nonnegative(),
  }),
  workspaceFreeze: z.object({
    active: z.boolean(),
    frozenAt: z.number().int().nonnegative().nullable(),
    ticket: z.string().nullable(),
    reason: z.string().nullable(),
  }),
});

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/admin/overview', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AdminRead),
    ],
    schema: { response: { 200: overviewSchema } },
    handler: async (req) => {
      const userId = req.user!.id;
      const dataDir = app.clawmind.dataDir;
      const env = app.clawmind.env;
      const sid = (req.session as unknown as { sessionId?: string }).sessionId;
      const now = Date.now();
      const since = now - RECENT_WINDOW_MS;

      const [mfaRec, sessions, keys, hooks, deliveries, ip, retention, audit, freeze] = await Promise.all([
        loadMfa(dataDir, userId),
        listSessions(dataDir, userId, sid),
        listKeys(dataDir, userId),
        listWebhooks(dataDir, userId),
        listDeliveries(dataDir, userId, undefined, 500),
        getIpAllowlist(dataDir, userId),
        getRetention(dataDir, userId),
        app.clawmind.audit.query({ since, limit: 1 }).catch(() => ({ total: 0, events: [] })),
        getFreeze(dataDir),
      ]);

      const ssoSettings = oidcSettingsFromEnv(env as unknown as Parameters<typeof oidcSettingsFromEnv>[0]);
      const ssoOn = oidcIsConfigured(ssoSettings);

      const activeSessions = sessions.filter((s) => !s.revokedAt);
      const lastSeenAt = activeSessions.reduce<number | null>(
        (acc, s) => (acc === null || s.lastSeenAt > acc ? s.lastSeenAt : acc),
        null,
      );

      const activeKeys = keys.filter((k) => !k.revokedAt);
      const lastUsedAt = keys.reduce<number | null>(
        (acc, k) => (k.lastUsedAt && (acc === null || k.lastUsedAt > acc) ? k.lastUsedAt : acc),
        null,
      );

      const recentDeliveries = deliveries.filter((d) => d.ts >= since);
      const failures = recentDeliveries.filter((d) => !d.ok).length;
      const lastDeliveryAt = deliveries.length > 0 ? deliveries[0]!.ts : null;

      const verify = await app.clawmind.audit.verify().catch(() => ({ ok: false, headHash: null as string | null }));

      const result = {
        user: { id: userId, role: req.user!.role },
        mfa: {
          enrolled: Boolean(mfaRec),
          confirmed: Boolean(mfaRec?.confirmedAt),
          recoveryCodes: mfaRec?.recoveryHashes.length ?? 0,
        },
        sso: {
          configured: ssoOn,
          issuer: ssoOn ? ssoSettings!.issuer : null,
          clientId: ssoOn ? ssoSettings!.clientId : null,
          allowedDomains: ssoOn ? ssoSettings!.allowedDomains : [],
        },
        sessions: {
          active: activeSessions.length,
          lastSeenAt,
        },
        apiKeys: {
          total: keys.length,
          active: activeKeys.length,
          revoked: keys.length - activeKeys.length,
          lastUsedAt,
        },
        webhooks: {
          configured: hooks.length,
          deliveriesRecent: recentDeliveries.length,
          failuresRecent: failures,
          lastDeliveryAt,
        },
        ipAllowlist: {
          enabled: ip.enabled,
          rules: ip.rules.length,
        },
        retention: {
          historyDays: retention.historyDays,
          conversationDays: retention.conversationDays,
          auditDays: retention.auditDays,
          lastSweepAt: retention.lastSweepAt,
        },
        audit: {
          headHash: verify.headHash ?? null,
          verified: verify.ok,
          recentEvents: audit.total,
        },
        workspaceFreeze: {
          active: freeze.active,
          frozenAt: freeze.frozenAt,
          ticket: freeze.ticket,
          reason: freeze.reason,
        },
      };

      await app.clawmind.audit.write({
        actor: userId,
        action: 'admin.overview',
        resource: '/v1/admin/overview',
        meta: {
          activeSessions: result.sessions.active,
          activeKeys: result.apiKeys.active,
          webhookFailuresRecent: result.webhooks.failuresRecent,
          ssoConfigured: result.sso.configured,
          mfaEnrolled: result.mfa.enrolled,
          ipAllowlistEnabled: result.ipAllowlist.enabled,
          workspaceFrozen: result.workspaceFreeze.active,
        },
      });

      return result;
    },
  });
};
