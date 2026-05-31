import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { readFile } from 'node:fs/promises';
import { inferNamespace } from '@clawmind/ingest';
import { Scopes } from '../scopes.js';

// Sources routes expose the ingest manifest as a browsable list and let the
// web UI pull a snippet of any indexed file. Listing reads from the manifest
// because that is the authoritative record of what's currently indexed.

export const sourcesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get<{
    Querystring: {
      q?: string;
      namespace?: string;
      limit?: string;
      offset?: string;
      sort?: 'recent' | 'path' | 'chunks';
    };
  }>('/sources', {
    schema: {
      querystring: z.object({
        q: z.string().optional(),
        namespace: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
        sort: z.enum(['recent', 'path', 'chunks']).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
    handler: async (req) => {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));
      const sort = req.query.sort ?? 'recent';
      const needle = (req.query.q ?? '').toLowerCase().trim();
      const ns = req.query.namespace ?? null;

      const all = app.clawmind.manifest.entries().map((e) => ({
        path: e.path,
        namespace: inferNamespace(e.path),
        chunks: e.chunkCount,
        bytes: e.size,
        ingestedAt: e.ingestedAt,
        documentId: e.documentId,
      }));

      let filtered = all;
      if (ns) filtered = filtered.filter((e) => e.namespace === ns);
      if (needle) filtered = filtered.filter((e) => e.path.toLowerCase().includes(needle));

      if (sort === 'path') filtered.sort((a, b) => a.path.localeCompare(b.path));
      else if (sort === 'chunks') filtered.sort((a, b) => b.chunks - a.chunks);
      else filtered.sort((a, b) => b.ingestedAt - a.ingestedAt);

      const total = filtered.length;
      const items = filtered.slice(offset, offset + limit);
      return { total, offset, limit, items };
    },
  });

  app.get<{ Querystring: { path: string; start?: string; end?: string } }>('/sources/file', {
    schema: { querystring: z.object({ path: z.string(), start: z.string().optional(), end: z.string().optional() }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
    handler: async (req, reply) => {
      try {
        const raw = await readFile(req.query.path, 'utf8');
        const lines = raw.split('\n');
        const start = req.query.start ? Math.max(1, Number(req.query.start)) : 1;
        const end = req.query.end ? Math.min(lines.length, Number(req.query.end)) : lines.length;
        return { path: req.query.path, start, end, content: lines.slice(start - 1, end).join('\n') };
      } catch (err) {
        reply.code(404).send({ error: (err as Error).message });
      }
    },
  });
};
