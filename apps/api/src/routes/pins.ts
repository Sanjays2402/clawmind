import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { addPin, filterPins, getPin, loadPins, removePin, updatePinNote } from '../services/pins.js';
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
  // Optional `q` filters by a case-insensitive substring of the pin
  // path or note. Mirrors the saved-search list filter so the same
  // curation search box in the web UI works across pinned sources too.
  app.get<{ Querystring: { q?: string } }>('/pins', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
    handler: async (req) => {
      const map = await loadPins(app.clawmind.dataDir);
      const all = Object.values(map).sort((a, b) => b.pinnedAt - a.pinnedAt);
      const items = filterPins(all, (req.query as { q?: string }).q);
      return { items, count: items.length };
    },
  });

  // Export pinned sources in the format hinted by the URL extension.
  // Mirrors /saved/export.<fmt> and /history/export.<fmt> so the same
  // download UI works across curation artifacts and downstream tooling
  // gets a stable, versioned JSON envelope. Pins are workspace-wide so
  // SourcesRead is enough (matches the GET /pins read path).
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get<{ Querystring: { q?: string } }>(`/pins/export.${fmt}`, {
      schema: {
        querystring: z.object({
          q: z.string().trim().min(1).max(200).optional(),
        }),
      },
      preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
      handler: async (req, reply) => {
        const map = await loadPins(app.clawmind.dataDir);
        const all = Object.values(map).sort((a, b) => b.pinnedAt - a.pinnedAt);
        const items = filterPins(all, (req.query as { q?: string }).q);
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

  // Single-entry fetch by path. Pins are keyed by arbitrary workspace
  // paths (slashes, dots, spaces), so the path comes through as a query
  // parameter instead of a URL segment. Returns 404 when the path is not
  // currently pinned so callers can distinguish "never pinned" from
  // "empty note".
  app.get('/pins/entry', {
    schema: { querystring: z.object({ path: z.string().min(1).max(1024) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
    handler: async (req, reply) => {
      const entry = await getPin(app.clawmind.dataDir, req.query.path);
      if (!entry) return reply.notFound('pin not found');
      return { item: entry };
    },
  });

  // Per-entry export. Lets a curator download or share one pinned
  // source as a self-contained file without exporting the entire pin
  // list. Reuses the same formatters as the bulk /pins/export.<fmt>
  // endpoints so the JSON envelope and Markdown layout match. Path is
  // a query parameter to avoid clashing with the bulk export route.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/pins/entry/export.${fmt}`, {
      schema: { querystring: z.object({ path: z.string().min(1).max(1024) }) },
      preHandler: [app.requireAuth, app.requireScope(Scopes.SourcesRead)],
      handler: async (req, reply) => {
        const entry = await getPin(app.clawmind.dataDir, req.query.path);
        if (!entry) return reply.notFound('pin not found');
        const stamp = new Date(entry.pinnedAt).toISOString().slice(0, 10);
        const safePath = entry.path.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 64) || 'entry';
        const filename = `clawmind-pin-${stamp}-${safePath}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(pinsToJson([entry]));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(pinsToCsv([entry]));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(pinsToMarkdown([entry]));
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
