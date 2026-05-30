import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { addMute, loadMutes, removeMute } from '../services/mutes.js';

// Mute a source path so retrieval pushes it to the back of the line. Mutes
// are a workspace-wide signal (not per-user) for the same reason pins are:
// they encode curation, not personalization. The API surface mirrors pins
// so a UI can treat the two as a single "source weight" tool with opposite
// signs.
//
//   GET    /v1/mutes         list muted sources
//   POST   /v1/mutes         { path, reason? } add or replace a mute
//   DELETE /v1/mutes         { path } remove a mute

export const mutesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/mutes', {
    preHandler: app.requireAuth,
    handler: async () => {
      const map = await loadMutes(app.clawmind.dataDir);
      const items = Object.values(map).sort((a, b) => b.mutedAt - a.mutedAt);
      return { items, count: items.length };
    },
  });

  app.post('/mutes', {
    schema: {
      body: z.object({
        path: z.string().min(1),
        reason: z.string().max(500).optional(),
      }),
    },
    preHandler: app.requireAuth,
    handler: async (req) => {
      const entry = await addMute(
        app.clawmind.dataDir,
        req.user!.id,
        req.body.path,
        req.body.reason,
      );
      await app.mutes.reload();
      return entry;
    },
  });

  app.delete('/mutes', {
    schema: { body: z.object({ path: z.string().min(1) }) },
    preHandler: app.requireAuth,
    handler: async (req, reply) => {
      const removed = await removeMute(app.clawmind.dataDir, req.body.path);
      if (!removed) return reply.notFound('mute not found');
      await app.mutes.reload();
      return { ok: true };
    },
  });
};
