import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { retrieve, snippetFor, queryTerms } from '@clawmind/rag';
import { QuerySchema, type Query } from '@clawmind/types';
import { Scopes } from '../scopes.js';
import { recordUsage } from '../services/usage.js';
import { enforceQuotaGate } from '../lib/quota-gate.js';
import { enforceQueryBlocklist } from '../lib/query-blocklist-gate.js';

const SearchBody = QuerySchema.extend({
  /** When true (default), include a `snippet` with highlighted term spans. */
  highlight: z.boolean().optional().default(true),
  /** Approximate snippet width in characters. */
  snippetWidth: z.number().int().min(60).max(800).optional().default(240),
});

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post<{ Body: Query & { highlight?: boolean; snippetWidth?: number } }>('/search', {
    schema: {
      body: SearchBody,
      response: { 200: z.object({ hits: z.array(z.any()) }) },
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Search)],
    handler: async (req, reply) => {
      if (!(await enforceQueryBlocklist(app, reply, req.user!.id, '/v1/search', req.body.q))) return;
      const gate = await enforceQuotaGate(app, reply, req.user!.id, 1);
      if (!gate.ok) return;
      const { highlight, snippetWidth, ...query } = req.body;
      // Rewrite "@alias/sub/file" tokens to the real path before retrieval
      // runs so an alias acts as a query-time shortcut.
      const expanded = { ...query, q: app.aliases.expandQuery(query.q) };
      const hits = await retrieve(app.rag, expanded);
      void recordUsage(app.clawmind.dataDir, req.user!.id, 'search', 1).catch(() => undefined);
      const decorated = hits.map((h) => {
        const short = app.aliases.shorten(h.path);
        return short ? { ...h, displayPath: short } : h;
      });
      if (!highlight) return { hits: decorated };
      // Combine the original query and the expanded query terms so synonyms
      // also light up in the snippet. We re-derive the expansion via the
      // same tokenizer here to keep the route stateless.
      const terms = queryTerms(expanded.q);
      const enriched = decorated.map((h) => ({
        ...h,
        snippet: snippetFor(h, terms, snippetWidth),
      }));
      return { hits: enriched };
    },
  });
};
