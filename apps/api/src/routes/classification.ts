import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getPolicy,
  setPolicy,
  getLabel,
  setLabel,
  listLabels,
  LABELS,
  ClassificationValidationError,
  type Label,
} from '../services/classification.js';
import { Scopes } from '../scopes.js';

// Data classification (sensitivity labels) endpoints.
//
//   GET    /v1/classification/policy        read workspace policy (admin+)
//   PUT    /v1/classification/policy        update policy knobs (owner + MFA)
//   GET    /v1/classification/labels        list every labelled path (admin+)
//   GET    /v1/classification/labels/:path  read one path's label (admin+)
//   PUT    /v1/classification/labels/:path  set or clear a label (owner + MFA)
//
// Enforcement lives in routes/share.ts: every POST /v1/share runs the
// list of cited source paths past evaluateShare() and is rejected with
// 403 + audit if any label exceeds the workspace cap.

const LabelEnum = z.enum(LABELS as unknown as [string, ...string[]]);

const PolicyBody = z
  .object({
    allowPublicShareUpTo: LabelEnum.optional(),
    defaultLabel: LabelEnum.optional(),
  })
  .strict();

const LabelBody = z
  .object({
    // null clears the label and falls back to the workspace default.
    label: z.union([LabelEnum, z.null()]),
  })
  .strict();

// The :path param is URL-encoded so members can label arbitrary source
// paths (including slashes and dots). Length cap matches the document
// path schema in packages/types.
const PathParam = z.object({
  path: z.string().min(1).max(1024),
});

export const classificationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/classification/policy', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ClassificationRead),
    ],
    handler: async () => {
      const policy = await getPolicy(app.clawmind.dataDir);
      return {
        policy,
        limits: { labels: LABELS },
      };
    },
  });

  app.put('/classification/policy', {
    schema: { body: PolicyBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ClassificationManage),
    ],
    handler: async (req, reply) => {
      const prev = await getPolicy(app.clawmind.dataDir);
      try {
        const next = await setPolicy(app.clawmind.dataDir, req.user!.id, {
          allowPublicShareUpTo: req.body.allowPublicShareUpTo as Label | undefined,
          defaultLabel: req.body.defaultLabel as Label | undefined,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'classification-policy.update',
          resource: '/v1/classification/policy',
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: {
              allowPublicShareUpTo: prev.allowPublicShareUpTo,
              defaultLabel: prev.defaultLabel,
            },
            after: {
              allowPublicShareUpTo: next.allowPublicShareUpTo,
              defaultLabel: next.defaultLabel,
            },
          },
        });
        return { policy: next };
      } catch (err) {
        if (err instanceof ClassificationValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });

  app.get('/classification/labels', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ClassificationRead),
    ],
    handler: async () => {
      const items = await listLabels(app.clawmind.dataDir);
      return { items };
    },
  });

  app.get('/classification/labels/:path', {
    schema: { params: PathParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ClassificationRead),
    ],
    handler: async (req) => {
      const label = await getLabel(app.clawmind.dataDir, req.params.path);
      return { path: req.params.path, label };
    },
  });

  app.put('/classification/labels/:path', {
    schema: { params: PathParam, body: LabelBody },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.ClassificationManage),
    ],
    handler: async (req, reply) => {
      const prev = await getLabel(app.clawmind.dataDir, req.params.path);
      try {
        const result = await setLabel(
          app.clawmind.dataDir,
          req.user!.id,
          req.params.path,
          (req.body.label as Label | null) ?? null,
        );
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'classification-label.update',
          resource: req.params.path,
          meta: {
            ip: req.ip,
            requestId: req.id,
            before: prev,
            after: result.label,
          },
        });
        return result;
      } catch (err) {
        if (err instanceof ClassificationValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
