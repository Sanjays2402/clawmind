import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRecord,
  replaceRecord,
  validate,
  diff,
  evaluate,
  resolveCountry,
  ALLOWED_HEADERS,
  MAX_COUNTRIES,
  ISO_COUNTRY_RE,
} from '../services/sign-in-geofence.js';
import { Scopes } from '../scopes.js';

// HTTP surface for the sign-in geofence.
//
//   GET  /v1/sign-in-geofence       owner+ read of current policy and limits
//   PUT  /v1/sign-in-geofence       owner+MFA replace the policy
//   GET  /v1/sign-in-geofence/probe owner+ resolve the country the server
//                                   would see for THIS request, so an
//                                   admin can confirm their reverse-proxy
//                                   header wiring before turning the
//                                   policy on and locking out a region.
//
// The policy itself is enforced inside plugins/auth.ts on the GitHub and
// OIDC callbacks; this route file only manages and previews the record.

const putBody = z.object({
  enabled: z.boolean(),
  mode: z.enum(['allow', 'block']).optional(),
  countries: z
    .array(z.string().min(1).max(8))
    .max(MAX_COUNTRIES)
    .optional(),
  requireCountry: z.boolean().optional(),
  trustedHeaders: z.array(z.string().min(1).max(64)).max(16).optional(),
});

export const signInGeofenceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/sign-in-geofence', {
    preHandler: [app.requireAuth, app.requireRole('owner'), app.requireScope(Scopes.SignInGeofenceRead)],
    handler: async () => {
      const record = await getRecord(app.clawmind.dataDir);
      return {
        record,
        limits: {
          maxCountries: MAX_COUNTRIES,
          defaultHeaders: [...ALLOWED_HEADERS],
          countryFormat: ISO_COUNTRY_RE.source,
        },
      };
    },
  });

  app.get('/sign-in-geofence/probe', {
    preHandler: [app.requireAuth, app.requireRole('owner'), app.requireScope(Scopes.SignInGeofenceRead)],
    handler: async (req) => {
      const record = await getRecord(app.clawmind.dataDir);
      const resolved = resolveCountry(
        req.headers as Record<string, string | string[] | undefined>,
        record.trustedHeaders,
      );
      const decision = evaluate(
        record,
        req.headers as Record<string, string | string[] | undefined>,
      );
      return {
        country: resolved.country,
        source: resolved.source,
        ip: req.ip,
        wouldAllow: decision.allowed,
        reason: decision.reason,
        usingHeaders: record.trustedHeaders.length
          ? record.trustedHeaders
          : [...ALLOWED_HEADERS],
      };
    },
  });

  app.put('/sign-in-geofence', {
    schema: { body: putBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SignInGeofenceManage),
    ],
    handler: async (req, reply) => {
      const actor = req.user!.id;
      const v = validate(req.body);
      if (!v.ok) {
        return reply.code(400).send({ error: 'invalid', field: v.field, message: v.message });
      }
      const prev = await getRecord(app.clawmind.dataDir);

      // Foot-gun guard: when enabling allow-mode with a country list that
      // would block THIS request, require the caller to explicitly opt in
      // via the same self-lockout pattern other workspace policies use.
      if (v.value.enabled) {
        const decision = evaluate(
          { ...prev, ...v.value, createdAt: prev.createdAt, updatedAt: prev.updatedAt, updatedBy: prev.updatedBy },
          req.headers as Record<string, string | string[] | undefined>,
        );
        if (!decision.allowed) {
          const confirm = (req.body as { confirmSelfLockoutAccepted?: boolean }).confirmSelfLockoutAccepted;
          if (confirm !== true) {
            return reply.code(422).send({
              error: 'self_lockout',
              message:
                'The proposed policy would block your current sign-in. Adjust the list or resubmit with confirmSelfLockoutAccepted=true.',
              country: decision.country,
              reason: decision.reason,
            });
          }
        }
      }

      const next = await replaceRecord(app.clawmind.dataDir, actor, v.value);
      const d = diff(prev, next);
      await app.clawmind.audit.write({
        actor,
        action: 'sign-in-geofence.update',
        resource: '/v1/sign-in-geofence',
        meta: {
          enabled: next.enabled,
          mode: next.mode,
          toggled: d.toggled,
          modeChanged: d.modeChanged,
          added: d.added,
          removed: d.removed,
          requireCountryChanged: d.requireCountryChanged,
          requestId: req.id,
          ip: req.ip,
        },
      });
      return { record: next };
    },
  });
};
