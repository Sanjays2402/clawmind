import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ask, askStream } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { nanoid } from 'nanoid';
import { recordHistory } from '../services/history.js';

export const askRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ask', {
    schema: { body: QuerySchema },
    preHandler: app.requireAuth,
    handler: async (req) => {
      const result = await ask(app.rag, req.body);
      const id = nanoid(10);
      await recordHistory(app.clawmind.dataDir, {
        id, ts: Date.now(), userId: req.user!.id, query: req.body.q,
        answer: result.text, sources: result.sources, model: result.model,
      });
      return { id, ...result };
    },
  });

  app.post('/ask/stream', {
    schema: { body: QuerySchema },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-cache');
      reply.raw.setHeader('connection', 'keep-alive');
      reply.hijack();
      const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      try {
        let buf = '';
        const sources: unknown[] = [];
        for await (const evt of askStream(app.rag, req.body)) {
          if (evt.type === 'token') buf += evt.value;
          if (evt.type === 'sources') sources.push(...(evt.value as unknown[]));
          send(evt);
        }
        await recordHistory(app.clawmind.dataDir, {
          id: nanoid(10), ts: Date.now(), userId: req.user!.id,
          query: req.body.q, answer: buf, sources: sources as never, model: app.clawmind.llm.id,
        });
      } catch (err) {
        send({ type: 'error', value: { message: (err as Error).message } });
      } finally {
        reply.raw.end();
      }
    },
  });
};
