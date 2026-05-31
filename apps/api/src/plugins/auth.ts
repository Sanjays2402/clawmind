import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { verifySecret, hasScope, ipAllowedByKey, originAllowedByKey } from '../services/api-keys.js';
import { recordUsage } from '../services/api-key-usage.js';
import { consume as consumeKeyBucket } from '../services/api-key-rate-limit.js';
import {
  status as bruteforceStatus,
  recordFailure as bruteforceRecordFailure,
  recordSuccess as bruteforceRecordSuccess,
} from '../services/api-key-bruteforce.js';
import { applyRateLimitHeaders } from '../services/rate-headers.js';
import { recordLogin, touch as touchSession, isRevoked as sessionIsRevoked, removeBySid, getBySid as getSessionBySid, revokeBySid as revokeSessionBySid } from '../services/sessions.js';
import { getPolicyCached as getSessionPolicyCached, evaluateSession as evaluateSessionPolicy } from '../services/session-policy.js';
import { getStatus as getMfaStatus } from '../services/mfa.js';
import { verifyCookie as verifyTrustedDeviceCookie, TRUSTED_DEVICE_COOKIE } from '../services/mfa-trusted-devices.js';
import {
  recordSeenAndBootstrap,
  meetsMinRole,
  type MemberRole,
} from '../services/members.js';
import { resolveDefaultRoleByEmail, isSsoRequiredForEmail } from '../services/domain-policies.js';
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
    if (!tokenRes.access_token) return reply.code(400).send({ error: 'oauth failed' });
    const ghUser = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenRes.access_token}`, accept: 'application/json' },
    }).then((r) => r.json()) as { login: string; id: number };
    const allowed = env.CLAWMIND_ALLOWED_GITHUB_USERS.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(ghUser.login)) {
      return reply.code(403).send({ error: 'not allowed' });
    }
    req.session.userId = `gh:${ghUser.id}`;
    req.session.github = ghUser.login;
    req.session.authMethod = 'github';
    await app.clawmind.audit.write({ actor: req.session.userId, action: 'login', resource: 'github' });
    const sid = (req.session as unknown as { sessionId?: string }).sessionId;
    if (sid) {
      await recordLogin(app.clawmind.dataDir, {
        sid,
        userId: req.session.userId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    reply.redirect('/');
  });

  app.post('/auth/logout', async (req, reply) => {
    const sid = (req.session as unknown as { sessionId?: string }).sessionId;
    if (sid) {
      await removeBySid(app.clawmind.dataDir, sid).catch(() => undefined);
    }
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
        return reply.code(400).send({ error: 'state mismatch' });
      }
      try {
        const result = await oidcCompleteLogin(oidcSettings, code, expectedNonce);
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
        const sid = (req.session as unknown as { sessionId?: string }).sessionId;
        if (sid) {
          await recordLogin(app.clawmind.dataDir, {
            sid,
            userId: result.userId,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          });
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
