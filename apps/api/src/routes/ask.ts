import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ask, askStream, cacheKey } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { nanoid } from 'nanoid';
import { recordHistory } from '../services/history.js';
import { emit as emitWebhook } from '../services/webhooks.js';
import { enforceQuota, recordUsage } from '../services/usage.js';
import { Scopes } from '../scopes.js';
import { completeStep as completeOnboardingStep } from '../services/onboarding.js';
import { applyRateLimitHeaders } from '../services/rate-headers.js';
import { enforceQueryBlocklist } from '../lib/query-blocklist-gate.js';

export const askRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/ask', {
    schema: { body: QuerySchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      if (!(await enforceQueryBlocklist(app, reply, req.user!.id, '/v1/ask', req.body.q))) return;
      const quota = await enforceQuota(app.clawmind.dataDir, req.user!.id, 1);
      if (!quota.allowed) {
        reply.header('x-clawmind-quota-used', String(quota.summary.used));
        reply.header('x-clawmind-quota-limit', String(quota.summary.limit));
        applyRateLimitHeaders(reply, {
          limit: quota.summary.limit,
          remaining: 0,
          resetMs: quota.summary.resetsAt,
          windowSec: Math.max(1, Math.round((quota.summary.resetsAt - Date.now()) / 1000)),
          policy: 'quota:monthly',
        });
        return reply.code(429).send({
          error: 'quota exceeded',
          message: `Monthly free-tier limit of ${quota.summary.limit} requests reached. Resets ${new Date(quota.summary.resetsAt).toISOString()}.`,
          usage: quota.summary,
        });
      }
      const body = { ...req.body, q: app.aliases.expandQuery(req.body.q) };
      const key = cacheKey(body, app.clawmind.llm.id, app.corpusVersion.value);
      const cached = app.answerCache.get(key);
      if (cached) {
        reply.header('x-clawmind-cache', 'hit');
        return { id: nanoid(10), ...cached, cached: true };
      }
      reply.header('x-clawmind-cache', 'miss');
      const result = await ask(app.rag, body);
      app.answerCache.set(key, result);
      const id = nanoid(10);
      await recordHistory(app.clawmind.dataDir, {
        id, ts: Date.now(), userId: req.user!.id, query: req.body.q,
        answer: result.text, sources: result.sources, model: result.model,
      });
      // Fire webhooks out-of-band so a slow receiver never delays the
      // user-facing response. Errors are isolated inside emit().
      void emitWebhook(app.clawmind.dataDir, 'ask.completed', {
        id, query: req.body.q, answer: result.text, sources: result.sources, model: result.model,
      }, req.user!.id);
      void recordUsage(app.clawmind.dataDir, req.user!.id, 'ask', 1).catch(() => undefined);
      void completeOnboardingStep(app.clawmind.dataDir, req.user!.id, 'ask').catch(() => undefined);
      return { id, ...result };
    },
  });

  app.get('/ask/cache/stats', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    handler: async () => ({ ...app.answerCache.stats(), corpusVersion: app.corpusVersion.value }),
  });

  app.post('/ask/cache/clear', {
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.Maintenance)],
    handler: async () => {
      app.answerCache.clear();
      return { ok: true };
    },
  });

  app.post('/ask/stream', {
    schema: { body: QuerySchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    handler: async (req, reply) => {
      if (!(await enforceQueryBlocklist(app, reply, req.user!.id, '/v1/ask/stream', req.body.q))) return;
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-cache');
      reply.raw.setHeader('connection', 'keep-alive');
      reply.hijack();
      const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      try {
        let buf = '';
        const sources: unknown[] = [];
        const body = { ...req.body, q: app.aliases.expandQuery(req.body.q) };
        for await (const evt of askStream(app.rag, body)) {
          if (evt.type === 'token') buf += evt.value;
          if (evt.type === 'sources') sources.push(...(evt.value as unknown[]));
          send(evt);
        }
        await recordHistory(app.clawmind.dataDir, {
          id: nanoid(10), ts: Date.now(), userId: req.user!.id,
          query: req.body.q, answer: buf, sources: sources as never, model: app.clawmind.llm.id,
        });
        void emitWebhook(app.clawmind.dataDir, 'ask.completed', {
          query: req.body.q, answer: buf, sources, model: app.clawmind.llm.id,
        }, req.user!.id);
      } catch (err) {
        send({ type: 'error', value: { message: (err as Error).message } });
      } finally {
        reply.raw.end();
      }
    },
  });
};
