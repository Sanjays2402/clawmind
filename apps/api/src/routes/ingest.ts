import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { ingestRoot, startWatcher } from '@clawmind/ingest';
import { expand } from '@clawmind/config';
import { Scopes } from '../scopes.js';

const BodySchema = z.object({ root: z.string().min(1), watch: z.boolean().default(false) });

export const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ingest', {
    schema: { body: BodySchema },
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.Ingest)],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
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
      app.corpusVersion.bump();
      app.answerCache.clear();
      return { ok: true, ...stats, corpusVersion: app.corpusVersion.value };
    },
  });

  app.get('/ingest/status', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ingest)],
    handler: async () => ({
      documents: app.clawmind.manifest.size(),
      chunks: await app.clawmind.lance.count(),
      bm25: app.clawmind.bm25.size(),
    }),
  });
};
