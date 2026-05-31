import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { captureException, isSentryEnabled, setUser } from '@clawmind/telemetry';

// Pipes Fastify request errors into Sentry with enough context to debug:
//   - request id (from Fastify) for log/trace correlation
//   - route template (not raw URL) to avoid PII like search query strings
//   - authenticated user id and auth mechanism, if any
//
// We deliberately do not capture 4xx errors. Client validation failures
// are noise in error tracking and the audit log already records them.

declare module 'fastify' {
  interface FastifyRequest {
    captureException?: (err: unknown, extra?: Record<string, unknown>) => string | undefined;
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('captureException', null as any);

  app.addHook('onRequest', async (req) => {
    req.captureException = (err, extra) =>
      captureException(err, {
        requestId: req.id,
        method: req.method,
        route: req.routeOptions?.url ?? 'unmatched',
        ip: req.ip,
        ...(extra ?? {}),
      });
  });

  app.addHook('preHandler', async (req) => {
    if (!req.user) return;
    setUser({ id: req.user.id, username: req.user.github ?? req.user.id });
  });

  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.captureException?.(err, { statusCode: status });
    }
    reply.send(err);
  });

  app.addHook('onClose', async () => {
    // Best-effort flush so in-flight events leave the pod before SIGTERM
    // kills the process. Bounded so we do not delay shutdown.
    if (isSentryEnabled()) {
      const { flushSentry } = await import('@clawmind/telemetry');
      await flushSentry(1500);
    }
  });
};

export const sentryPlugin = fp(plugin, { name: 'sentry' });
