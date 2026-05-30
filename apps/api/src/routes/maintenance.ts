import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { compactStore, forgetSources } from '@clawmind/ingest';

const Body = z.object({ dryRun: z.boolean().default(false) });
const ForgetBody = z.object({
  patterns: z.array(z.string().min(1)).min(1).max(50),
  dryRun: z.boolean().default(false),
});

// Maintenance endpoints. Right now there is only one: compact, which prunes
// manifest, BM25, and LanceDB entries whose source files no longer exist on
// disk. It is owner-only and writes an audit record on every non-dry run.

export const maintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.post('/maintenance/compact', {
    schema: { body: Body },
    preHandler: app.requireRole('owner'),
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    handler: async (req) => {
      const c = app.clawmind;
      const report = await compactStore({
        manifest: c.manifest, bm25: c.bm25, bm25File: c.bm25File,
        lance: c.lance, dryRun: req.body.dryRun,
      });
      if (!req.body.dryRun && report.removed > 0) {
        app.corpusVersion.bump();
        app.answerCache.clear();
        await c.audit.write({
          actor: req.user!.id, action: 'maintenance.compact', resource: 'store',
          meta: { removed: report.removed, kept: report.kept },
        });
      }
      return report;
    },
  });

  // Bulk forget: remove every indexed source whose path matches any of the
  // supplied globs. Owner-only, rate-limited, audited. Pair with a dryRun
  // call from clients so users see what they are about to delete.
  app.post('/maintenance/forget', {
    schema: { body: ForgetBody },
    preHandler: app.requireRole('owner'),
    config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    handler: async (req) => {
      const c = app.clawmind;
      const report = await forgetSources({
        manifest: c.manifest, bm25: c.bm25, bm25File: c.bm25File,
        lance: c.lance,
        patterns: req.body.patterns,
        dryRun: req.body.dryRun,
      });
      if (!req.body.dryRun && report.matched > 0) {
        app.corpusVersion.bump();
        app.answerCache.clear();
        await c.audit.write({
          actor: req.user!.id, action: 'maintenance.forget', resource: 'store',
          meta: {
            patterns: req.body.patterns,
            matched: report.matched,
            removedChunks: report.removedChunks,
          },
        });
      }
      return report;
    },
  });
};
