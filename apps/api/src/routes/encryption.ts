// Customer-managed encryption key (CMEK / BYOK) endpoints.
//
//   GET    /v1/encryption                  read status (admin+)
//   POST   /v1/encryption/kek              upload customer KEK (owner+MFA)
//   DELETE /v1/encryption/kek              remove customer KEK (owner+MFA)
//   POST   /v1/encryption/rotate           rotate the DEK (owner+MFA)
//
// Every mutating action is audited with the resulting fingerprint
// (short form) and key id so an external SIEM gets a tamper-evident
// trail of every key transition without ever seeing key material.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getStatus,
  uploadCustomerKek,
  removeCustomerKek,
  rotateDek,
  EncryptionValidationError,
  EncryptionStateError,
} from '../services/encryption.js';
import { Scopes } from '../scopes.js';

const KekBody = z
  .object({
    kek: z.string().min(1).max(512),
  })
  .strict();

const RotateBody = z
  .object({
    kek: z.string().min(1).max(512).optional(),
  })
  .strict()
  .optional();

export const encryptionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/encryption', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.EncryptionRead),
    ],
    handler: async (req) => {
      const status = await getStatus(app.clawmind.dataDir, req.user?.id ?? 'system');
      return { encryption: status };
    },
  });

  app.post('/encryption/kek', {
    schema: { body: KekBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.EncryptionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const status = await uploadCustomerKek(app.clawmind.dataDir, userId, req.body.kek);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'encryption.kek.upload',
          resource: '/v1/encryption/kek',
          meta: {
            kekKind: status.kekKind,
            kekFingerprintShort: status.kekFingerprintShort,
            activeKeyId: status.activeKeyId,
            version: status.version,
          },
        });
        return { encryption: status };
      } catch (err) {
        if (err instanceof EncryptionValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        if (err instanceof EncryptionStateError) {
          return reply.code(409).send({ error: 'conflict', message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/encryption/kek', {
    schema: { body: KekBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.EncryptionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const status = await removeCustomerKek(app.clawmind.dataDir, userId, req.body.kek);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'encryption.kek.remove',
          resource: '/v1/encryption/kek',
          meta: {
            kekKind: status.kekKind,
            kekFingerprintShort: status.kekFingerprintShort,
            activeKeyId: status.activeKeyId,
            version: status.version,
          },
        });
        return { encryption: status };
      } catch (err) {
        if (err instanceof EncryptionValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        if (err instanceof EncryptionStateError) {
          return reply.code(409).send({ error: 'conflict', message: err.message });
        }
        throw err;
      }
    },
  });

  app.post('/encryption/rotate', {
    schema: { body: RotateBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.EncryptionManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const kek = (req.body as { kek?: string } | undefined)?.kek;
      try {
        const status = await rotateDek(app.clawmind.dataDir, userId, kek);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'encryption.rotate',
          resource: '/v1/encryption/rotate',
          meta: {
            kekKind: status.kekKind,
            kekFingerprintShort: status.kekFingerprintShort,
            activeKeyId: status.activeKeyId,
            archivedKeyCount: status.archivedKeyCount,
            version: status.version,
          },
        });
        return { encryption: status };
      } catch (err) {
        if (err instanceof EncryptionValidationError) {
          return reply.code(400).send({ error: 'invalid', field: err.field, message: err.message });
        }
        if (err instanceof EncryptionStateError) {
          return reply.code(409).send({ error: 'conflict', message: err.message });
        }
        throw err;
      }
    },
  });
};
