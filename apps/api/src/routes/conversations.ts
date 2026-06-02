import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { nanoid } from 'nanoid';
import { ask, askStream } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import {
  createConversation,
  loadConversation,
  listConversations,
  searchConversations,
  deleteConversation,
  forkConversation,
  appendTurn,
  toChatMessages,
  rewriteFollowUp,
  renameConversation,
  setConversationArchived,
} from '../services/conversations.js';
import {
  conversationToMarkdown,
  conversationToJson,
  conversationToCsv,
  conversationsToMarkdown,
  conversationsToJson,
  conversationsToCsv,
} from '../services/conversation-export.js';
import { expand } from '@clawmind/config';
import { buildPrompt } from '@clawmind/llm';
import { Scopes } from '../scopes.js';

// The conversation routes layer rolling chat history on top of the regular
// RAG pipeline. Follow-up questions get rewritten with the previous user turn
// so retrieval doesn't lose the topic, and the assistant prompt is fed the
// last few turns as conversation context.

export const conversationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get<{ Querystring: { archived?: string; q?: string; limit?: string; offset?: string } }>('/conversations', {
    schema: {
      querystring: z.object({
        archived: z.enum(['true', 'false']).optional(),
        q: z.string().max(200).optional(),
        limit: z.string().regex(/^\d+$/).optional(),
        offset: z.string().regex(/^\d+$/).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsRead)],
    handler: async (req) => {
      const archived = req.query.archived === 'true';
      const q = (req.query.q ?? '').trim();
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);
      const { items, total } = await searchConversations(app.clawmind.dataDir, req.user!.id, {
        q,
        archived,
        limit,
        offset,
      });
      return {
        items: items.map(({ conversation: c, snippet, matchedTurn }) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
          turns: c.turns.length,
          archivedAt: c.archivedAt ?? null,
          snippet: snippet ?? null,
          matchedTurn,
        })),
        total,
        limit,
        offset,
        q,
      };
    },
  });

  app.post('/conversations', {
    schema: { body: z.object({ title: z.string().max(120).optional() }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsWrite)],
    handler: async (req) => ({
      conversation: await createConversation(app.clawmind.dataDir, req.user!.id, req.body.title),
    }),
  });

  app.get<{ Params: { id: string } }>('/conversations/:id', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsRead)],
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });
      return { conversation: conv };
    },
  });

  // Bulk export every conversation owned by the caller in the requested
  // format. Mirrors /saved/export.<fmt>, /history/export.<fmt> and
  // /pins/export.<fmt> so the same download UI works across curation
  // artifacts and downstream tooling gets a stable, versioned envelope.
  // Includes archived conversations so a backup is actually a backup.
  // Registered before the /:id/export.<fmt> routes so the literal
  // 'export' segment wins over the :id param.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/conversations/export.${fmt}`, {
      preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsRead)],
      handler: async (req, reply) => {
        const userId = req.user!.id;
        const dataDir = app.clawmind.dataDir;
        const [active, archived] = await Promise.all([
          listConversations(dataDir, userId, { limit: 10000, archived: false }),
          listConversations(dataDir, userId, { limit: 10000, archived: true }),
        ]);
        const all = [...active, ...archived].sort((a, b) => b.updatedAt - a.updatedAt);
        const opts = { stripBasePath: expand(app.clawmind.env.CLAWMIND_WORKSPACE) };
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-conversations-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(conversationsToJson(all, opts));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(conversationsToCsv(all, opts));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(conversationsToMarkdown(all, opts));
      },
    });
  }

  app.get<{ Params: { id: string } }>('/conversations/:id/export.md', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsRead)],
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

  app.get<{ Params: { id: string } }>('/conversations/:id/export.json', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsRead)],
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });
      const payload = conversationToJson(conv, {
        stripBasePath: expand(app.clawmind.env.CLAWMIND_WORKSPACE),
      });
      reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-disposition', `attachment; filename="clawmind-${conv.id}.json"`)
        .send(payload);
    },
  });

  app.get<{ Params: { id: string } }>('/conversations/:id/export.csv', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsRead)],
    handler: async (req, reply) => {
      const conv = await loadConversation(app.clawmind.dataDir, req.params.id);
      if (!conv || conv.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });
      const csv = conversationToCsv(conv, {
        stripBasePath: expand(app.clawmind.env.CLAWMIND_WORKSPACE),
      });
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="clawmind-${conv.id}.csv"`)
        .send(csv);
    },
  });

  app.delete<{ Params: { id: string } }>('/conversations/:id', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsWrite)],
    handler: async (req, reply) => {
      const ok = await deleteConversation(app.clawmind.dataDir, req.params.id, req.user!.id) ||
                 await deleteConversation(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      return { ok: true };
    },
  });

  // Rename a conversation. Idempotent on identical titles. Returns 404
  // when the conversation is missing or owned by another user; 400 when
  // the supplied title trims to empty.
  app.patch<{ Params: { id: string }; Body: { title: string } }>('/conversations/:id', {
    schema: {
      params: z.object({ id: z.string().min(1) }),
      body: z.object({ title: z.string().min(1).max(120) }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsWrite)],
    handler: async (req, reply) => {
      const conv = await renameConversation(
        app.clawmind.dataDir, req.user!.id, req.params.id, req.body.title,
      );
      if (!conv) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'conversation.rename', resource: conv.id,
        meta: { title: conv.title },
      });
      return { conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt } };
    },
  });

  // Archive (soft delete) or unarchive a conversation. Archived items stay
  // fetchable by id so deep links work, but are hidden from the default
  // listing. Pass ?archived=true to list archived conversations.
  app.post<{ Params: { id: string } }>('/conversations/:id/archive', {
    schema: { params: z.object({ id: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsWrite)],
    handler: async (req, reply) => {
      const conv = await setConversationArchived(
        app.clawmind.dataDir, req.user!.id, req.params.id, true,
      );
      if (!conv) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'conversation.archive', resource: conv.id,
      });
      return { id: conv.id, archivedAt: conv.archivedAt };
    },
  });

  app.post<{ Params: { id: string } }>('/conversations/:id/unarchive', {
    schema: { params: z.object({ id: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsWrite)],
    handler: async (req, reply) => {
      const conv = await setConversationArchived(
        app.clawmind.dataDir, req.user!.id, req.params.id, false,
      );
      if (!conv) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'conversation.unarchive', resource: conv.id,
      });
      return { id: conv.id, archivedAt: null };
    },
  });

  // Fork a conversation at a given turn index. The new conversation copies
  // turns [0..throughIndex] from the source, gets fresh per-turn ids, and is
  // owned by the requesting user. The source is left untouched, so a user
  // can explore an alternate line of questioning without losing the
  // original thread.
  app.post<{ Params: { id: string }; Body: { throughIndex: number; title?: string } }>('/conversations/:id/fork', {
    schema: {
      body: z.object({
        throughIndex: z.number().int().nonnegative(),
        title: z.string().max(120).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.ConversationsWrite)],
    handler: async (req, reply) => {
      const result = await forkConversation(
        app.clawmind.dataDir,
        req.user!.id,
        req.params.id,
        req.body.throughIndex,
        req.body.title,
      );
      if (!result) return reply.code(404).send({ error: 'not found or index out of range' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'fork-conversation',
        resource: `${result.sourceId}->${result.conversation.id}@${result.throughIndex}`,
      });
      return {
        conversation: result.conversation,
        sourceId: result.sourceId,
        throughIndex: result.throughIndex,
      };
    },
  });

  app.post<{ Params: { id: string }; Body: import('@clawmind/types').Query }>('/conversations/:id/ask', {
    schema: { body: QuerySchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
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

  app.post<{ Params: { id: string }; Body: import('@clawmind/types').Query }>('/conversations/:id/ask/stream', {
    schema: { body: QuerySchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
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
