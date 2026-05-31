import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { getRecord, ipAllowed } from '../services/ip-allowlist.js';

// Enforce per-user IP allowlists.
//
// Runs in the preHandler phase AFTER the auth plugin so req.user is set.
// For requests with no authenticated user (anonymous /health, /metrics, the
// session-mint endpoint, etc) we do nothing: those paths either short-circuit
// in their own handlers or are intentionally public.
//
// Skipped paths:
//   /live /ready /health /metrics  liveness + scraping, must always answer
//   /v1/ip-allowlist               self-recovery: the owner needs to be able
//                                  to delete a bad rule from a browser that
//                                  is itself behind a now-unallowed IP via
//                                  an admin session, otherwise a typo would
//                                  permanently lock the account out.
//
// When a request is denied we respond with 403, never 401, so a caller can
// distinguish "I am unauthenticated" from "you are authenticated but your
// network is not on the allowlist".

const SKIP_PREFIXES = [
  '/live',
  '/ready',
  '/health',
  '/metrics',
  '/version',
];

const SKIP_ROUTES = new Set<string>([
  // The allowlist management endpoints themselves: never gate the controls
  // that let the user fix their own list. They are still session+scope
  // protected.
  '/v1/ip-allowlist',
]);

function shouldSkip(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  for (const p of SKIP_PREFIXES) if (path === p || path.startsWith(p + '/')) return true;
  if (SKIP_ROUTES.has(path)) return true;
  return false;
}

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.user) return;
    if (shouldSkip(req.url)) return;
    const rec = await getRecord(app.clawmind.dataDir, req.user.id);
    if (!rec.enabled) return;
    if (ipAllowed(req.ip, rec.rules)) return;
    // Write a high-signal audit event for the denial. This is one of the
    // few places where a GET also writes to the audit log because a probe
    // from an unexpected network is itself security-interesting.
    await app.clawmind.audit.write({
      actor: req.user.id,
      action: 'ip-allowlist.deny',
      resource: req.url,
      meta: { ip: req.ip, via: req.user.via ?? null, requestId: req.id },
    });
    return reply
      .code(403)
      .send({ error: 'ip_not_allowed', message: 'Your IP address is not on this account\'s allowlist.' });
  });
};

export const ipAllowlistPlugin = fp(plugin, { name: 'ip-allowlist', dependencies: ['auth'] });
