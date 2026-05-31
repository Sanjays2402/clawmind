import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  addAlias, loadAliases, removeAlias, ALIAS_NAME_RE,
} from '../services/aliases.js';
import { Scopes } from '../scopes.js';

// Manage short, memorable aliases for long source paths. Aliases live in
// `aliases.json` next to pins and mutes, and are applied by the rag plugin
// at both query-rewrite and citation-render time.
//
//   GET    /v1/aliases         list aliases
//   POST   /v1/aliases         { name, path } add or replace
//   DELETE /v1/aliases         { name } remove

export const aliasesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/aliases', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.AliasesRead)],
    handler: async () => {
      const map = await loadAliases(app.clawmind.dataDir);
      const items = Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
      return { items, count: items.length };
    },
  });

  app.post('/aliases', {
    schema: {
      body: z.object({
        name: z.string().regex(ALIAS_NAME_RE, 'name must match [a-z0-9][a-z0-9_-]{0,31}'),
        path: z.string().min(1),
      }),
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.AliasesWrite)],
    handler: async (req) => {
      const entry = await addAlias(
        app.clawmind.dataDir,
        req.user!.id,
        req.body.name,
        req.body.path,
      );
      await app.aliases.reload();
      return entry;
    },
  });

  app.delete('/aliases', {
    schema: { body: z.object({ name: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.AliasesWrite)],
    handler: async (req, reply) => {
      const removed = await removeAlias(app.clawmind.dataDir, req.body.name);
      if (!removed) return reply.notFound('alias not found');
      await app.aliases.reload();
      return { ok: true };
    },
  });
};
