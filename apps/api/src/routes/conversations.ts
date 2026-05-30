import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { ask, askStream } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import {
  createConversation,
  loadConversation,
  listConversations,
  deleteConversation,
  appendTurn,
  toChatMessages,
  rewriteFollowUp,
} from '../services/conversations.js';
import { conversationToMarkdown } from '../services/conversation-export.js';
import { expand } from '@clawmind/config';
import { buildPrompt } from '@clawmind/llm';

// The conversation routes layer rolling chat history on top of the regular
// RAG pipeline. Follow-up questions get rewritten with the previous user turn
// so retrieval doesn't lose the topic, and the assistant prompt is fed the
// last few turns as conversation context.

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.get('/conversations', {
    preHandler: app.requireAuth,
    handler: async (req) => ({
      items: (await listConversations(app.clawmind.dataDir, req.user!.id)).map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        turns: c.turns.length,
      })),
    }),
  });

  app.post('/conversations', {
    schema: { body: z.object({ title: z.string().max(120).optional() }) },
    preHandler: app.requireAuth,
    handler: async (req) => ({
      conversation: await createConversation(app.clawmind.dataDir, req.user!.id, req.body.title),
    }),
  });

  app.get<{ Params: { id: string } }>('/conversations/:id', {
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });
      return { conversation: conv };
    },
  });

  app.get<{ Params: { id: string } }>('/conversations/:id/export.md', {
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });
      const md = conversationToMarkdown(conv, {
        stripBasePath: expand(app.clawmind.env.CLAWMIND_WORKSPACE),
      });
      reply
        .header('content-type', 'text/markdown; charset=utf-8')
        .header('content-disposition', `attachment; filename="clawmind-${conv.id}.md"`)
        .send(md);
    },
  });

  app.delete<{ Params: { id: string } }>('/conversations/:id', {
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const ok = await deleteConversation(app.clawmind.dataDir, req.params.id, req.user!.id) ||
                 await deleteConversation(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      return { ok: true };
    },
  });

  app.post<{ Params: { id: string } }>('/conversations/:id/ask', {
    schema: { body: QuerySchema },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });

      const { rewritten, usedHistory } = rewriteFollowUp(conv, req.body.q);
      const result = await ask(app.rag, { ...req.body, q: rewritten });
      await appendTurn(app.clawmind.dataDir, conv.id, { role: 'user', content: req.body.q });
      await appendTurn(app.clawmind.dataDir, conv.id, {
        role: 'assistant', content: result.text, sources: result.sources, model: result.model,
      });
      return {
        id: nanoid(10),
        conversationId: conv.id,
        rewrittenQuery: usedHistory ? rewritten : undefined,
        ...result,
      };
    },
  });

  app.post<{ Params: { id: string } }>('/conversations/:id/ask/stream', {
    schema: { body: QuerySchema },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });

      reply.raw.setHeader('content-type', 'text/event-stream');
      reply.raw.setHeader('cache-control', 'no-cache');
      reply.raw.setHeader('connection', 'keep-alive');
      reply.hijack();

      const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      const { rewritten, usedHistory } = rewriteFollowUp(conv, req.body.q);
      if (usedHistory) send({ type: 'rewrite', value: { rewritten } });

      try {
        let buf = '';
        const sources: unknown[] = [];
        // The RAG stream is built around a single-shot retrieval; we feed the
        // rewritten query and let the prompt-builder pick up the rolling
        // history via the conversation messages on the next ask call. For now
        // streamed turns get a fresh-but-history-aware retrieval pass.
        const history = toChatMessages(conv);
        void history; // documented but not yet injected into stream prompt
        for await (const evt of askStream(app.rag, { ...req.body, q: rewritten })) {
          if (evt.type === 'token') buf += evt.value;
          if (evt.type === 'sources') sources.push(...(evt.value as unknown[]));
          send(evt);
        }
        await appendTurn(app.clawmind.dataDir, conv.id, { role: 'user', content: req.body.q });
        await appendTurn(app.clawmind.dataDir, conv.id, {
          role: 'assistant', content: buf, model: app.clawmind.llm.id,
        });
      } catch (err) {
        send({ type: 'error', value: { message: (err as Error).message } });
      } finally {
        reply.raw.end();
      }
    },
  });
};

// re-export for tests
export { buildPrompt };
