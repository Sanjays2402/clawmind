import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getBanner,
  publishBanner,
  disableBanner,
  recordAck,
  listAcks,
  LoginBannerValidationError,
  MAX_BODY,
  MAX_TITLE,
  SEVERITIES,
} from '../services/login-banner.js';
import { Scopes } from '../scopes.js';

// Pre-auth system-use notification banner endpoints (NIST AC-8).
//
//   GET    /v1/login-banner             public; what the login page renders
//   PUT    /v1/login-banner             owner + MFA: publish / update
//   DELETE /v1/login-banner             owner + MFA: turn off
//   POST   /v1/login-banner/ack         authenticated: record per-session ack
//   GET    /v1/login-banner/acks        admin+: audit ledger
//
// The gate that enforces requireAck on mutating requests lives in
// plugins/login-banner.ts.

const PUBLISH_BODY = z
  .object({
    enabled: z.boolean(),
    title: z.string().min(1).max(MAX_TITLE),
    body: z.string().min(1).max(MAX_BODY),
    severity: z.enum(SEVERITIES),
    requireAck: z.boolean(),
  })
  .strict();

const ACK_BODY = z
  .object({
    bodyHash: z.string().min(16).max(128),
  })
  .strict();

export const loginBannerRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public read so the login page can render the banner BEFORE the user
  // has any credentials. Matches the NIST AC-8 intent that the notice
  // appears prior to authentication.
  app.get('/login-banner', {
    handler: async () => {
      const banner = await getBanner(app.clawmind.dataDir);
      return { banner };
    },
  });

  app.put('/login-banner', {
    schema: { body: PUBLISH_BODY },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.LoginBannerManage),
    ],
    handler: async (req, reply) => {
      try {
        const before = await getBanner(app.clawmind.dataDir);
        const banner = await publishBanner(
          app.clawmind.dataDir,
          req.user!.id,
          req.body,
        );
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'login-banner.publish',
          resource: '/v1/login-banner',
          meta: {
            previousBodyHash: before.bodyHash,
            newBodyHash: banner.bodyHash,
            previouslyEnabled: before.enabled,
            enabled: banner.enabled,
            requireAck: banner.requireAck,
            severity: banner.severity,
          },
        });
        return { banner };
      } catch (err) {
        if (err instanceof LoginBannerValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/login-banner', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.LoginBannerManage),
    ],
    handler: async (req) => {
      const before = await getBanner(app.clawmind.dataDir);
      const banner = await disableBanner(app.clawmind.dataDir, req.user!.id);
      if (before.enabled) {
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'login-banner.disable',
          resource: '/v1/login-banner',
          meta: { previousBodyHash: before.bodyHash },
        });
      }
      return { banner };
    },
  });

  app.post('/login-banner/ack', {
    schema: { body: ACK_BODY },
    preHandler: [app.requireAuth],
    handler: async (req, reply) => {
      // API-key callers are exempt by design; the banner is a per-user
      // session control, not a service-account contract.
      if (req.user!.via === 'api-key') {
        return reply
          .code(400)
          .send({ error: 'api-key-cannot-ack', message: 'API keys do not ack the login banner.' });
      }
      const sid = (req.session as unknown as { sessionId?: string }).sessionId;
      if (!sid) {
        return reply
          .code(400)
          .send({ error: 'no-session', message: 'A browser session is required to ack the banner.' });
      }
      try {
        const ip = (req.ip ?? '').slice(0, 64) || null;
        const ua = (req.headers['user-agent'] ?? null) as string | null;
        const result = await recordAck(app.clawmind.dataDir, {
          userId: req.user!.id,
          sessionId: sid,
          bodyHash: req.body.bodyHash,
          ip,
          userAgent: ua,
        });
        if (result.kind === 'no-banner') {
          return reply
            .code(409)
            .send({ error: 'no-banner', message: 'No login banner is currently published.' });
        }
        if (result.kind === 'hash-mismatch') {
          return reply.code(409).send({
            error: 'hash-mismatch',
            currentBodyHash: result.currentBodyHash,
            message: 'The banner has changed since you loaded it. Reload and ack the current text.',
          });
        }
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'login-banner.ack',
          resource: '/v1/login-banner/ack',
          meta: { bodyHash: result.ack.bodyHash, ip, userAgent: ua },
        });
        return { ack: result.ack };
      } catch (err) {
        if (err instanceof LoginBannerValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.get('/login-banner/acks', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.LoginBannerRead),
    ],
    handler: async () => {
      const banner = await getBanner(app.clawmind.dataDir);
      const acks = await listAcks(app.clawmind.dataDir);
      return { banner, acks, totalAcks: acks.length };
    },
  });
};
