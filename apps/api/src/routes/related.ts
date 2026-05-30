import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { averageEmbedding, groupRelated } from '../services/related.js';

// GET /v1/related?path=<source>&k=8&namespaces=notes,projects
//
// Returns a list of source paths whose chunks are semantically close to
// the given path's chunks. Uses the document's average embedding as the
// query vector. Limited to dense vector search (no BM25) because the
// caller is not providing query text and BM25 over the average of a
// document's own tokens would mostly retrieve the document itself.

const RelatedQuery = z.object({
  path: z.string().min(1),
  k: z.coerce.number().int().min(1).max(50).optional().default(8),
  namespaces: z.string().optional(), // comma-separated
});

export const relatedRoutes: FastifyPluginAsync = async (app) => {
  app.get('/related', {
    schema: { querystring: RelatedQuery },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const { path, k, namespaces } = req.query;
      const ns = namespaces
        ? namespaces.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const chunks = await app.clawmind.lance.chunksForPath(path);
      if (chunks.length === 0) {
        return reply.notFound(`no indexed chunks for path: ${path}`);
      }
      const avg = averageEmbedding(chunks);
      if (!avg) {
        return reply.notFound(`indexed chunks for path have no embeddings: ${path}`);
      }
      // Over-fetch so we still have room after collapsing per-path and
      // discarding the originating path itself.
      const denseK = Math.min(200, k * 8 + chunks.length);
      const hits = await app.clawmind.lance.search(avg, denseK, ns);
      const items = groupRelated(hits, path, k);
      return {
        path,
        sourceChunkCount: chunks.length,
        items,
        count: items.length,
      };
    },
  });
};
