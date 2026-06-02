import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { addPin, loadPins, removePin, updatePinNote } from '../services/pins.js';
import { pinsToCsv, pinsToJson, pinsToMarkdown } from '../services/pins-export.js';
import { Scopes } from '../scopes.js';

// Pin a source path so retrieval treats it as a strong prior. Pins are a
// workspace-wide signal (not per-user) because pinning is usually a
// curation choice for the team or solo user, not a personalization knob.
//
//   GET    /v1/pins         list pinned sources
//   POST   /v1/pins         { path, note? } add or replace a pin
//   DELETE /v1/pins         { path } remove a pin

export const pinsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/pins', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
    handler: async () => {
      const map = await loadPins(app.clawmind.dataDir);
      const items = Object.values(map).sort((a, b) => b.pinnedAt - a.pinnedAt);
      return { items, count: items.length };
    },
  });

  // Export pinned sources in the format hinted by the URL extension.
  // Mirrors /saved/export.<fmt> and /history/export.<fmt> so the same
  // download UI works across curation artifacts and downstream tooling
  // gets a stable, versioned JSON envelope. Pins are workspace-wide so
  // SourcesRead is enough (matches the GET /pins read path).
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/pins/export.${fmt}`, {
      preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
      handler: async (_req, reply) => {
        const map = await loadPins(app.clawmind.dataDir);
        const items = Object.values(map).sort((a, b) => b.pinnedAt - a.pinnedAt);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-pins-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(pinsToJson(items));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(pinsToCsv(items));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(pinsToMarkdown(items));
      },
    });
  }

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

  // Update only the note on a pin without resetting `pinnedAt` or
  // `pinnedBy`. POST /pins is an upsert that overwrites the entry, so re-
  // POSTing to fix a typo in a note bumps the timestamp (re-sorts the
  // list) and rewrites ownership. PATCH preserves both. Pass note as an
  // empty string to clear the note. Returns 404 if the path is not
  // currently pinned.
  app.patch('/pins', {
    schema: {
      body: z.object({
        path: z.string().min(1),
        note: z.string().max(500),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.PinsWrite)],
    handler: async (req, reply) => {
      const updated = await updatePinNote(
        app.clawmind.dataDir,
        req.body.path,
        req.body.note,
      );
      if (!updated) return reply.notFound('pin not found');
      await app.pins.reload();
      return updated;
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
