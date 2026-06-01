import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

// GET /v1/whoami
//
// Caller introspection / token debugger. This is the endpoint enterprise
// integration teams reach for first when an SDK call comes back 401, 403,
// or with surprising scope behaviour. It tells them, in one round-trip:
//
//   * are they authenticated and how (session vs api-key vs anon)
//   * who they are (user id, role, email when known)
//   * for api-key callers: the key id, its granted scopes, last-used hint
//   * which role-elevation grant (if any) is currently lifting their role
//   * the request id the gateway/audit log will use for this call
//   * the source IP the API actually observed (post X-Forwarded-For
//     parsing) so a customer behind a confused load balancer can see why
//     their IP allowlist is rejecting them
//
// This endpoint is intentionally *not* auth-required. An unauthenticated
// caller must be able to confirm "yes, I am anonymous to this server" so
// they can tell apart "my creds are wrong" from "my creds are missing".
// Procurement security reviewers also like having a stable, documented
// introspection path that does not leak workspace data when probed.
//
// We never echo the bearer token, cookie, or any header that could be a
// secret. The response is bounded and safe to log.

interface WhoAmI {
  schema: 'clawmind.whoami.v1';
  authenticated: boolean;
  via: 'session' | 'api-key' | 'anonymous';
  user: {
    id: string | null;
    role: string | null;
    email: string | null;
    github: string | null;
  };
  apiKey: {
    id: string | null;
    scopes: string[] | null;
  } | null;
  elevation: {
    id: string;
    fromRole: string;
    toRole: string;
    expiresAt: number;
  } | null;
  request: {
    id: string;
    ip: string;
    forwardedFor: string | null;
    userAgent: string | null;
    method: string;
    url: string;
    serverTime: number;
  };
}

export const whoamiRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/whoami', async (req, _reply): Promise<WhoAmI> => {
    const u = req.user ?? null;
    const fwd = req.headers['x-forwarded-for'];
    const ua = req.headers['user-agent'];
    const sessionMethod = (req.session as { authMethod?: string } | undefined)?.authMethod;
    const via: 'session' | 'api-key' | 'anonymous' = u
      ? (u.via ?? (sessionMethod ? 'session' : 'session'))
      : 'anonymous';

    return {
      schema: 'clawmind.whoami.v1',
      authenticated: Boolean(u),
      via,
      user: {
        id: u?.id ?? null,
        role: u?.role ?? null,
        email: u?.email ?? null,
        github: u?.github ?? null,
      },
      apiKey: u?.via === 'api-key'
        ? {
            id: u.apiKeyId ?? null,
            scopes: u.scopes ?? null,
          }
        : null,
      elevation: req.elevation
        ? {
            id: req.elevation.id,
            fromRole: req.elevation.fromRole,
            toRole: req.elevation.toRole,
            expiresAt: req.elevation.expiresAt,
          }
        : null,
      request: {
        id: String(req.id),
        ip: req.ip,
        forwardedFor: Array.isArray(fwd) ? fwd.join(', ') : (fwd ?? null),
        userAgent: Array.isArray(ua) ? ua.join(', ') : (ua ?? null),
        method: req.method,
        url: req.url,
        serverTime: Date.now(),
      },
    };
  });
};
