// Collections routes. A collection groups saved searches under a name so a
// customer can keep "Onboarding playbooks" separate from "Incident review"
// without bolting tags onto everything. Membership is a separate mapping so
// the saved-search store stays untouched.
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  listMembers,
  setMembers,
  assignSavedToCollection,
  removeSavedFromCollection,
  membershipForUser,
} from '../services/collections.js';
import { listSaved } from '../services/saved.js';
import { Scopes } from '../scopes.js';

const COLOR = z.enum(['slate', 'violet', 'emerald', 'amber', 'rose', 'sky']);

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  color: COLOR.optional(),
});

const UpdateBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    description: z.string().max(280).optional(),
    color: COLOR.optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined || b.color !== undefined, {
    message: 'at least one of name, description, color is required',
  });

const SetMembersBody = z.object({
  savedIds: z.array(z.string().min(1)).max(500),
});

const SingleMemberBody = z.object({
  savedId: z.string().min(1),
});

export const collectionsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/collections', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsRead)],
    handler: async (req) => ({
      items: await listCollections(app.clawmind.dataDir, req.user!.id),
    }),
  });

  app.get('/collections/_membership', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsRead)],
    handler: async (req) => ({
      // Map of savedId -> array of collection ids. Lets the saved-searches UI
      // render badges without N+1 fetches.
      membership: await membershipForUser(app.clawmind.dataDir, req.user!.id),
    }),
  });

  app.post('/collections', {
    schema: { body: CreateBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsWrite)],
    handler: async (req, reply) => {
      try {
        const item = await createCollection(
          app.clawmind.dataDir,
          req.user!.id,
          req.body as z.infer<typeof CreateBody>,
        );
        if (app.clawmind?.audit?.write) {
          await app.clawmind.audit.write({
            actor: req.user!.id,
            action: 'collection.create',
            resource: item.id,
            meta: { name: item.name, color: item.color },
          });
        }
        return { item };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  });

  app.get<{ Params: { id: string } }>('/collections/:id', {
    schema: { params: z.object({ id: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsRead)],
    handler: async (req, reply) => {
      const item = await getCollection(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!item) return reply.code(404).send({ error: 'not found' });
      const memberIds = await listMembers(app.clawmind.dataDir, req.user!.id, item.id);
      // Hydrate with the saved-search records the user actually owns so the
      // detail page can render rows without a follow-up round trip.
      const allSaved = await listSaved(app.clawmind.dataDir, req.user!.id);
      const byId = new Map(allSaved.map((s) => [s.id, s] as const));
      const items = memberIds.map((id) => byId.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v));
      return { collection: item, items };
    },
  });

  app.patch<{ Params: { id: string } }>('/collections/:id', {
    schema: {
      params: z.object({ id: z.string().min(1) }),
      body: UpdateBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsWrite)],
    handler: async (req, reply) => {
      try {
        const item = await updateCollection(
          app.clawmind.dataDir,
          req.user!.id,
          req.params.id,
          req.body as z.infer<typeof UpdateBody>,
        );
        if (!item) return reply.code(404).send({ error: 'not found' });
        if (app.clawmind?.audit?.write) {
          await app.clawmind.audit.write({
            actor: req.user!.id,
            action: 'collection.update',
            resource: item.id,
            meta: { name: item.name },
          });
        }
        return { item };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  });

  app.delete<{ Params: { id: string } }>('/collections/:id', {
    schema: { params: z.object({ id: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsWrite)],
    handler: async (req, reply) => {
      const ok = await deleteCollection(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      if (app.clawmind?.audit?.write) {
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'collection.delete',
          resource: req.params.id,
        });
      }
      return { ok: true };
    },
  });

  app.put<{ Params: { id: string } }>('/collections/:id/members', {
    schema: {
      params: z.object({ id: z.string().min(1) }),
      body: SetMembersBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsWrite)],
    handler: async (req, reply) => {
      try {
        const body = req.body as z.infer<typeof SetMembersBody>;
        const savedIds = await setMembers(
          app.clawmind.dataDir,
          req.user!.id,
          req.params.id,
          body.savedIds,
        );
        return { savedIds };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  });

  app.post<{ Params: { id: string } }>('/collections/:id/members', {
    schema: {
      params: z.object({ id: z.string().min(1) }),
      body: SingleMemberBody,
    },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsWrite)],
    handler: async (req, reply) => {
      try {
        const body = req.body as z.infer<typeof SingleMemberBody>;
        const added = await assignSavedToCollection(
          app.clawmind.dataDir,
          req.user!.id,
          req.params.id,
          body.savedId,
        );
        return { ok: true, added };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  });

  app.delete<{ Params: { id: string; savedId: string } }>('/collections/:id/members/:savedId', {
    schema: { params: z.object({ id: z.string().min(1), savedId: z.string().min(1) }) },
    preHandler: [app.requireAuth, app.requireScope(Scopes.CollectionsWrite)],
    handler: async (req) => {
      const removed = await removeSavedFromCollection(
        app.clawmind.dataDir,
        req.user!.id,
        req.params.id,
        req.params.savedId,
      );
      return { ok: true, removed };
    },
  });
};
