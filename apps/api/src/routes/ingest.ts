import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ingestRoot, startWatcher } from '@clawmind/ingest';
import { expand } from '@clawmind/config';

const BodySchema = z.object({ root: z.string().min(1), watch: z.boolean().default(false) });

export const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ingest', {
    schema: { body: BodySchema },
    preHandler: app.requireRole('owner'),
    handler: async (req) => {
      const c = app.clawmind;
      const stats = await ingestRoot(expand(req.body.root), {
        store: c.lance, bm25: c.bm25, bm25File: c.bm25File,
        manifest: c.manifest, embed: c.embed, embedModel: c.env.CLAWMIND_EMBED_MODEL,
      });
      if (req.body.watch) {
        startWatcher({
          root: expand(req.body.root),
          store: c.lance, bm25: c.bm25, bm25File: c.bm25File,
          manifest: c.manifest, embed: c.embed, embedModel: c.env.CLAWMIND_EMBED_MODEL,
        });
      }
      return { ok: true, ...stats };
    },
  });

  app.get('/ingest/status', {
    preHandler: app.requireAuth,
    handler: async () => ({
      documents: app.clawmind.manifest.size(),
      chunks: await app.clawmind.lance.count(),
      bm25: app.clawmind.bm25.size(),
    }),
  });
};
