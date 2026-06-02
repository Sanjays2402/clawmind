import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  addTags, loadTags, normalizeTag, pathsByTag, removeTags, setTags, tagsFor,
} from '../services/tags.js';
import {
  tagsToCsv, tagsToJson, tagsToMarkdown, tagsToRows,
} from '../services/tags-export.js';
import { Scopes } from '../scopes.js';

// Tags are a workspace-wide labeling layer over source paths. They are
// distinct from namespaces (which are partition-level) and aliases (which
// are name shortcuts). Tags participate in retrieval through include/exclude
// query filters wired in apps/api/src/plugins/rag.ts.
//
//   GET    /v1/tags                list every tag with its source count
//   GET    /v1/tags/:tag           list source paths that carry :tag
//   GET    /v1/tags/by-path        ?path=... return tags on a single source
//   PUT    /v1/tags/by-path        { path, tags } replace tag list
//   POST   /v1/tags/by-path        { path, tags } add tags (union)
//   DELETE /v1/tags/by-path        { path, tags? } remove tags or clear all
//
// All write routes require owner role because tags shape retrieval for every
// user in the workspace.

export const tagsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/tags', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.TagsRead)],
    handler: async () => {
      const map = await loadTags(app.clawmind.dataDir);
      const inverse = pathsByTag(map);
      const items = Object.entries(inverse)
        .map(([tag, paths]) => ({ tag, count: paths.length }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      return { items, count: items.length };
    },
  });

  // Bulk export of every tag with its source paths in the format hinted by
  // the URL extension. Mirrors /feedback/export.<fmt> and /saved/export.<fmt>
  // so the download buttons in the web UI behave consistently. Rows are
  // sorted by source count (descending) so the broadest labels surface
  // first, and the JSON envelope is versioned so downstream tooling can
  // detect breaking changes.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/tags/export.${fmt}`, {
      preHandler: [app.requireAuth, app.requireScope(Scopes.TagsRead)],
      handler: async (_req, reply) => {
        const map = await loadTags(app.clawmind.dataDir);
        const rows = tagsToRows(map);
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-tags-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(tagsToJson(rows));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(tagsToCsv(rows));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(tagsToMarkdown(rows));
      },
    });
  }

  app.get<{ Params: { tag: string } }>('/tags/:tag', {
    schema: { params: z.object({ tag: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.TagsRead)],
    handler: async (req, reply) => {
      const t = normalizeTag(req.params.tag);
      if (!t) return reply.badRequest('invalid tag');
      const map = await loadTags(app.clawmind.dataDir);
      const paths = pathsByTag(map)[t] ?? [];
      return { tag: t, paths, count: paths.length };
    },
  });

  app.get<{ Querystring: { path: string } }>('/tags/by-path', {
    schema: { querystring: z.object({ path: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.TagsRead)],
    handler: async (req) => {
      const map = await loadTags(app.clawmind.dataDir);
      return { path: req.query.path, tags: tagsFor(map, req.query.path) };
    },
  });

  const writeBody = z.object({
    path: z.string().min(1),
    tags: z.array(z.string()).max(64).optional().default([]),
  });

  app.put<{ Body: { path: string; tags: string[] } }>('/tags/by-path', {
    schema: { body: writeBody },
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.TagsWrite)],
    handler: async (req) => {
      const tags = await setTags(app.clawmind.dataDir, req.body.path, req.body.tags);
      await app.tags.reload();
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'tags.set', resource: req.body.path,
        meta: { tags },
      });
      return { path: req.body.path, tags };
    },
  });

  app.post<{ Body: { path: string; tags: string[] } }>('/tags/by-path', {
    schema: { body: writeBody.extend({ tags: z.array(z.string()).min(1).max(64) }) },
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.TagsWrite)],
    handler: async (req) => {
      const tags = await addTags(app.clawmind.dataDir, req.body.path, req.body.tags);
      await app.tags.reload();
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'tags.add', resource: req.body.path,
        meta: { added: req.body.tags, current: tags },
      });
      return { path: req.body.path, tags };
    },
  });

  app.delete<{
    Body: { path: string; tags?: string[] };
  }>('/tags/by-path', {
    schema: {
      body: z.object({
        path: z.string().min(1),
        tags: z.array(z.string()).max(64).optional(),
      }),
    },
    preHandler: [app.requireRole('owner'), app.requireScope(Scopes.TagsWrite)],
    handler: async (req) => {
      const tags = req.body.tags && req.body.tags.length > 0
        ? await removeTags(app.clawmind.dataDir, req.body.path, req.body.tags)
        : await setTags(app.clawmind.dataDir, req.body.path, []);
      await app.tags.reload();
      await app.clawmind.audit.write({
        actor: req.user!.id, action: 'tags.remove', resource: req.body.path,
        meta: { removed: req.body.tags ?? null, current: tags },
      });
      return { path: req.body.path, tags };
    },
  });
};
