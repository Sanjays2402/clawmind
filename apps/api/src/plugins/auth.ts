import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { verifySecret, hasScope, ipAllowedByKey, originAllowedByKey, withinAllowedHours, methodAllowedByKey } from '../services/api-keys.js';
import { recordIncident as recordHoneytokenIncident } from '../services/api-key-honeytokens.js';
import { recordUsage, normaliseUa } from '../services/api-key-usage.js';
import { consume as consumeKeyBucket } from '../services/api-key-rate-limit.js';
import {
  status as bruteforceStatus,
  recordFailure as bruteforceRecordFailure,
  recordSuccess as bruteforceRecordSuccess,
} from '../services/api-key-bruteforce.js';
import { applyRateLimitHeaders } from '../services/rate-headers.js';
import { recordLogin, touch as touchSession, isRevoked as sessionIsRevoked, removeBySid, getBySid as getSessionBySid, revokeBySid as revokeSessionBySid } from '../services/sessions.js';
import { recordSignIn } from '../services/sign-in-log.js';
import { detectAndRecord as detectSignInAnomaly, resolveCountry as resolveSignInCountry } from '../services/sign-in-anomalies.js';
import { getRecord as getGeofenceRecord, evaluate as evaluateGeofence } from '../services/sign-in-geofence.js';
import { getPolicyCached as getSessionPolicyCached, evaluateSession as evaluateSessionPolicy } from '../services/session-policy.js';
import { getPolicyCached as getApiKeyPolicyCached, evaluateRotation as evaluateApiKeyRotation } from '../services/api-key-policy.js';
import { getPolicyCached as getApiKeyExpiryPolicyCached, classifyKey as classifyKeyExpiry } from '../services/api-key-expiry.js';
import { touchExpiryWarning } from '../services/api-keys.js';
import { getStatus as getMfaStatus } from '../services/mfa.js';
import { verifyCookie as verifyTrustedDeviceCookie, TRUSTED_DEVICE_COOKIE } from '../services/mfa-trusted-devices.js';
import {
  recordSeenAndBootstrap,
  meetsMinRole,
  type MemberRole,
} from '../services/members.js';
import { resolveDefaultRoleByEmail, isSsoRequiredForEmail } from '../services/domain-policies.js';
import { getActiveGrant as getActiveElevation } from '../services/role-elevation.js';
import {
  settingsFromEnv as oidcSettingsFromEnv,
  isConfigured as oidcIsConfigured,
  discover as oidcDiscover,
  buildAuthorizationRequest as oidcAuthRequest,
  completeLogin as oidcCompleteLogin,
  constantTimeStringEqual,
  type OidcSettings,
} from '../services/oidc.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      github: string | null;
      role: 'owner' | 'admin' | 'member' | 'viewer' | 'reader';
      via?: 'session' | 'api-key';
      apiKeyId?: string;
      scopes?: string[] | null;
      email?: string | null;
    };
    elevation?: {
      id: string;
      fromRole: MemberRole;
      toRole: MemberRole;
      expiresAt: number;
    };
  }
  interface Session {
    userId?: string;
    github?: string;
    email?: string;
    oidcState?: string;
    oidcNonce?: string;
    oidcReturnTo?: string;
    mfaVerifiedAt?: number;
    // Which login flow produced this session: 'oidc' | 'github' | 'single-user'.
    // Read by the auth preHandler to enforce per-domain require-SSO policies.
    authMethod?: string;
  }
}

// Role hierarchy used by the elevation overlay. Owners outrank admins
// outrank members outrank viewers. Matches services/members.ts so a
// future role addition only needs one constant updated.
const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
};

const plugin: FastifyPluginAsync = async (app) => {
  const env = app.clawmind.env;

  // Per-request timing for the api-key usage log. We stash the start on the
  // request and record once the response is sent so the hot path stays a
  // single Bearer verify; aggregation happens off the critical path.
  const startTimes = new WeakMap<FastifyRequest, number>();

  app.addHook('onRequest', async (req) => {
    startTimes.set(req, Date.now());
  });

  app.addHook('onResponse', async (req, reply) => {
    if (!req.user || req.user.via !== 'api-key' || !req.user.apiKeyId) return;
    const started = startTimes.get(req) ?? Date.now();
    const route = req.routeOptions?.url ?? (req as unknown as { routerPath?: string }).routerPath ?? req.url;
    // Skip the usage endpoint itself so polling does not flood the log.
    if (typeof route === 'string' && route.endsWith('/keys/:id/usage')) return;
    void recordUsage(app.clawmind.dataDir, req.user.apiKeyId, {
      ts: started,
      route: typeof route === 'string' ? route : req.url,
      method: req.method,
      status: reply.statusCode,
      ms: Math.max(0, Date.now() - started),
      // Forensic context. req.ip respects the trust-proxy configuration so
      // a customer behind a CDN sees the original client IP, not the edge.
      // The UA is truncated to a sane upper bound inside normaliseUa to
      // keep the per-key jsonl file from being pumped by a hostile header.
      ip: req.ip,
      ua: normaliseUa(req.headers['user-agent']),
    });
  });

  app.addHook('preHandler', async (req, reply) => {
    // 1) Bearer API key wins when present so automation can be scoped
    //    independently of the human session cookie.
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const presented = auth.slice('Bearer '.length).trim();
      // Brute-force gate. If this source IP has tripped the failed-Bearer
      // threshold we 429 the request without ever calling verifySecret, so
      // an attacker cannot keep probing for a valid key from a fixed IP.
      const bf = bruteforceStatus(req.ip);
      if (bf.locked) {
        const retrySec = Math.max(1, Math.ceil((bf.lockedUntil - Date.now()) / 1000));
        applyRateLimitHeaders(reply, {
          limit: bf.maxFails,
          remaining: 0,
          resetMs: bf.lockedUntil,
          windowSec: Math.max(1, Math.round(bf.windowMs / 1000)),
          policy: 'api-key-bruteforce',
        });
        reply.header('retry-after', String(retrySec));
        return reply.code(429).send({
          error: 'too many failed api key attempts',
          scope: 'api-key-bruteforce',
          ip: req.ip,
          resetAt: new Date(bf.lockedUntil).toISOString(),
        });
      }
      const result = await verifySecret(app.clawmind.dataDir, presented);
      if (!result.ok) {
        const outcome = await bruteforceRecordFailure(
          app.clawmind.dataDir,
          req.ip,
          result.reason,
        );
        if (outcome.lockedNow) {
          void app.clawmind.audit.write({
            actor: 'system',
            action: 'api_key.bruteforce.lock',
            resource: req.ip,
            meta: {
              ip: req.ip,
              reason: result.reason,
              recent: outcome.status.recent,
              lockedUntil: outcome.status.lockedUntil,
              route: req.url,
            },
          }).catch(() => undefined);
        }
      } else {
        bruteforceRecordSuccess(req.ip);
      }
      if (result.ok) {
        // Honeytoken trip. The key was minted as a canary, never given
        // to a real caller, and exists purely to detect that an
        // attacker has obtained workspace credentials. We rip the
        // request here, record the incident with full forensic
        // context, and emit an audit event. The 401 response shape is
        // deliberately identical to the unknown-secret case so the
        // attacker cannot distinguish a trap from a stale guess.
        if (result.record.isCanary === true) {
          const ua = req.headers['user-agent'];
          const uaStr = Array.isArray(ua) ? ua[0] : ua;
          await recordHoneytokenIncident(app.clawmind.dataDir, {
            keyId: result.record.id,
            keyLabel: result.record.label,
            note: result.record.canaryNote ?? null,
            ip: req.ip ?? null,
            userAgent: uaStr ?? null,
            route: req.url,
            method: req.method,
            requestId: req.id,
          }).catch(() => undefined);
          await app.clawmind.audit.write({
            actor: 'system',
            action: 'api_key.honeytoken.tripped',
            resource: result.record.id,
            meta: {
              ip: req.ip,
              route: req.url,
              method: req.method,
              userAgent: uaStr ?? null,
              label: result.record.label,
              requestId: req.id,
            },
          }).catch(() => undefined);
          return reply.code(401).send({ error: 'invalid api key' });
        }
        // Workspace forced-rotation enforcement. When the owner has set
        // forcedRotationDays > 0, any key whose age (since creation or
        // last rotation) exceeds that cap is rejected here, before the
        // request can touch tenant data. The auditor's question ("can
        // an over-age key still transact?") then has a single-line
        // answer. The X-API-Key-* headers tell SDKs what to do without
        // re-reading the policy endpoint.
        try {
          const apiKeyPolicy = await getApiKeyPolicyCached(app.clawmind.dataDir);
          const rot = evaluateApiKeyRotation(
            apiKeyPolicy,
            { createdAt: result.record.createdAt, rotatedAt: result.record.rotatedAt ?? null },
            Date.now(),
          );
          if (!rot.ok) {
            void app.clawmind.audit.write({
              actor: result.record.userId,
              action: 'api_key.rotation.denied',
              resource: result.record.id,
              meta: {
                ip: req.ip,
                route: req.url,
                ageDays: rot.ageDays,
                maxAgeDays: rot.maxAgeDays,
                requestId: req.id,
              },
            }).catch(() => undefined);
            reply.header('x-api-key-rotation-required', '1');
            reply.header('x-api-key-age-days', String(rot.ageDays));
            reply.header('x-api-key-max-age-days', String(rot.maxAgeDays));
            return reply.code(401).send({
              error: 'api key rotation required',
              reason: 'rotation-required',
              ageDays: rot.ageDays,
              maxAgeDays: rot.maxAgeDays,
              hint: 'POST /v1/keys/:id/rotate to mint a fresh secret',
            });
          }
        } catch {
          // Fail-open on transient policy-store errors so a corrupt
          // policy file does not lock every automation out. The doctor
          // route surfaces the broken file separately.
        }
        // Pre-activation gate. A key with a future notBefore was minted
        // ahead of a scheduled go-live and must refuse to transact until
        // wall-clock time crosses that moment. Surfaced with a 401, a
        // structured reason, and the activation timestamp so SDKs can
        // surface a clean error or schedule a retry without polling.
        if (
          result.record.notBefore != null &&
          result.record.notBefore > Date.now()
        ) {
          const nb = result.record.notBefore;
          const iso = new Date(nb).toISOString();
          await app.clawmind.audit.write({
            actor: result.record.userId,
            action: 'api_key.not_yet_active.denied',
            resource: result.record.id,
            meta: {
              ip: req.ip,
              route: req.url,
              notBefore: iso,
              waitSeconds: Math.max(0, Math.ceil((nb - Date.now()) / 1000)),
              requestId: req.id,
            },
          }).catch(() => undefined);
          reply.header('X-API-Key-Not-Before', iso);
          reply.header(
            'retry-after',
            String(Math.max(1, Math.ceil((nb - Date.now()) / 1000))),
          );
          return reply.code(401).send({
            error: 'api key not yet active',
            reason: 'not_yet_active',
            notBefore: iso,
            waitSeconds: Math.max(0, Math.ceil((nb - Date.now()) / 1000)),
          });
        }
        // Per-key IP allowlist. Reject before issuing usage credit so a
        // probing client cannot map the key's scope set from outside its
        // permitted range. The workspace-level allowlist (if any) is
        // enforced separately by the ip-allowlist plugin.
        if (result.record.allowedIps && result.record.allowedIps.length > 0) {
          if (!ipAllowedByKey(req.ip, result.record.allowedIps)) {
            await app.clawmind.audit.write({
              actor: result.record.userId,
              action: 'api_key.ip.denied',
              resource: result.record.id,
              meta: { ip: req.ip, route: req.url, rules: result.record.allowedIps.length },
            }).catch(() => undefined);
            return reply.code(403).send({
              error: 'ip not allowed for this key',
              ip: req.ip,
            });
          }
        }
        // Per-key Origin allowlist. Only applies when the request actually
        // carries an Origin header (i.e. it is a browser fetch). This lets
        // a customer embed an API key in a first-party web page without
        // worrying that a stolen credential can be replayed from a
        // different origin.
        if (result.record.allowedOrigins && result.record.allowedOrigins.length > 0) {
          const origin = req.headers.origin;
          const originStr = Array.isArray(origin) ? origin[0] : origin;
          if (!originAllowedByKey(originStr, result.record.allowedOrigins)) {
            await app.clawmind.audit.write({
              actor: result.record.userId,
              action: 'api_key.origin.denied',
              resource: result.record.id,
              meta: {
                origin: originStr ?? null,
                route: req.url,
                rules: result.record.allowedOrigins.length,
              },
            }).catch(() => undefined);
            return reply.code(403).send({
              error: 'origin not allowed for this key',
              origin: originStr ?? null,
            });
          }
        }
        // Per-key time-of-day window. Reject before issuing usage credit
        // so a probing client outside business hours cannot map scopes.
        if (result.record.allowedHours && result.record.allowedHours.windows?.length) {
          if (!withinAllowedHours(result.record.allowedHours)) {
            await app.clawmind.audit.write({
              actor: result.record.userId,
              action: 'api_key.hours.denied',
              resource: result.record.id,
              meta: {
                tz: result.record.allowedHours.tz,
                windows: result.record.allowedHours.windows.length,
                route: req.url,
              },
            }).catch(() => undefined);
            return reply.code(403).send({
              error: 'request outside allowed-hours window for this key',
              tz: result.record.allowedHours.tz,
            });
          }
        }
        // Per-key HTTP method allowlist. Wire-level read-only enforcement:
        // a key restricted to ['GET','HEAD'] is rejected on any mutating
        // verb regardless of its resource scopes. Audited so an admin can
        // see exactly which verb was blocked and from where.
        if (result.record.allowedMethods && result.record.allowedMethods.length > 0) {
          if (!methodAllowedByKey(req.method, result.record.allowedMethods)) {
            await app.clawmind.audit.write({
              actor: result.record.userId,
              action: 'api_key.method.denied',
              resource: result.record.id,
              meta: {
                method: req.method,
                route: req.url,
                allowed: result.record.allowedMethods,
              },
            }).catch(() => undefined);
            reply.header('Allow', result.record.allowedMethods.join(', '));
            return reply.code(405).send({
              error: 'method not allowed for this key',
              method: req.method,
              allowedMethods: result.record.allowedMethods,
            });
          }
        }
        req.user = {
          id: result.record.userId,
          github: null,
          role: result.record.role,
          via: 'api-key',
          apiKeyId: result.record.id,
          scopes: result.record.scopes ?? null,
        };
        // Per-key custom rate limit (when configured). Emits standard
        // X-RateLimit-* and Retry-After headers so SDKs back off correctly.
        if (result.record.rateLimit) {
          const snap = consumeKeyBucket(result.record.id, result.record.rateLimit);
          applyRateLimitHeaders(reply, {
            limit: snap.limit,
            remaining: snap.remaining,
            resetMs: snap.resetMs,
            windowSec: Math.max(1, Math.round(snap.windowMs / 1000)),
            policy: 'api-key',
          });
          if (!snap.allowed) {
            void app.clawmind.audit.write({
              actor: result.record.userId,
              action: 'rate_limit.denied',
              resource: result.record.id,
              meta: { scope: 'api-key', limit: snap.limit, windowMs: snap.windowMs, route: req.url },
            }).catch(() => undefined);
            return reply.code(429).send({
              error: 'rate limit exceeded',
              scope: 'api-key',
              limit: snap.limit,
              windowMs: snap.windowMs,
              resetAt: new Date(snap.resetMs).toISOString(),
            });
          }
        }
        // Upcoming-expiry warning. When the workspace policy is enabled
        // and this key is inside the warning window, advertise the
        // remaining lifetime so SDKs can rotate before the credential
        // dies. Standard RFC 7234 Warning header plus two custom
        // headers for machine consumption. First crossing into the
        // window writes one audit entry; subsequent requests are silent
        // until expiresAt changes (handled by touchExpiryWarning).
        if (result.record.expiresAt) {
          try {
            const expiryPolicy = await getApiKeyExpiryPolicyCached(app.clawmind.dataDir);
            const cls = classifyKeyExpiry(expiryPolicy, result.record, Date.now());
            if (cls.status === 'expiring' && cls.expiresAt !== null && cls.daysRemaining !== null) {
              const days = cls.daysRemaining;
              reply.header('X-ClawMind-Api-Key-Expires-At', new Date(cls.expiresAt).toISOString());
              reply.header('X-ClawMind-Api-Key-Expires-In-Days', String(days));
              const unit = days === 1 ? 'day' : 'days';
              reply.header('Warning', `299 - "API key expires in ${days} ${unit}"`);
              const wrote = await touchExpiryWarning(
                app.clawmind.dataDir,
                result.record.id,
                cls.expiresAt,
              );
              if (wrote) {
                void app.clawmind.audit.write({
                  actor: result.record.userId,
                  action: 'api-key.expiry_warned',
                  resource: result.record.id,
                  meta: {
                    daysRemaining: days,
                    expiresAt: new Date(cls.expiresAt).toISOString(),
                    warnDays: expiryPolicy.warnDays,
                    route: req.url,
                  },
                }).catch(() => undefined);
              }
            }
          } catch {
            // Expiry warnings are best-effort. A disk hiccup must not
            // block an otherwise valid authenticated request.
          }
        }
        return;
      }
    }
    if (env.CLAWMIND_AUTH_MODE === 'single-user') {
      req.user = { id: 'local', github: null, role: 'owner', via: 'session' };
      try {
        await recordSeenAndBootstrap(app.clawmind.dataDir, { userId: 'local' });
      } catch {
        // Registry write failure must not lock the local-mode user out.
      }
      return;
    }
    if (req.session.userId) {
      // Per-domain require-SSO enforcement. If an enabled domain policy
      // marks this user's email as SSO-only, any session NOT established
      // through OIDC is rejected on the next request. This is what lets
      // an owner say "everyone @acme.com must use Okta" and have password
      // or GitHub sessions stop working the moment that flag flips. We
      // tear the session down before any user-data hooks run so a stolen
      // GitHub cookie cannot be used to read tenant data once the policy
      // is in place.
      const sessionEmail = req.session.email ?? null;
      const authMethod = req.session.authMethod;
      if (sessionEmail && authMethod && authMethod !== 'oidc') {
        try {
          if (await isSsoRequiredForEmail(app.clawmind.dataDir, sessionEmail)) {
            const sid = (req.session as unknown as { sessionId?: string }).sessionId;
            await app.clawmind.audit.write({
              actor: req.session.userId,
              action: 'sso.enforcement.denied',
              resource: req.url,
              meta: {
                email: sessionEmail,
                authMethod,
                ip: req.ip,
                sid: sid ?? null,
              },
            }).catch(() => undefined);
            await req.session.destroy();
            return reply.code(401).send({
              error: 'sso required',
              message: 'Your workspace requires SSO. Sign in via /auth/oidc.',
            });
          }
        } catch {
          // Fail-open on transient disk errors so a corrupt policy file
          // does not lock everyone out. The audit log will still surface
          // the broken policy file via the doctor route.
        }
      }
      // Reject session cookies whose sid has been revoked by the user from
      // the active-sessions UI. Without this check, a stolen laptop would
      // still be authenticated until the cookie naturally expired.
      const sid = (req.session as unknown as { sessionId?: string }).sessionId;
      if (sid) {
        try {
          if (await sessionIsRevoked(app.clawmind.dataDir, sid)) {
            await req.session.destroy();
            return reply.code(401).send({ error: 'session revoked' });
          }
          // Workspace session-lifetime policy. If the owner has set a
          // maximum lifetime or idle timeout, evaluate the registry
          // record for this sid against the policy. A session that has
          // aged out is permanently revoked (not just signed out for
          // this one request) so the cookie cannot be replayed.
          const policy = await getSessionPolicyCached(app.clawmind.dataDir);
          if (policy.maxLifetimeMinutes > 0 || policy.idleTimeoutMinutes > 0) {
            const rec = await getSessionBySid(app.clawmind.dataDir, sid).catch(() => null);
            if (rec && !rec.revokedAt) {
              const decision = evaluateSessionPolicy(
                policy,
                { createdAt: rec.createdAt, lastSeenAt: rec.lastSeenAt },
                Date.now(),
              );
              if (!decision.ok) {
                await revokeSessionBySid(app.clawmind.dataDir, sid).catch(() => undefined);
                await app.clawmind.audit.write({
                  actor: rec.userId,
                  action: 'session.policy.expired',
                  resource: req.url,
                  meta: {
                    reason: decision.reason,
                    limitMinutes: decision.limitMinutes,
                    ageMinutes: decision.ageMinutes,
                    ip: req.ip,
                    requestId: req.id,
                  },
                }).catch(() => undefined);
                await req.session.destroy();
                return reply.code(401).send({
                  error: 'session expired',
                  reason: decision.reason,
                  limitMinutes: decision.limitMinutes,
                });
              }
            }
          }
          // Best-effort last-seen update; never block the request on it.
          void touchSession(app.clawmind.dataDir, sid).catch(() => undefined);
        } catch {
          // Registry read failure must not lock the user out; fail open here
          // and let the audit / health channels surface the disk problem.
        }
      }
      // Overlay role from the members registry. The first user to log
      // into a fresh deployment is auto-bootstrapped as owner so the
      // deployment is never role-less; subsequent users default to
      // 'member' and an owner promotes them from the admin UI.
      let resolvedRole: MemberRole = 'owner';
      try {
        // If a domain auto-join policy matches this user's email and they
        // are not already in the registry, the policy role wins over the
        // hard-coded 'member' default. Existing members are untouched
        // because recordSeenAndBootstrap ignores defaultRole when the user
        // is already present.
        const policyRole = await resolveDefaultRoleByEmail(
          app.clawmind.dataDir,
          req.session.email ?? null,
        ).catch(() => null);
        const rec = await recordSeenAndBootstrap(app.clawmind.dataDir, {
          userId: req.session.userId,
          email: req.session.email ?? null,
          label: req.session.github ?? null,
          defaultRole: policyRole ?? undefined,
        });
        resolvedRole = rec.role;
      } catch {
        // Fail-open to the historical default so a transient disk error
        // does not lock a real user out of their own deployment.
        resolvedRole = 'owner';
      }
      req.user = {
        id: req.session.userId,
        github: req.session.github ?? null,
        role: resolvedRole,
        via: 'session',
        email: req.session.email ?? null,
      };
    }

    // Time-bound role elevation overlay (break-glass / JIT privilege).
    // If the authenticated user has an approved, unexpired, unrevoked
    // elevation grant on file, overlay the elevated role on req.user for
    // this request only. Both session and api-key callers are covered.
    // The grant id is stashed on req.elevation so downstream audit
    // entries can be tagged and a procurement reviewer can trace any
    // privileged action back to a specific signed approval.
    if (req.user) {
      try {
        const grant = await getActiveElevation(app.clawmind.dataDir, req.user.id);
        if (grant) {
          // Never weaken: only apply if the grant's role outranks the base.
          const baseRank = ROLE_RANK[(req.user.role === 'reader' ? 'viewer' : req.user.role) as MemberRole];
          const grantRank = ROLE_RANK[grant.toRole];
          if (grantRank > baseRank) {
            (req.user as { role: MemberRole }).role = grant.toRole;
            req.elevation = { id: grant.id, fromRole: grant.fromRole, toRole: grant.toRole, expiresAt: grant.expiresAt ?? 0 };
          }
        }
      } catch {
        // Fail-closed: if the elevation store is unreadable we simply do
        // not apply the overlay; the user keeps their base role. This is
        // the safe direction (no surprise privilege escalation on disk
        // errors) and matches how the IP allowlist plugin handles a
        // missing rules file.
      }
    }
  });

  app.decorate('requireAuth', async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    if (!req.user) {
      reply.code(401).send({ error: 'auth required' });
    }
  });

  app.decorate('requireRole', function requireRole(role: 'owner' | 'reader') {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) return reply.code(401).send({ error: 'auth required' });
      if (role === 'owner' && req.user.role !== 'owner') {
        return reply.code(403).send({ error: 'forbidden' });
      }
    };
  });

  // requireMinRole gates a route on the hierarchical 4-role RBAC model
  // (owner > admin > member > viewer). API-key callers inherit the role
  // of the key's owner, so an unscoped admin key cannot be used to bypass
  // member management gating. Legacy 'reader' is treated as 'viewer'.
  app.decorate('requireMinRole', function requireMinRole(min: MemberRole) {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) return reply.code(401).send({ error: 'auth required' });
      const actual = (req.user.role === 'reader' ? 'viewer' : req.user.role) as MemberRole;
      if (!meetsMinRole(actual, min)) {
        return reply.code(403).send({ error: 'forbidden', requiredRole: min, currentRole: actual });
      }
    };
  });

  // requireMfa gates sensitive routes on a recent TOTP step-up. API-key
  // callers bypass this gate: their authorization is the scope set bound
  // to the key, and we do not have a meaningful place to ask for a code
  // mid-request. Session callers must have enrolled MFA and verified a code
  // within the per-user step-up window. Routes that wire this in are listed
  // in docs/security.md; the audit log records every denied attempt so an
  // admin can spot brute-force or stolen-cookie use.
  app.decorate('requireMfa', async function requireMfa(req: FastifyRequest, reply: FastifyReply) {
    if (!req.user) return reply.code(401).send({ error: 'auth required' });
    if (req.user.via === 'api-key') return; // scope-gated, not MFA-gated
    const status = await getMfaStatus(app.clawmind.dataDir, req.user.id);
    if (!status.confirmed) {
      return reply.code(403).send({
        error: 'mfa required',
        reason: 'not-enrolled',
        enrollUrl: '/settings/mfa',
      });
    }
    const sess = req.session as unknown as { mfaVerifiedAt?: number };
    const verifiedAt = sess.mfaVerifiedAt ?? 0;
    const ageMs = Date.now() - verifiedAt;
    if (verifiedAt === 0 || ageMs > status.stepUpTtlSec * 1000) {
      // Trusted-device fast path: a previously-minted cookie bound to this
      // user satisfies the step-up gate without prompting for a TOTP code.
      // We bind by sha256-hash and prune expired records as a side effect.
      const cookie = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies?.[TRUSTED_DEVICE_COOKIE];
      const trusted = await verifyTrustedDeviceCookie(app.clawmind.dataDir, cookie, { ip: req.ip });
      if (trusted && trusted.userId === req.user.id) {
        sess.mfaVerifiedAt = Date.now();
        reply.header('x-mfa-trusted-device', trusted.device.id);
        return;
      }
      reply.header('x-mfa-required', '1');
      return reply.code(401).send({
        error: 'mfa step-up required',
        reason: 'expired',
        stepUpTtlSec: status.stepUpTtlSec,
      });
    }
  });

  // requireScope gates a route on a 'resource:action' scope. Session users
  // (no scope list) and unscoped API keys pass through unchanged, preserving
  // backwards compatibility. API keys with a scope list must include the
  // requested scope or the wildcard '*'.
  app.decorate('requireScope', function requireScope(scope: string) {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) return reply.code(401).send({ error: 'auth required' });
      if (req.user.via !== 'api-key') return; // session users are unscoped
      if (hasScope(req.user.scopes ?? null, scope)) return;
      return reply.code(403).send({ error: 'scope required', scope });
    };
  });

  // OAuth start
  app.get('/auth/github', async (_req, reply) => {
    if (env.CLAWMIND_AUTH_MODE !== 'github') return reply.code(404).send();
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('redirect_uri', `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}/auth/github/callback`);
    reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string } }>('/auth/github/callback', async (req, reply) => {
    if (env.CLAWMIND_AUTH_MODE !== 'github') return reply.code(404).send();
    const code = req.query.code;
    if (!code) return reply.code(400).send({ error: 'missing code' });
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    }).then((r) => r.json()) as { access_token?: string };
    if (!tokenRes.access_token) {
      await recordSignIn(app.clawmind.dataDir, {
        actor: 'anonymous', method: 'github', outcome: 'failure',
        ip: req.ip, userAgent: req.headers['user-agent'],
        reason: 'oauth token exchange failed',
      }).catch(() => undefined);
      return reply.code(400).send({ error: 'oauth failed' });
    }
    const ghUser = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenRes.access_token}`, accept: 'application/json' },
    }).then((r) => r.json()) as { login: string; id: number };
    const allowed = env.CLAWMIND_ALLOWED_GITHUB_USERS.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(ghUser.login)) {
      await recordSignIn(app.clawmind.dataDir, {
        actor: `gh:${ghUser.login}`, method: 'github', outcome: 'failure',
        ip: req.ip, userAgent: req.headers['user-agent'],
        reason: 'user not on allowlist',
      }).catch(() => undefined);
      return reply.code(403).send({ error: 'not allowed' });
    }
    // Sign-in geofence: workspace owners can require sign-ins to come
    // from a known set of countries (resolved from a trusted upstream
    // header). Evaluated AFTER identity is confirmed so the failure
    // message can attribute the block to a real actor in the audit log.
    {
      const geofence = await getGeofenceRecord(app.clawmind.dataDir).catch(() => null);
      if (geofence) {
        const decision = evaluateGeofence(geofence, req.headers as Record<string, string | string[] | undefined>);
        if (!decision.allowed) {
          const actorId = `gh:${ghUser.id}`;
          await app.clawmind.audit.write({
            actor: actorId,
            action: 'sign-in.geofence.blocked',
            resource: 'github',
            meta: { ip: req.ip, country: decision.country, source: decision.source, reason: decision.reason, mode: geofence.mode, requestId: req.id },
          }).catch(() => undefined);
          await recordSignIn(app.clawmind.dataDir, {
            actor: actorId, method: 'github', outcome: 'failure',
            ip: req.ip, userAgent: req.headers['user-agent'],
            reason: `geofence: ${decision.reason ?? 'blocked'}${decision.country ? ` (${decision.country})` : ''}`,
          }).catch(() => undefined);
          return reply.code(403).send({
            error: 'geofence_blocked',
            reason: decision.reason,
            country: decision.country,
            mode: geofence.mode,
          });
        }
      }
    }
    req.session.userId = `gh:${ghUser.id}`;
    req.session.github = ghUser.login;
    req.session.authMethod = 'github';
    await app.clawmind.audit.write({ actor: req.session.userId, action: 'login', resource: 'github' });
    await recordSignIn(app.clawmind.dataDir, {
      actor: req.session.userId, method: 'github', outcome: 'success',
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => undefined);
    // Impossible-travel check. Always advances the per-actor anchor;
    // when it returns a 'recorded' outcome we also drop an audit row
    // so SIEM ingesters that only follow the audit chain still see it.
    try {
      const country = resolveSignInCountry(req.headers as Record<string, string | string[] | undefined>);
      const outcome = await detectSignInAnomaly(app.clawmind.dataDir, {
        actor: req.session.userId, ip: req.ip, country, at: Date.now(), method: 'github',
      });
      if (outcome.kind === 'recorded') {
        await app.clawmind.audit.write({
          actor: req.session.userId,
          action: 'sign-in.anomaly.detected',
          resource: outcome.record.id,
          meta: {
            requestId: req.id,
            fromCountry: outcome.record.previous.country,
            toCountry: outcome.record.current.country,
            distanceKm: outcome.record.distanceKm,
            elapsedMinutes: outcome.record.elapsedMinutes,
            speedKmh: outcome.record.speedKmh,
            thresholdKmh: outcome.record.thresholdKmh,
          },
        }).catch(() => undefined);
      }
    } catch { /* detection is best-effort; never block sign-in */ }
    const sid = (req.session as unknown as { sessionId?: string }).sessionId;
    if (sid) {
      const policy = await getSessionPolicyCached(app.clawmind.dataDir).catch(() => null);
      const { evicted } = await recordLogin(app.clawmind.dataDir, {
        sid,
        userId: req.session.userId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        maxConcurrent: policy?.maxConcurrentSessions ?? 0,
      });
      for (const e of evicted) {
        await app.clawmind.audit.write({
          actor: req.session.userId,
          action: 'session.evicted.concurrent-cap',
          resource: 'session',
          meta: {
            ip: req.ip,
            requestId: req.id,
            cap: policy?.maxConcurrentSessions ?? 0,
            evictedSessionId: e.sidHash.slice(0, 12),
            evictedUserAgent: e.userAgent,
            evictedIp: e.ip,
          },
        }).catch(() => undefined);
      }
    }
    reply.redirect('/');
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = (req.session as unknown as { sessionId?: string }).sessionId;
    const actor = req.session.userId ?? 'anonymous';
    if (sid) {
      await removeBySid(app.clawmind.dataDir, sid).catch(() => undefined);
    }
    await recordSignIn(app.clawmind.dataDir, {
      actor, method: req.session.authMethod ?? 'session', outcome: 'logout',
      ip: req.ip, userAgent: req.headers['user-agent'],
    }).catch(() => undefined);
    await req.session.destroy();
    reply.send({ ok: true });
  });

  app.get('/auth/me', async (req) => ({ user: req.user ?? null }));

  // ----- OIDC SSO -----
  // /auth/sso/config exposes only non-secret status so the dashboard can
  // render "SSO enforced for example.com" without ever shipping the client
  // secret to the browser. The settings page polls this on load.
  const oidcSettings: OidcSettings | null = oidcSettingsFromEnv(env);
  const oidcEnforced = env.CLAWMIND_AUTH_MODE === 'oidc';

  app.get('/auth/sso/config', async () => ({
    enabled: oidcIsConfigured(oidcSettings),
    enforced: oidcEnforced,
    issuer: oidcSettings?.issuer ?? null,
    clientId: oidcSettings?.clientId ?? null,
    redirectUri: oidcSettings?.redirectUri ?? null,
    allowedDomains: oidcSettings?.allowedDomains ?? [],
    scopes: oidcSettings?.scopes ?? null,
    mode: env.CLAWMIND_AUTH_MODE,
  }));

  app.get<{ Querystring: { return_to?: string } }>('/auth/oidc', async (req, reply) => {
    if (!oidcIsConfigured(oidcSettings)) {
      return reply.code(404).send({ error: 'oidc not configured' });
    }
    let doc;
    try {
      doc = await oidcDiscover(oidcSettings.issuer);
    } catch (err) {
      app.log.error({ err }, 'oidc discovery failed');
      return reply.code(502).send({ error: 'oidc discovery failed' });
    }
    const ar = oidcAuthRequest(oidcSettings, doc);
    req.session.oidcState = ar.state;
    req.session.oidcNonce = ar.nonce;
    // Only honour relative return_to paths so a crafted callback link cannot
    // bounce the user to a malicious origin after login completes.
    const returnTo = typeof req.query.return_to === 'string' ? req.query.return_to : '/';
    req.session.oidcReturnTo = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
    reply.redirect(ar.url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/auth/oidc/callback',
    async (req, reply) => {
      if (!oidcIsConfigured(oidcSettings)) {
        return reply.code(404).send({ error: 'oidc not configured' });
      }
      if (req.query.error) {
        await app.clawmind.audit.write({
          actor: 'anonymous',
          action: 'sso.login.failed',
          resource: 'oidc',
          meta: { reason: req.query.error, description: req.query.error_description },
        });
        return reply.code(400).send({ error: req.query.error, description: req.query.error_description });
      }
      const code = req.query.code;
      const state = req.query.state;
      const expectedState = req.session.oidcState;
      const expectedNonce = req.session.oidcNonce;
      const returnTo = req.session.oidcReturnTo ?? '/';
      // Single-use: clear immediately so a replayed callback link cannot
      // re-establish a session from a leaked URL.
      req.session.oidcState = undefined;
      req.session.oidcNonce = undefined;
      req.session.oidcReturnTo = undefined;
      if (!code || !state || !expectedState || !expectedNonce) {
        return reply.code(400).send({ error: 'missing code or state' });
      }
      if (!constantTimeStringEqual(state, expectedState)) {
        await app.clawmind.audit.write({
          actor: 'anonymous',
          action: 'sso.login.failed',
          resource: 'oidc',
          meta: { reason: 'state mismatch' },
        });
        await recordSignIn(app.clawmind.dataDir, {
          actor: 'anonymous', method: 'oidc', outcome: 'failure',
          ip: req.ip, userAgent: req.headers['user-agent'],
          reason: 'state mismatch',
        }).catch(() => undefined);
        return reply.code(400).send({ error: 'state mismatch' });
      }
      try {
        const result = await oidcCompleteLogin(oidcSettings, code, expectedNonce);
        // Sign-in geofence enforcement; see auth/github branch for rationale.
        {
          const geofence = await getGeofenceRecord(app.clawmind.dataDir).catch(() => null);
          if (geofence) {
            const decision = evaluateGeofence(geofence, req.headers as Record<string, string | string[] | undefined>);
            if (!decision.allowed) {
              await app.clawmind.audit.write({
                actor: result.userId,
                action: 'sign-in.geofence.blocked',
                resource: 'oidc',
                meta: { ip: req.ip, country: decision.country, source: decision.source, reason: decision.reason, mode: geofence.mode, issuer: oidcSettings.issuer, requestId: req.id },
              }).catch(() => undefined);
              await recordSignIn(app.clawmind.dataDir, {
                actor: result.userId, method: 'oidc', outcome: 'failure',
                ip: req.ip, userAgent: req.headers['user-agent'],
                reason: `geofence: ${decision.reason ?? 'blocked'}${decision.country ? ` (${decision.country})` : ''}`,
              }).catch(() => undefined);
              return reply.code(403).send({
                error: 'geofence_blocked',
                reason: decision.reason,
                country: decision.country,
                mode: geofence.mode,
              });
            }
          }
        }
        req.session.userId = result.userId;
        req.session.email = result.email ?? undefined;
        req.session.authMethod = 'oidc';
        await app.clawmind.audit.write({
          actor: result.userId,
          action: 'sso.login',
          resource: 'oidc',
          meta: {
            issuer: oidcSettings.issuer,
            email: result.email,
            emailVerified: result.emailVerified,
          },
        });
        await recordSignIn(app.clawmind.dataDir, {
          actor: result.userId, method: 'oidc', outcome: 'success',
          ip: req.ip, userAgent: req.headers['user-agent'],
        }).catch(() => undefined);
        try {
          const country = resolveSignInCountry(req.headers as Record<string, string | string[] | undefined>);
          const outcome = await detectSignInAnomaly(app.clawmind.dataDir, {
            actor: result.userId, ip: req.ip, country, at: Date.now(), method: 'oidc',
          });
          if (outcome.kind === 'recorded') {
            await app.clawmind.audit.write({
              actor: result.userId,
              action: 'sign-in.anomaly.detected',
              resource: outcome.record.id,
              meta: {
                requestId: req.id,
                fromCountry: outcome.record.previous.country,
                toCountry: outcome.record.current.country,
                distanceKm: outcome.record.distanceKm,
                elapsedMinutes: outcome.record.elapsedMinutes,
                speedKmh: outcome.record.speedKmh,
                thresholdKmh: outcome.record.thresholdKmh,
              },
            }).catch(() => undefined);
          }
        } catch { /* detection is best-effort; never block sign-in */ }
        const sid = (req.session as unknown as { sessionId?: string }).sessionId;
        if (sid) {
          const policy = await getSessionPolicyCached(app.clawmind.dataDir).catch(() => null);
          const { evicted } = await recordLogin(app.clawmind.dataDir, {
            sid,
            userId: result.userId,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            maxConcurrent: policy?.maxConcurrentSessions ?? 0,
          });
          for (const e of evicted) {
            await app.clawmind.audit.write({
              actor: result.userId,
              action: 'session.evicted.concurrent-cap',
              resource: 'session',
              meta: {
                ip: req.ip,
                requestId: req.id,
                cap: policy?.maxConcurrentSessions ?? 0,
                evictedSessionId: e.sidHash.slice(0, 12),
                evictedUserAgent: e.userAgent,
                evictedIp: e.ip,
              },
            }).catch(() => undefined);
          }
        }
        return reply.redirect(returnTo);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'oidc login failed';
        app.log.warn({ err }, 'oidc callback rejected');
        await app.clawmind.audit.write({
          actor: 'anonymous',
          action: 'sso.login.failed',
          resource: 'oidc',
          meta: { reason: msg },
        });
        await recordSignIn(app.clawmind.dataDir, {
          actor: 'anonymous', method: 'oidc', outcome: 'failure',
          ip: req.ip, userAgent: req.headers['user-agent'],
          reason: msg,
        }).catch(() => undefined);
        return reply.code(401).send({ error: msg });
      }
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: 'owner' | 'reader') => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMinRole: (role: MemberRole) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireScope: (scope: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireMfa: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(plugin, { name: 'auth' });
