import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  getBanner,
  hasSessionAcked,
  isLoginBannerAllowedPath,
} from '../services/login-banner.js';

// Pre-auth system-use notification banner gate (NIST AC-8 enforcement).
//
// Runs after auth so we know who the caller is. When the banner is
// enabled AND requireAck=true, any non-read, non-allowlisted request
// from a SESSION user whose current sessionId has not recorded an ack
// for the current bodyHash is rejected with HTTP 412.
//
// Exemptions, in order:
//
//   1. API-key callers: not a human, no consent surface; covered by
//      the service-account contract.
//   2. Reads and allowlisted paths (auth, MFA, sessions, the banner
//      itself, the ack endpoint).
//
// Fail-open on disk errors so a corrupt banner file cannot brick the
// API; the doctor route and audit chain surface the broken file
// separately.

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (isLoginBannerAllowedPath(req.method, req.url)) return;
    if (!req.user) return;
    if (req.user.via === 'api-key') return;

    let banner;
    try {
      banner = await getBanner(app.clawmind.dataDir);
    } catch {
      return;
    }
    if (!banner.enabled || !banner.requireAck || !banner.bodyHash) return;

    const sid = (req.session as unknown as { sessionId?: string }).sessionId;
    if (!sid) return; // non-cookie callers cannot be gated meaningfully

    let acked = false;
    try {
      acked = await hasSessionAcked(app.clawmind.dataDir, sid, banner.bodyHash);
    } catch {
      return;
    }
    if (acked) return;

    await app.clawmind.audit
      .write({
        actor: req.user.id,
        action: 'login-banner.denied',
        resource: req.url,
        meta: {
          method: req.method,
          bodyHash: banner.bodyHash,
          requestId: req.id,
        },
      })
      .catch(() => undefined);

    reply.header('x-login-banner-ack-required', '1');
    reply.header('x-login-banner-hash', banner.bodyHash);
    return reply.code(412).send({
      error: 'login-banner-ack-required',
      message:
        'Acknowledge the system use notification banner before making changes on this session.',
      ackUrl: '/login-banner',
      bodyHash: banner.bodyHash,
      severity: banner.severity,
    });
  });
};

export const loginBannerPlugin = fp(plugin, { name: 'login-banner' });
