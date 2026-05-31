import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getPreferences, setPreferences, KNOWN_KINDS } from '../services/notification-prefs.js';
import { Scopes } from '../scopes.js';

// Per-user notification preferences.
//
//   GET  /v1/notification-preferences         current prefs for the caller
//   PUT  /v1/notification-preferences         { prefs: { <kind>: boolean } }
//
// Owner-scoped: data lives under <dataDir>/notification-prefs/<userId>.json,
// the route never accepts a userId from the request. The notifications
// producer side calls shouldDeliver() to honour these preferences before a
// row is ever written to the inbox.

const PrefsObject = z
  .object(
    Object.fromEntries(KNOWN_KINDS.map((k) => [k, z.boolean().optional()])),
  )
  .strict();

const PutBody = z.object({ prefs: PrefsObject });

export const notificationPrefsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/notification-preferences', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationPrefsRead)],
    handler: async (req) => {
      const rec = await getPreferences(app.clawmind.dataDir, req.user!.id);
      return { preferences: rec, knownKinds: KNOWN_KINDS };
    },
  });

  app.put('/notification-preferences', {
    schema: { body: PutBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.NotificationPrefsWrite)],
    handler: async (req) => {
      const body = req.body as { prefs: Record<string, boolean | undefined> };
      const rec = await setPreferences(app.clawmind.dataDir, req.user!.id, {
        prefs: body.prefs as Partial<Record<typeof KNOWN_KINDS[number], boolean>>,
      });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'notification-prefs.update',
        resource: '/v1/notification-preferences',
        meta: { kinds: Object.keys(body.prefs) },
      });
      return { preferences: rec, knownKinds: KNOWN_KINDS };
    },
  });
};
