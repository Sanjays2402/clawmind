import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { isFrozen, isFreezeAllowedPath, getFreeze } from '../services/workspace-freeze.js';

// Workspace freeze enforcement.
//
// Runs after auth so we know who is making the request (the actor goes
// into the audit entry) but before any route-specific preHandler so a
// frozen workspace cannot mutate state via /v1/ingest, /v1/keys, etc.
//
// The allowlist is intentionally narrow: only auth, MFA step-up, GDPR
// export download, and the freeze endpoint itself remain writable while
// frozen. Reads (GET/HEAD/OPTIONS) are always allowed so customers can
// still view, search, and export their data during the pause.

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (isFreezeAllowedPath(req.method, req.url)) return;
    try {
      if (!(await isFrozen(app.clawmind.dataDir))) return;
    } catch {
      // Disk read failure on the freeze file must fail-open so a corrupt
      // freeze state cannot brick the entire API. The doctor route and
      // audit log surface the underlying error separately.
      return;
    }
    const freeze = await getFreeze(app.clawmind.dataDir).catch(() => null);
    // Audit the denial so a customer reviewing why a write failed has a
    // first-class signal beyond the HTTP status code.
    await app.clawmind.audit
      .write({
        actor: req.user?.id ?? 'anonymous',
        action: 'workspace-freeze.denied',
        resource: req.url,
        meta: {
          method: req.method,
          frozenAt: freeze?.frozenAt ?? null,
          ticket: freeze?.ticket ?? null,
        },
      })
      .catch(() => undefined);
    return reply.code(423).send({
      error: 'workspace frozen',
      message:
        'This workspace is paused. Reads and exports remain available; new writes are blocked until an owner releases the freeze.',
      frozenAt: freeze?.frozenAt ?? null,
      ticket: freeze?.ticket ?? null,
      reason: freeze?.reason ?? null,
    });
  });
};

export const workspaceFreezePlugin = fp(plugin, {
  name: 'workspace-freeze',
});
