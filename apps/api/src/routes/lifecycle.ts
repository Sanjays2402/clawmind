import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { exportUserData, deleteUserData } from '../services/lifecycle.js';
import { bundleToZip } from '../services/zip-export.js';
import { Scopes } from '../scopes.js';

// GDPR-style data lifecycle endpoints. Both are scoped to the authenticated
// user and write to the audit log so a regulator can see who exported or
// erased what and when.
//
//   GET    /v1/me/export   download every per-user record as JSON
//   DELETE /v1/me/data     erase every per-user record, return counts
//
// We use /v1/me/data rather than /v1/me so the verb-on-self pattern stays
// unambiguous and we keep room for a future GET /v1/me profile endpoint.

const deleteSchema = z.object({ confirm: z.literal('DELETE') });

export const lifecycleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me/export', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.LifecycleManage)],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const bundle = await exportUserData(app.clawmind.dataDir, userId);
      await app.clawmind.audit.write({
        actor: userId,
        action: 'lifecycle.export',
        resource: '/v1/me/export',
        meta: {
          history: bundle.history.length,
          conversations: bundle.conversations.length,
          saved: bundle.saved.length,
          feedback: bundle.feedback.length,
          apiKeys: bundle.apiKeys.length,
        },
      });
      reply.header(
        'content-disposition',
        `attachment; filename="clawmind-export-${userId}-${bundle.exportedAt}.json"`,
      );
      return bundle;
    },
  });

  // ZIP variant of the per-user GDPR export. Returns the structured JSON
  // bundle plus flattened CSVs in a single archive so legal-hold and BI
  // tooling can ingest the data without bespoke parsers. Procurement teams
  // routinely require a CSV-in-ZIP path next to the JSON one.
  app.get('/me/export.zip', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.LifecycleManage)],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const bundle = await exportUserData(app.clawmind.dataDir, userId);
      const zip = bundleToZip(bundle);
      await app.clawmind.audit.write({
        actor: userId,
        action: 'lifecycle.export.zip',
        resource: '/v1/me/export.zip',
        meta: {
          bytes: zip.length,
          history: bundle.history.length,
          conversations: bundle.conversations.length,
          saved: bundle.saved.length,
          feedback: bundle.feedback.length,
          apiKeys: bundle.apiKeys.length,
        },
      });
      reply.header('content-type', 'application/zip');
      reply.header(
        'content-disposition',
        `attachment; filename="clawmind-export-${userId}-${bundle.exportedAt}.zip"`,
      );
      reply.header('content-length', String(zip.length));
      reply.header('x-clawmind-export-schema', 'clawmind.user-export.zip.v1');
      return reply.send(zip);
    },
  });

  app.delete('/me/data', {
    schema: { body: deleteSchema },
    preHandler: [app.requireAuth, app.requireMfa, app.requireScope(Scopes.LifecycleManage)],
    handler: async (req) => {
      const userId = req.user!.id;
      const report = await deleteUserData(app.clawmind.dataDir, userId);
      await app.clawmind.audit.write({
        actor: userId,
        action: 'lifecycle.delete',
        resource: '/v1/me/data',
        meta: report.removed,
      });
      return report;
    },
  });
};
