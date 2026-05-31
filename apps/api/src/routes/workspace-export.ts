import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  exportWorkspace,
  previewWorkspaceExport,
  workspaceBundleToZipEntries,
  WORKSPACE_EXPORT_SCHEMA,
} from '../services/workspace-export.js';
import { buildZip } from '../services/zip-export.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Tenant-wide data export. Companion to the per-user GDPR endpoints under
// /v1/me/*. This path is owner-only, audited on every call (including
// dry-run previews), and supports both a structured JSON view and a flat
// ZIP-of-JSON layout that BI / legal-hold tools can ingest verbatim.
//
//   GET /v1/workspace/export.json[?dry_run=1]
//   GET /v1/workspace/export.zip [?dry_run=1]
//
// Why not /v1/workspace alone: leaves room for future workspace metadata
// reads (GET /v1/workspace) without colliding with the export verb.

export const workspaceExportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/workspace/export.json', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireScope(Scopes.WorkspaceExportManage),
    ],
    schema: { querystring: DryRunQuery },
    handler: async (req, reply) => {
      const dryRun = isDryRun(req.query.dry_run);
      const actor = req.user!.id;

      if (dryRun) {
        const preview = await previewWorkspaceExport(app.clawmind.dataDir);
        await app.clawmind.audit.write({
          actor,
          action: auditAction('workspace.export', true),
          resource: '/v1/workspace/export.json',
          meta: { counts: preview.counts, estimatedBytes: preview.estimatedBytes },
        });
        return preview;
      }

      const bundle = await exportWorkspace(app.clawmind.dataDir, actor);
      await app.clawmind.audit.write({
        actor,
        action: auditAction('workspace.export', false),
        resource: '/v1/workspace/export.json',
        meta: { counts: bundle.counts, schema: bundle.schema },
      });
      reply.header(
        'content-disposition',
        `attachment; filename="clawmind-workspace-export-${bundle.exportedAt}.json"`,
      );
      reply.header('x-clawmind-export-schema', WORKSPACE_EXPORT_SCHEMA);
      return bundle;
    },
  });

  app.get('/workspace/export.zip', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireScope(Scopes.WorkspaceExportManage),
    ],
    schema: { querystring: DryRunQuery },
    handler: async (req, reply) => {
      const dryRun = isDryRun(req.query.dry_run);
      const actor = req.user!.id;

      if (dryRun) {
        const preview = await previewWorkspaceExport(app.clawmind.dataDir);
        await app.clawmind.audit.write({
          actor,
          action: auditAction('workspace.export.zip', true),
          resource: '/v1/workspace/export.zip',
          meta: { counts: preview.counts, estimatedBytes: preview.estimatedBytes },
        });
        return preview;
      }

      const bundle = await exportWorkspace(app.clawmind.dataDir, actor);
      const entries = workspaceBundleToZipEntries(bundle);
      const zip = buildZip(entries);
      await app.clawmind.audit.write({
        actor,
        action: auditAction('workspace.export.zip', false),
        resource: '/v1/workspace/export.zip',
        meta: { counts: bundle.counts, bytes: zip.length, entries: entries.length },
      });
      reply.header('content-type', 'application/zip');
      reply.header(
        'content-disposition',
        `attachment; filename="clawmind-workspace-export-${bundle.exportedAt}.zip"`,
      );
      reply.header('content-length', String(zip.length));
      reply.header('x-clawmind-export-schema', WORKSPACE_EXPORT_SCHEMA);
      return zip;
    },
  });

  // Inexpensive metadata route so the admin console can render counts and
  // an estimated bundle size without doing the real download. Read-only
  // scope, owner-only just like the export itself: knowing the shape of
  // the tenant is itself sensitive.
  app.get('/workspace/export/preview', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireScope(Scopes.WorkspaceExportRead),
    ],
    handler: async (req) => {
      const preview = await previewWorkspaceExport(app.clawmind.dataDir);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'workspace.export.preview',
        resource: '/v1/workspace/export/preview',
        meta: { counts: preview.counts, estimatedBytes: preview.estimatedBytes },
      });
      return preview;
    },
  });
};
