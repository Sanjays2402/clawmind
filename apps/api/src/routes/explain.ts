import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { retrieveExplain } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';
import { Scopes } from '../scopes.js';
import { enforceQueryBlocklist } from '../lib/query-blocklist-gate.js';

// POST /v1/explain
//
// Same retrieval pipeline as /v1/search and /v1/ask, but the response
// includes per-chunk diagnostics (BM25 raw + normalised, dense raw +
// normalised, hybrid blend, lexical rerank score, MMR score, final rank)
// plus funnel counts at each stage. The LLM is not called. This powers
// the web /explain page so a user can see exactly which signal pulled
// each chunk into the answer.
export const explainRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/explain', {
    schema: { body: QuerySchema },
    preHandler: [app.requireAuth, app.requireScope(Scopes.Search)],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      if (!(await enforceQueryBlocklist(app, reply, req.user!.id, '/v1/explain', req.body.q))) return;
      const body = { ...req.body, q: app.aliases.expandQuery(req.body.q) };
      const result = await retrieveExplain(app.rag, body);
      const candidates = result.candidates.map((c) => {
        const short = app.aliases.shorten(c.path);
        return short ? { ...c, displayPath: short } : c;
      });
      return { ...result, candidates };
    },
  });
};
