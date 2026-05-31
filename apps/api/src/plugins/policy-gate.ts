import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { unmetPolicies } from '../services/policies.js';

// Policy acceptance gate.
//
// When a workspace publishes a required Terms-of-Service / DPA / AUP
// version, every authenticated user must affirmatively accept it before
// they may continue using the product. This plugin enforces that gate
// uniformly across every route registered after it, returning
//
//   HTTP/1.1 451 Unavailable For Legal Reasons
//   { error: 'policy_acceptance_required', unmet: [{ id, kind, title }] }
//
// so the web UI can drive the user to /settings/policies and a scripted
// API client can detect the condition without parsing free-form text.
//
// The gate is deliberately permissive about *which* routes it allows
// through even when policies are unmet, because:
//
//   1. Auth + session management must continue to work, otherwise the
//      user has no way to actually navigate to the accept screen and
//      finish onboarding.
//   2. The policy endpoints themselves (read current, read self, accept)
//      must be reachable, otherwise the gate is a deadlock.
//   3. Health and readiness probes must never be gated by user state.
//   4. GDPR self-service export/erase must continue to work even when
//      the user has not (or cannot) accept a new policy; otherwise the
//      gate would itself be a privacy violation.
//
// The allowlist is matched on req.routerPath (the registered route
// pattern), which is stable across path params and query strings.

const ALLOW_PREFIXES: readonly string[] = Object.freeze([
  '/healthz',
  '/livez',
  '/readyz',
  '/metrics',
  '/auth',
  '/scim',
  '/v1/policies',           // read/accept must be reachable
  '/v1/profile',            // user needs to see who they are
  '/v1/me',                 // GDPR export/erase paths
  '/v1/mfa',                // MFA enrollment must finish before accept can be MFA-gated later
  '/v1/sessions',           // can sign out
  '/v1/onboarding',         // first-run guidance
]);

function isAllowed(routerPath: string | undefined, method: string): boolean {
  if (!routerPath) return true; // unknown route, let Fastify 404 it
  // GET on the audit log is read-only and should remain reachable for
  // a compliance reviewer who is gated on an unrelated policy.
  if (method === 'GET' && routerPath.startsWith('/v1/admin/audit')) return true;
  for (const p of ALLOW_PREFIXES) {
    if (routerPath === p || routerPath.startsWith(p + '/') || routerPath.startsWith(p + ':')) {
      return true;
    }
  }
  return false;
}

async function policyGatePlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return; // auth gate runs separately; unauthenticated paths handle themselves
    const routerPath = (req as { routerPath?: string }).routerPath
      ?? (req as { routeOptions?: { url?: string } }).routeOptions?.url;
    if (isAllowed(routerPath, req.method)) return;
    try {
      const unmet = await unmetPolicies(app.clawmind.dataDir, req.user.id);
      if (unmet.length === 0) return;
      reply.code(451).send({
        error: 'policy_acceptance_required',
        message:
          'One or more required workspace policies must be accepted before continuing. ' +
          'GET /v1/policies/me for details.',
        unmet: unmet.map((p) => ({ id: p.id, kind: p.kind, title: p.title })),
      });
    } catch {
      // If the policy file is unreadable we fail open rather than locking
      // the whole API out; the unreadable state is itself surfaced via
      // /readyz checks in services/doctor.
    }
  });
}

export default fp(policyGatePlugin, { name: 'policy-gate' });
