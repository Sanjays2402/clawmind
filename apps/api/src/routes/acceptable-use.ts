import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  publishPolicy,
  recordAcceptance,
  hasUserAcceptedCurrent,
  listAcceptances,
  AcceptableUseValidationError,
  MAX_BODY,
  MAX_TITLE,
  MAX_VERSION,
} from '../services/acceptable-use.js';
import { Scopes } from '../scopes.js';

const PUBLISH_BODY = z
  .object({
    version: z.string().min(1).max(MAX_VERSION),
    title: z.string().min(1).max(MAX_TITLE),
    body: z.string().min(1).max(MAX_BODY),
    requireAcceptance: z.boolean(),
  })
  .strict();

const ACCEPT_BODY = z
  .object({
    version: z.string().min(1).max(MAX_VERSION),
    bodyHash: z.string().min(16).max(128),
  })
  .strict();

export const acceptableUseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/acceptable-use', {
    handler: async (req) => {
      const policy = await getPolicy(app.clawmind.dataDir);
      let accepted: boolean | null = null;
      if (req.user) {
        accepted = await hasUserAcceptedCurrent(app.clawmind.dataDir, req.user.id);
      }
      return {
        policy,
        viewer: req.user ? { userId: req.user.id, accepted } : null,
      };
    },
  });

  app.put('/acceptable-use', {
    schema: { body: PUBLISH_BODY },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.AcceptableUseManage),
    ],
    handler: async (req, reply) => {
      try {
        const before = await getPolicy(app.clawmind.dataDir);
        const policy = await publishPolicy(
          app.clawmind.dataDir,
          req.user!.id,
          req.body,
        );
        const versionChanged = before.version !== policy.version;
        const bodyChanged = before.bodyHash !== policy.bodyHash;
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'acceptable-use.publish',
          resource: '/v1/acceptable-use',
          meta: {
            previousVersion: before.version || null,
            newVersion: policy.version,
            previousBodyHash: before.bodyHash,
            newBodyHash: policy.bodyHash,
            requireAcceptance: policy.requireAcceptance,
            versionChanged,
            bodyChanged,
          },
        });
        return { policy };
      } catch (err) {
        if (err instanceof AcceptableUseValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/acceptable-use/accept', {
    schema: { body: ACCEPT_BODY },
    preHandler: [app.requireAuth],
    handler: async (req, reply) => {
      if (req.user!.via === 'api-key') {
        return reply.code(400).send({
          error: 'api-key-cannot-accept',
          message: 'API keys are exempt from acceptance and do not record consent.',
        });
      }
      try {
        const ip = (req.ip ?? '').slice(0, 64) || null;
        const ua = (req.headers['user-agent'] ?? null) as string | null;
        const result = await recordAcceptance(app.clawmind.dataDir, {
          userId: req.user!.id,
          version: req.body.version,
          bodyHash: req.body.bodyHash,
          ip,
          userAgent: ua,
        });
        if (result.kind === 'no-policy') {
          return reply.code(409).send({
            error: 'no-policy',
            message: 'No acceptable-use policy has been published.',
          });
        }
        if (result.kind === 'version-mismatch') {
          return reply.code(409).send({
            error: 'version-mismatch',
            currentVersion: result.currentVersion,
            message:
              'The policy has been updated. Reload, re-read, and accept the current version.',
          });
        }
        if (result.kind === 'hash-mismatch') {
          return reply.code(409).send({
            error: 'hash-mismatch',
            currentBodyHash: result.currentBodyHash,
            message:
              'The policy body has changed since you last loaded it. Reload and accept the current version.',
          });
        }
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'acceptable-use.accept',
          resource: '/v1/acceptable-use/accept',
          meta: {
            version: result.acceptance.version,
            bodyHash: result.acceptance.bodyHash,
            ip,
            userAgent: ua,
          },
        });
        return { acceptance: result.acceptance };
      } catch (err) {
        if (err instanceof AcceptableUseValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.get('/acceptable-use/coverage', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.AcceptableUseReadAll),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      const acceptances = await listAcceptances(app.clawmind.dataDir);
      const { listMembers } = await import('../services/members.js');
      const members = await listMembers(app.clawmind.dataDir).catch(() => []);
      const acceptedSet = new Set(
        acceptances
          .filter((a) => a.version === policy.version && policy.version !== '')
          .map((a) => a.userId),
      );
      const outstanding = members
        .filter((m) => !acceptedSet.has(m.userId))
        .map((m) => ({
          userId: m.userId,
          email: m.email,
          label: m.label,
          role: m.role,
        }));
      const accepted = members
        .filter((m) => acceptedSet.has(m.userId))
        .map((m) => {
          const rec = acceptances.find(
            (a) => a.userId === m.userId && a.version === policy.version,
          );
          return {
            userId: m.userId,
            email: m.email,
            label: m.label,
            role: m.role,
            acceptedAt: rec?.acceptedAt ?? null,
            ip: rec?.ip ?? null,
          };
        });
      return {
        policy,
        accepted,
        outstanding,
        totalMembers: members.length,
        totalAccepted: accepted.length,
        totalAcceptances: acceptances.length,
      };
    },
  });
};
