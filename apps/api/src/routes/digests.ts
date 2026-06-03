import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listSaved } from '../services/saved.js';
import { retrieve } from '@clawmind/rag';
import { runDigest, loadState, listDigestsForUser } from '../services/digests.js';
import { buildSources } from '@clawmind/rag';
import { Scopes } from '../scopes.js';

// Saved-search digests. Re-runs a saved query against the current index and
// diffs the top sources against the previous run, so you can see what's new
// since you last checked.
//
//   POST /v1/digests/run        run every saved search the user owns
//   POST /v1/digests/:id/run    run one saved search by id
//   GET  /v1/digests            list latest state per saved search
//   GET  /v1/digests/:id        full history for one saved search

export const digestRoutes: FastifyPluginAsyncZod = async (app) => {
  // Optional `q` filters by a case-insensitive substring matched against
  // the saved search id, title, or query string. Handy for scripting against
  // workspaces with many saved searches.
  app.get<{ Querystring: { q?: string } }>('/digests', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.DigestsRead)],
    handler: async (req) => {
      const saved = await listSaved(app.clawmind.dataDir, req.user!.id);
      const states = await listDigestsForUser(app.clawmind.dataDir, req.user!.id, saved.map((s) => s.id));
      const q = (req.query as { q?: string }).q?.toLowerCase();
      const items = saved.map((s) => {
        const st = states.find((x) => x.savedSearchId === s.id);
        return {
          savedSearchId: s.id,
          title: s.title,
          query: s.query,
          lastRunTs: st?.lastRunTs ?? null,
          lastNewCount: st?.history[0]?.newSources.length ?? 0,
          lastRemovedCount: st?.history[0]?.removedSources.length ?? 0,
          runs: st?.history.length ?? 0,
        };
      });
      const filtered = q
        ? items.filter((it) =>
            it.savedSearchId.toLowerCase().includes(q)
            || it.title.toLowerCase().includes(q)
            || it.query.toLowerCase().includes(q),
          )
        : items;
      return { items: filtered };
    },
  });

  app.get<{ Params: { id: string } }>('/digests/:id', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.DigestsRead)],
    handler: async (req, reply) => {
      const state = await loadState(app.clawmind.dataDir, req.params.id);
      if (!state || state.userId !== req.user!.id) return reply.code(404).send({ error: 'not found' });
      return { state };
    },
  });

  app.post<{ Params: { id: string } }>('/digests/:id/run', {
    schema: { body: z.object({ k: z.number().int().min(1).max(50).default(8) }).optional() },
    preHandler: [app.requireAuth, app.requireScope(Scopes.DigestsWrite)],
    handler: async (req, reply) => {
      const saved = await listSaved(app.clawmind.dataDir, req.user!.id);
      const target = saved.find((s) => s.id === req.params.id);
      if (!target) return reply.code(404).send({ error: 'not found' });
      const k = (req.body as { k?: number } | undefined)?.k ?? 8;
      const { entry, state } = await runDigest(
        app.clawmind.dataDir,
        { savedSearchId: target.id, query: target.query, userId: req.user!.id },
        async (q) => {
          const hits = await retrieve(app.rag, {
            q, k, namespaces: undefined,
            mmrLambda: 0.5, hybridAlpha: 0.5, expand: true,
          });
          return buildSources(hits);
        },
      );
      return { entry, lastRunTs: state.lastRunTs, totalRuns: state.history.length };
    },
  });

  app.post('/digests/run', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.DigestsWrite)],
    handler: async (req) => {
      const saved = await listSaved(app.clawmind.dataDir, req.user!.id);
      const results: Array<{ savedSearchId: string; newCount: number; removedCount: number }> = [];
      for (const s of saved) {
        const { entry } = await runDigest(
          app.clawmind.dataDir,
          { savedSearchId: s.id, query: s.query, userId: req.user!.id },
          async (q) => {
            const hits = await retrieve(app.rag, {
              q, k: 8, namespaces: undefined,
              mmrLambda: 0.5, hybridAlpha: 0.5, expand: true,
            });
            return buildSources(hits);
          },
        );
        results.push({
          savedSearchId: s.id,
          newCount: entry.newSources.length,
          removedCount: entry.removedSources.length,
        });
      }
      return { ran: results.length, results };
    },
  });
};
