import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { getRecord, ipAllowedByWorkspace } from '../services/workspace-ip-allowlist.js';

// Enforce the workspace-wide IP allowlist.
//
// This runs AFTER auth (so we know who the caller is for the audit trail)
// but applies regardless of role: it covers every authenticated request,
// session-cookie or API-key, so an owner cannot accidentally cut a path
// for the rest of the workspace while keeping their own admin tools open.
// Unauthenticated requests are intentionally not gated here; the auth
// plugin and the per-route requireAuth handlers cover those.
//
// Skipped paths (mirrors the per-user plugin):
//   /live /ready /health /metrics /version  liveness + scraping
//   /v1/workspace-ip-allowlist               self-recovery, owner-only
//                                            scope + MFA still enforced
//
// 403 with a stable error code so a help-desk page can give the locked-out
// owner a clear next step (have another owner remove the rule, or fall
// back to a permitted IP).

const SKIP_PREFIXES = ['/live', '/ready', '/health', '/metrics', '/version'];
const SKIP_ROUTES = new Set<string>(['/v1/workspace-ip-allowlist']);

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
    const rec = await getRecord(app.clawmind.dataDir);
    if (!rec.enabled) return;
    if (ipAllowedByWorkspace(req.ip, rec)) return;
    await app.clawmind.audit.write({
      actor: req.user.id,
      action: 'workspace-ip-allowlist.deny',
      resource: req.url,
      meta: { ip: req.ip, via: req.user.via ?? null, requestId: req.id, role: req.user.role ?? null },
    });
    return reply.code(403).send({
      error: 'workspace_ip_not_allowed',
      message: 'Your IP address is not on the workspace allowlist. Contact a workspace owner.',
    });
  });
};

export const workspaceIpAllowlistPlugin = fp(plugin, {
  name: 'workspace-ip-allowlist',
  dependencies: ['auth'],
});
