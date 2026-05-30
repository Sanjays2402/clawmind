import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { retrieve, snippetFor, queryTerms } from '@clawmind/rag';
import { QuerySchema } from '@clawmind/types';

const SearchBody = QuerySchema.extend({
  /** When true (default), include a `snippet` with highlighted term spans. */
  highlight: z.boolean().optional().default(true),
  /** Approximate snippet width in characters. */
  snippetWidth: z.number().int().min(60).max(800).optional().default(240),
});

export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.post('/search', {
    schema: {
      body: SearchBody,
      response: { 200: z.object({ hits: z.array(z.any()) }) },
    },
    preHandler: app.requireAuth,
    handler: async (req) => {
      const { highlight, snippetWidth, ...query } = req.body;
      const hits = await retrieve(app.rag, query);
      if (!highlight) return { hits };
      // Combine the original query and the expanded query terms so synonyms
      // also light up in the snippet. We re-derive the expansion via the
      // same tokenizer here to keep the route stateless.
      const terms = queryTerms(query.q);
      const enriched = hits.map((h) => ({
        ...h,
        snippet: snippetFor(h, terms, snippetWidth),
      }));
      return { hits: enriched };
    },
  });
};
