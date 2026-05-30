import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/health') || req.url.startsWith('/metrics')) return;
    if (req.method === 'GET' && reply.statusCode < 300) return;
    await app.clawmind.audit.write({
      actor: req.user?.id ?? 'anon',
      action: `${req.method} ${reply.statusCode}`,
      resource: req.url,
      meta: { ip: req.ip, requestId: req.id },
    });
  });
};

export const auditPlugin = fp(plugin, { name: 'audit' });
