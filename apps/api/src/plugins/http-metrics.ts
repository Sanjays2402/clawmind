import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  defineCounter,
  defineHistogram,
  incr,
  observe,
} from '@clawmind/telemetry';

// Cardinality guard: we collapse the full URL path to its route template (set
// by Fastify after routing) so we do not blow up Prometheus storage with one
// series per user id / search query. Anything we cannot resolve to a route
// template gets bucketed as "unmatched".
const MAX_ROUTE_LABEL_LEN = 80;

function routeLabel(req: FastifyRequest): string {
  const tpl = req.routeOptions?.url ?? (req as unknown as { routerPath?: string }).routerPath;
  if (!tpl) return 'unmatched';
  if (tpl.length > MAX_ROUTE_LABEL_LEN) return tpl.slice(0, MAX_ROUTE_LABEL_LEN);
  return tpl;
}

export const httpMetricsPlugin: FastifyPluginAsync = fp(async (app) => {
  defineCounter('http_requests_total', 'Total HTTP requests handled by the API.');
  defineCounter(
    'http_requests_errors_total',
    'Total HTTP requests that responded with a 5xx status.',
  );
  defineHistogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds, labelled by method, route, status.',
  );

  app.addHook('onRequest', async (req) => {
    (req as FastifyRequest & { _startTime?: bigint })._startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = (req as FastifyRequest & { _startTime?: bigint })._startTime;
    if (start === undefined) return;
    const durSec = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status: String(reply.statusCode),
    };
    incr('http_requests_total', 1, labels);
    if (reply.statusCode >= 500) {
      incr('http_requests_errors_total', 1, labels);
    }
    observe('http_request_duration_seconds', durSec, labels);
  });
});
