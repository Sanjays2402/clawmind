import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  isPending,
  isDeletionAllowedPath,
  getDeletion,
} from '../services/workspace-deletion.js';

// Workspace scheduled-deletion enforcement.
//
// Mirrors the workspace-freeze plugin: once a deletion is pending, every
// mutating route outside the allowlist returns HTTP 423 Locked. Reads,
// final exports, auth, MFA step-up, and the deletion endpoint itself
// remain available so the customer can pull their data and (if they
// change their mind) cancel before scheduledFor.
//
// This runs AFTER the freeze plugin so a workspace can be both frozen
// and pending deletion without surprises; either gate is sufficient to
// block writes.

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (isDeletionAllowedPath(req.method, req.url)) return;
    try {
      if (!(await isPending(app.clawmind.dataDir))) return;
    } catch {
      // Disk read failure must fail-open so a corrupt deletion file
      // cannot brick the API. doctor + audit surface the underlying
      // problem out of band.
      return;
    }
    const d = await getDeletion(app.clawmind.dataDir).catch(() => null);
    await app.clawmind.audit
      .write({
        actor: req.user?.id ?? 'anonymous',
        action: 'workspace-deletion.denied',
        resource: req.url,
        meta: {
          method: req.method,
          scheduledFor: d?.scheduledFor ?? null,
          ticket: d?.ticket ?? null,
        },
      })
      .catch(() => undefined);
    return reply.code(423).send({
      error: 'workspace deletion pending',
      message:
        'This workspace is scheduled for deletion. Reads and exports remain available; new writes are blocked until an owner cancels the deletion or the grace window passes.',
      scheduledFor: d?.scheduledFor ?? null,
      ticket: d?.ticket ?? null,
      reason: d?.reason ?? null,
    });
  });
};

export const workspaceDeletionPlugin = fp(plugin, {
  name: 'workspace-deletion',
});
