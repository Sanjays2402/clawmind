import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  getLockboxState,
  lockboxHeaderValue,
  verifyToken,
} from '../services/vendor-access.js';

// Vendor Support Access Lockbox enforcement.
//
// Two responsibilities:
//
//   1. ALWAYS add an X-Vendor-Access-Lockbox response header so the
//      customer's SIEM, healthcheck monitor, or procurement reviewer
//      can curl any API endpoint and verify in a single header whether
//      vendor support can currently see this workspace.
//         X-Vendor-Access-Lockbox: closed
//         X-Vendor-Access-Lockbox: open; expires-at=2025-...
//
//   2. If a request carries X-Vendor-Support-Token, require that token
//      to match the currently-active grant. Mismatched or stale tokens
//      are rejected with 403 BEFORE auth so a leaked support token
//      cannot be used to brute-force a session. Absence of the header
//      is a no-op: normal customer traffic flows through unchanged.

const VENDOR_TOKEN_HEADER = 'x-vendor-support-token';
const LOCKBOX_HEADER = 'X-Vendor-Access-Lockbox';

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (req, reply) => {
    // Always stamp lockbox state on the response.
    try {
      const state = await getLockboxState(app.clawmind.dataDir);
      reply.header(LOCKBOX_HEADER, lockboxHeaderValue(state));
    } catch {
      // Fail-open: a disk hiccup must not break the request lifecycle.
      reply.header(LOCKBOX_HEADER, 'unknown');
    }

    const raw = req.headers[VENDOR_TOKEN_HEADER];
    if (raw === undefined) return;
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (typeof token !== 'string' || token.length === 0) {
      return reply.code(403).send({
        error: 'vendor-access-denied',
        message: 'vendor support token rejected',
      });
    }
    let ok = false;
    try {
      ok = await verifyToken(app.clawmind.dataDir, token);
    } catch {
      ok = false;
    }
    if (!ok) {
      await app.clawmind.audit
        .write({
          actor: 'vendor-support',
          action: 'vendor-access.token.rejected',
          resource: req.url,
          meta: { method: req.method, ip: req.ip },
        })
        .catch(() => undefined);
      return reply.code(403).send({
        error: 'vendor-access-denied',
        message:
          'vendor support access is closed on this workspace or the provided token is invalid',
      });
    }
    // Mark the request so downstream code (and the audit log) can tell
    // a vendor-support session apart from a normal customer session.
    (req as unknown as { vendorSupport?: boolean }).vendorSupport = true;
    await app.clawmind.audit
      .write({
        actor: 'vendor-support',
        action: 'vendor-access.token.accepted',
        resource: req.url,
        meta: { method: req.method, ip: req.ip },
      })
      .catch(() => undefined);
  });
};

export const vendorAccessPlugin = fp(plugin, { name: 'vendor-access' });
