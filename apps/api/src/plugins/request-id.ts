import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';

// Request-Id plugin
//
// Honours an inbound `X-Request-Id` header when it looks safe (length 8..128,
// only URL-safe characters) so callers and upstream proxies can correlate a
// chain of requests. Otherwise generates a fresh id. The id is exposed on the
// response as `X-Request-Id` and attached to the per-request child logger as
// `requestId` so every log line and audit row can be joined on it.

const SAFE = /^[A-Za-z0-9_.:-]{8,128}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function pickRequestId(headerValue: string | string[] | undefined): string {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (raw && SAFE.test(raw)) return raw;
  return `req_${nanoid(16)}`;
}

const plugin: FastifyPluginAsync = async (app) => {
  // genReqId fires before any hook, so req.id is the canonical request id
  // everywhere downstream (logs, audit, sentry, metrics).
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
};

export const requestIdPlugin = fp(plugin, { name: 'request-id' });
