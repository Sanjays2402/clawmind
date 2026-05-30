import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { listSaved } from '../services/saved.js';
import { retrieve, buildSources } from '@clawmind/rag';
import {
  captureSnapshot,
  listSnapshots,
  loadSnapshot,
  deleteSnapshot,
  diffAgainstSnapshot,
  DEFAULT_SNAPSHOT_TOP,
} from '../services/snapshots.js';

// Saved-search snapshots are user-triggered captures of the current top-N
// sources for a saved query. Distinct from digests (auto periodic diffs vs
// previous run), snapshots are explicit and persist indefinitely, so you
// can pick any historical snapshot to diff against today's result set.
//
//   GET    /v1/saved/:savedId/snapshots                list snapshots, newest first
//   POST   /v1/saved/:savedId/snapshots                capture a new one
//   GET    /v1/saved/:savedId/snapshots/:id            fetch one
//   DELETE /v1/saved/:savedId/snapshots/:id            remove one
//   POST   /v1/saved/:savedId/snapshots/:id/diff       diff fresh run vs this snapshot

export const snapshotRoutes: FastifyPluginAsync = async (app) => {
  async function ownedSaved(userId: string, savedId: string) {
    const saved = await listSaved(app.clawmind.dataDir, userId);
    return saved.find((s) => s.id === savedId) ?? null;
  }

  async function freshSources(query: string, k = DEFAULT_SNAPSHOT_TOP) {
    const hits = await retrieve(app.rag, {
      q: query, k, namespaces: undefined,
      mmrLambda: 0.5, hybridAlpha: 0.5, expand: true,
    });
    return buildSources(hits);
  }

  app.get<{ Params: { savedId: string } }>('/saved/:savedId/snapshots', {
    schema: { params: z.object({ savedId: z.string().min(1) }) },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const target = await ownedSaved(req.user!.id, req.params.savedId);
      if (!target) return reply.code(404).send({ error: 'saved search not found' });
      const items = await listSnapshots(app.clawmind.dataDir, target.id);
      return {
        items: items.map((s) => ({
          id: s.id,
          label: s.label,
          ts: s.ts,
          sourceCount: s.sources.length,
        })),
      };
    },
  });

  app.post<{ Params: { savedId: string }; Body: { label?: string; k?: number } }>(
    '/saved/:savedId/snapshots',
    {
      schema: {
        params: z.object({ savedId: z.string().min(1) }),
        body: z.object({
          label: z.string().max(200).optional(),
          k: z.number().int().min(1).max(DEFAULT_SNAPSHOT_TOP).optional(),
        }).optional(),
      },
      preHandler: app.requireAuth,
      handler: async (req, reply) => {
        const target = await ownedSaved(req.user!.id, req.params.savedId);
        if (!target) return reply.code(404).send({ error: 'saved search not found' });
        const sources = await freshSources(target.query, req.body?.k);
        const entry = await captureSnapshot(app.clawmind.dataDir, {
          savedSearchId: target.id,
          userId: req.user!.id,
          sources,
          label: req.body?.label,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id, action: 'snapshot.capture', resource: target.id,
          meta: { snapshotId: entry.id, sourceCount: entry.sources.length },
        });
        return { snapshot: entry };
      },
    },
  );

  app.get<{ Params: { savedId: string; id: string } }>(
    '/saved/:savedId/snapshots/:id',
    {
      schema: {
        params: z.object({ savedId: z.string().min(1), id: z.string().min(1) }),
      },
      preHandler: app.requireAuth,
      handler: async (req, reply) => {
        const target = await ownedSaved(req.user!.id, req.params.savedId);
        if (!target) return reply.code(404).send({ error: 'saved search not found' });
        const snap = await loadSnapshot(app.clawmind.dataDir, target.id, req.params.id);
        if (!snap) return reply.code(404).send({ error: 'snapshot not found' });
        return { snapshot: snap };
      },
    },
  );

  app.delete<{ Params: { savedId: string; id: string } }>(
    '/saved/:savedId/snapshots/:id',
    {
      schema: {
        params: z.object({ savedId: z.string().min(1), id: z.string().min(1) }),
      },
      preHandler: app.requireAuth,
      handler: async (req, reply) => {
        const target = await ownedSaved(req.user!.id, req.params.savedId);
        if (!target) return reply.code(404).send({ error: 'saved search not found' });
        const ok = await deleteSnapshot(app.clawmind.dataDir, target.id, req.params.id);
        if (!ok) return reply.code(404).send({ error: 'snapshot not found' });
        return { ok: true };
      },
    },
  );

  app.post<{ Params: { savedId: string; id: string } }>(
    '/saved/:savedId/snapshots/:id/diff',
    {
      schema: {
        params: z.object({ savedId: z.string().min(1), id: z.string().min(1) }),
      },
      preHandler: app.requireAuth,
      handler: async (req, reply) => {
        const target = await ownedSaved(req.user!.id, req.params.savedId);
        if (!target) return reply.code(404).send({ error: 'saved search not found' });
        const baseline = await loadSnapshot(app.clawmind.dataDir, target.id, req.params.id);
        if (!baseline) return reply.code(404).send({ error: 'snapshot not found' });
        const current = await freshSources(target.query);
        const diff = diffAgainstSnapshot(baseline, current);
        return { diff, current };
      },
    },
  );
};
