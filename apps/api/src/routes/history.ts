import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { listHistory, pruneHistory, previewPruneHistory, deleteHistoryItem, getHistoryItem } from '../services/history.js';
import { historyToCsv, historyToJson, historyToMarkdown } from '../services/history-export.js';
import {
  loadMap as loadHistoryTags,
  tagsFor as historyTagsFor,
  listUserTags as listHistoryUserTags,
  setTags as setHistoryTags,
  addTags as addHistoryTags,
  removeTags as removeHistoryTags,
  forgetItem as forgetHistoryTags,
  normalizeTags as normalizeHistoryTags,
} from '../services/history-tags.js';
import {
  loadMap as loadHistoryTitles,
  titleFor as historyTitleFor,
  setTitle as setHistoryTitle,
  forgetItem as forgetHistoryTitle,
} from '../services/history-titles.js';
import { Scopes } from '../scopes.js';
import { isDryRun, auditAction } from '../lib/dry-run.js';

const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  q: z.string().min(1).max(200).optional(),
  // Comma-separated list of namespaces; expanded server-side.
  namespaces: z.string().optional(),
  // Comma-separated list of tags; items must carry ALL listed tags.
  tags: z.string().optional(),
});

const TagsBody = z.object({
  tags: z.array(z.string().min(1).max(32)).max(32),
});

// Body for renaming a history item. Empty string clears the custom title
// and falls back to the original query.
const TitleBody = z.object({
  title: z.string().max(120),
});

const ExportQuery = z.object({
  limit: z.coerce.number().int().min(1).max(10000).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  q: z.string().min(1).max(200).optional(),
  namespaces: z.string().optional(),
});

const PruneQuery = z.object({
  before: z.coerce.number().int().nonnegative().optional(),
  keepPerUser: z.coerce.number().int().nonnegative().max(10000).optional(),
  dry_run: z.string().optional(),
});

export const historyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/history', {
    schema: { querystring: ListQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryRead)],
    handler: async (req) => {
      const { limit, since, until, q, namespaces } = req.query as z.infer<typeof ListQuery>;
      const ns = namespaces
        ? namespaces.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      const items = await listHistory(app.clawmind.dataDir, req.user!.id, {
        limit, since, until, q, namespaces: ns,
      });
      const tagMap = await loadHistoryTags(app.clawmind.dataDir);
      const titleMap = await loadHistoryTitles(app.clawmind.dataDir);
      const wantTags = new Set(
        normalizeHistoryTags(
          (req.query as { tags?: string }).tags?.split(',').map((s) => s.trim()) ?? [],
        ),
      );
      const withTags = items
        .map((it) => {
          const title = historyTitleFor(titleMap, req.user!.id, it.id);
          return {
            ...it,
            tags: historyTagsFor(tagMap, req.user!.id, it.id),
            ...(title ? { title } : {}),
          };
        })
        .filter((it) =>
          wantTags.size === 0
            ? true
            : Array.from(wantTags).every((t) => it.tags.includes(t)),
        );
      return {
        items: withTags,
        total: withTags.length,
        availableTags: listHistoryUserTags(tagMap, req.user!.id),
      };
    },
  });

  // List the distinct tag set the caller has applied across their history.
  // Lightweight helper for tag-picker UIs; the same data is included in the
  // GET /history response so a single round trip can render the page.
  app.get('/history/tags', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryRead)],
    handler: async (req) => {
      const map = await loadHistoryTags(app.clawmind.dataDir);
      return { tags: listHistoryUserTags(map, req.user!.id) };
    },
  });

  // Replace the tag set for one history item. Returns the normalised tags
  // that were actually persisted so the UI can reflect any rejected input.
  app.put('/history/:id/tags', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
      body: TagsBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req) => {
      const { id } = req.params as { id: string };
      const { tags } = req.body as z.infer<typeof TagsBody>;
      const saved = await setHistoryTags(app.clawmind.dataDir, req.user!.id, id, tags);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'history.set-tags',
        resource: 'history',
        meta: { id, tags: saved },
      });
      return { id, tags: saved };
    },
  });

  // Add tags to a history item without clobbering existing ones.
  app.post('/history/:id/tags', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
      body: TagsBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req) => {
      const { id } = req.params as { id: string };
      const { tags } = req.body as z.infer<typeof TagsBody>;
      const saved = await addHistoryTags(app.clawmind.dataDir, req.user!.id, id, tags);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'history.add-tags',
        resource: 'history',
        meta: { id, tags: saved },
      });
      return { id, tags: saved };
    },
  });

  // Remove specific tags from a history item.
  app.delete('/history/:id/tags', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
      body: TagsBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req) => {
      const { id } = req.params as { id: string };
      const { tags } = req.body as z.infer<typeof TagsBody>;
      const saved = await removeHistoryTags(app.clawmind.dataDir, req.user!.id, id, tags);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'history.remove-tags',
        resource: 'history',
        meta: { id, tags: saved },
      });
      return { id, tags: saved };
    },
  });

  // Export current user's history in the format hinted by the URL extension.
  // Filters mirror GET /history so a customer can download exactly what the
  // history UI is showing. Output is streamed as a download (Content-
  // Disposition: attachment) so browsers save it instead of rendering it.
  for (const fmt of ['json', 'csv', 'md'] as const) {
    app.get(`/history/export.${fmt}`, {
      schema: { querystring: ExportQuery },
      preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryRead)],
      handler: async (req, reply) => {
        const { limit, since, until, q, namespaces } = req.query as z.infer<typeof ExportQuery>;
        const ns = namespaces
          ? namespaces.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined;
        const items = await listHistory(app.clawmind.dataDir, req.user!.id, {
          limit: limit ?? 1000, since, until, q, namespaces: ns,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `clawmind-history-${stamp}.${fmt}`;
        if (fmt === 'json') {
          return reply
            .header('content-type', 'application/json; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(historyToJson(items));
        }
        if (fmt === 'csv') {
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="${filename}"`)
            .send(historyToCsv(items));
        }
        return reply
          .header('content-type', 'text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(historyToMarkdown(items));
      },
    });
  }

  // Fetch a single history entry owned by the caller. Lets the UI deep-
  // link to one answer (share, permalink, re-open) without paging through
  // the full list. Returns the same shape as items in GET /history,
  // including any custom title and tags. Other users' entries surface as
  // 404 so ownership is never leaked.
  app.get('/history/:id', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryRead)],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = await getHistoryItem(app.clawmind.dataDir, req.user!.id, id);
      if (!item) {
        return reply.code(404).send({ error: 'history entry not found' });
      }
      const tagMap = await loadHistoryTags(app.clawmind.dataDir);
      const titleMap = await loadHistoryTitles(app.clawmind.dataDir);
      const title = historyTitleFor(titleMap, req.user!.id, item.id);
      return {
        ...item,
        tags: historyTagsFor(tagMap, req.user!.id, item.id),
        ...(title ? { title } : {}),
      };
    },
  });

  // Rename a single history entry. Send an empty string to clear the
  // custom title and fall back to the original query. The id must belong
  // to the caller; we do not verify against the history log itself so
  // that titles can be set optimistically before the next list refresh.
  app.patch('/history/:id', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
      body: TitleBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req) => {
      const { id } = req.params as { id: string };
      const { title } = req.body as z.infer<typeof TitleBody>;
      const saved = await setHistoryTitle(app.clawmind.dataDir, req.user!.id, id, title);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: saved ? 'history.rename' : 'history.unname',
        resource: 'history',
        meta: { id, title: saved || null },
      });
      return { id, title: saved };
    },
  });

  // Delete a single history entry owned by the caller. Lets users purge one
  // bad answer or a private question without nuking their whole log. The id
  // must belong to the caller; mismatches return 404 to avoid leaking
  // whether another user owns it.
  app.delete('/history/:id', {
    schema: {
      params: z.object({ id: z.string().min(1).max(200) }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const ok = await deleteHistoryItem(app.clawmind.dataDir, req.user!.id, id);
      if (!ok) {
        return reply.code(404).send({ error: 'history entry not found' });
      }
      // Drop any tag rows pointing at the now-deleted entry so the tag
      // index does not accumulate dangling references. Same for titles.
      await forgetHistoryTags(app.clawmind.dataDir, req.user!.id, id);
      await forgetHistoryTitle(app.clawmind.dataDir, req.user!.id, id);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'history.delete-item',
        resource: 'history',
        meta: { id },
      });
      return { id, deleted: true };
    },
  });

  app.delete('/history', {
    schema: { querystring: PruneQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.HistoryWrite)],
    handler: async (req, reply) => {
      const { before, keepPerUser } = req.query as z.infer<typeof PruneQuery>;
      const dryRun = isDryRun((req.query as { dry_run?: string }).dry_run);
      if (before === undefined && keepPerUser === undefined) {
        return reply.code(400).send({ error: 'specify at least one of: before, keepPerUser' });
      }
      const result = dryRun
        ? await previewPruneHistory(app.clawmind.dataDir, req.user!.id, { before, keepPerUser })
        : await pruneHistory(app.clawmind.dataDir, req.user!.id, { before, keepPerUser });
      await app.clawmind.audit.write({
        actor: req.user!.id, action: auditAction('history.prune', dryRun), resource: 'history',
        meta: { before, keepPerUser, ...result, dryRun },
      });
      return dryRun ? { dryRun: true, wouldRemove: result.removed, wouldKeep: result.kept } : result;
    },
  });
};
