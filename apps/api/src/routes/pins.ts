import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { addPin, loadPins, removePin } from '../services/pins.js';
import { Scopes } from '../scopes.js';

// Pin a source path so retrieval treats it as a strong prior. Pins are a
// workspace-wide signal (not per-user) because pinning is usually a
// curation choice for the team or solo user, not a personalization knob.
//
//   GET    /v1/pins         list pinned sources
//   POST   /v1/pins         { path, note? } add or replace a pin
//   DELETE /v1/pins         { path } remove a pin

export const pinsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/pins', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
    handler: async () => {
      const map = await loadPins(app.clawmind.dataDir);
      const items = Object.values(map).sort((a, b) => b.pinnedAt - a.pinnedAt);
      return { items, count: items.length };
    },
  });

  app.post('/pins', {
    schema: {
      body: z.object({
        path: z.string().min(1),
        note: z.string().max(500).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.PinsWrite)],
    handler: async (req) => {
      const entry = await addPin(
        app.clawmind.dataDir,
        req.user!.id,
        req.body.path,
        req.body.note,
      );
      await app.pins.reload();
      return entry;
    },
  });

  app.delete('/pins', {
    schema: { body: z.object({ path: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.PinsWrite)],
    handler: async (req, reply) => {
      const removed = await removePin(app.clawmind.dataDir, req.body.path);
      if (!removed) return reply.notFound('pin not found');
      await app.pins.reload();
      return { ok: true };
    },
  });
};
