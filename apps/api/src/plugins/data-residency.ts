import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  currentServerRegion,
  evaluate,
  getPolicyCached,
} from '../services/data-residency.js';

// Data residency enforcement.
//
// Two jobs:
//
//   1. Stamp `x-clawmind-region` on every response, on every route,
//      including health probes and 404s. The header is the contract a
//      multi-region client uses to confirm the request landed in a
//      compliant process. It is set on onSend so it survives error
//      paths and route 404s.
//
//   2. On mutating methods, evaluate the workspace residency policy
//      against the server's pinned region. If the workspace requires
//      EU only data handling and this process is pinned to `us`, the
//      request is rejected with 451 Unavailable For Legal Reasons and
//      a structured payload pointing the client at the allowed list
//      so an SDK retry can route to a compliant region.
//
// The mutation gate is allow-listed for the same auth + policy + GDPR
// surfaces that other workspace-wide gates exempt (workspace-freeze,
// policy-gate). Otherwise a workspace owner who tightened the policy
// while signed in to the wrong region would be locked out of the very
// endpoint that could relax it.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Path prefixes that remain writable even when the workspace residency
// policy excludes the current server region. These mirror the
// workspace-freeze allowlist and intentionally include the residency
// endpoints themselves so an owner can never be permanently locked out.
const ALLOW_PREFIXES: readonly string[] = Object.freeze([
  '/healthz',
  '/livez',
  '/readyz',
  '/metrics',
  '/auth',
  '/v1/sessions',
  '/v1/mfa',
  '/v1/policies',
  '/v1/data-residency',
  '/v1/workspace-export', // GDPR export must stay reachable
  '/v1/me',               // GDPR self-service
]);

function isAllowedMutation(url: string): boolean {
  // Strip query string for prefix comparison; URLs come in as
  // `/v1/foo?bar=1` from req.url.
  const path = url.split('?', 1)[0] ?? url;
  for (const p of ALLOW_PREFIXES) {
    if (path === p || path.startsWith(p + '/')) return true;
  }
  return false;
}

const plugin: FastifyPluginAsync = async (app) => {
  // Resolve once at plugin registration so a hot path read is a single
  // closed-over string compare rather than a getenv per request. Region
  // is a process-level pin; flipping it requires a restart by design,
  // because data already at rest does not move when the env changes.
  const serverRegion = currentServerRegion();

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-clawmind-region', serverRegion);
    return payload;
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!MUTATING.has(req.method)) return;
    if (isAllowedMutation(req.url)) return;
    let policy;
    try {
      policy = await getPolicyCached(app.clawmind.dataDir);
    } catch {
      // Fail-open on disk read failure: a corrupted residency file must
      // not brick the entire API. Doctor + audit surface the underlying
      // error separately. Matches workspace-freeze behaviour.
      return;
    }
    const result = evaluate(policy, serverRegion);
    if (result.ok) return;
    await app.clawmind.audit
      .write({
        actor: req.user?.id ?? 'anonymous',
        action: 'data-residency.denied',
        resource: req.url,
        meta: {
          method: req.method,
          ip: req.ip,
          requestId: req.id,
          serverRegion: result.serverRegion,
          allowedRegions: result.allowedRegions,
        },
      })
      .catch(() => undefined);
    return reply.code(451).send({
      error: 'region_not_allowed',
      message:
        'This workspace is configured to refuse writes from the current server region. ' +
        'Route this request to one of the allowed regions and retry.',
      serverRegion: result.serverRegion,
      allowedRegions: result.allowedRegions,
    });
  });
};

export const dataResidencyPlugin = fp(plugin, { name: 'data-residency' });
