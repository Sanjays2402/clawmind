import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  getPolicy,
  hasUserAcceptedCurrent,
  isAcceptableUseAllowedPath,
} from '../services/acceptable-use.js';

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (isAcceptableUseAllowedPath(req.method, req.url)) return;
    if (!req.user) return;
    if (req.user.via === 'api-key') return;
    if (req.user.role === 'owner') return;

    let policy;
    try {
      policy = await getPolicy(app.clawmind.dataDir);
    } catch {
      return;
    }
    if (!policy.requireAcceptance || !policy.version) return;

    let accepted = false;
    try {
      accepted = await hasUserAcceptedCurrent(app.clawmind.dataDir, req.user.id);
    } catch {
      return;
    }
    if (accepted) return;

    await app.clawmind.audit
      .write({
        actor: req.user.id,
        action: 'acceptable-use.denied',
        resource: req.url,
        meta: {
          method: req.method,
          requiredVersion: policy.version,
          requestId: req.id,
        },
      })
      .catch(() => undefined);

    reply.header('x-acceptable-use-required', '1');
    reply.header('x-acceptable-use-version', policy.version);
    return reply.code(412).send({
      error: 'acceptable-use-required',
      message:
        'The workspace acceptable-use policy must be accepted before making changes.',
      version: policy.version,
      acceptUrl: '/settings/acceptable-use',
    });
  });
};

export const acceptableUsePlugin = fp(plugin, { name: 'acceptable-use' });
