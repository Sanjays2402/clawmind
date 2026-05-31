import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRegistry,
  addEntry,
  updateEntry,
  retireEntry,
  updateSettings,
  validateCreate,
  publicView,
  SubProcessorValidationError,
  SUB_PROCESSOR_LIMITS,
  type ChangeEvent,
} from '../services/sub-processors.js';
import { listMembers } from '../services/members.js';
import { notify } from '../services/notifications.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Sub-processor registry endpoints.
//
//   GET    /v1/sub-processors                     public, no auth   (GDPR Art 28)
//   GET    /v1/sub-processors/admin               admin+, full incl. notes
//   POST   /v1/sub-processors                     owner+MFA, audit + broadcast
//   PATCH  /v1/sub-processors/:id                 owner+MFA, audit + broadcast
//   DELETE /v1/sub-processors/:id                 owner+MFA, audit + broadcast (retire)
//   PUT    /v1/sub-processors/settings            owner+MFA, audit (intro+contact)
//
// The unauthenticated GET is the URL customers cite in their own DPAs;
// keeping it auth-free is the whole point of the feature. The admin GET
// surfaces operator-only metadata (private notes, updatedBy) that
// should never leak to the public page.
//
// Every mutation writes a structured audit entry AND fans out a
// `sub-processor.changed` in-app notification to every workspace member,
// satisfying the "advance notice of sub-processor changes" clause that
// most master agreements require. Notification delivery is best-effort:
// a failed broadcast must not roll back the registry write.

const POST_BODY = z
  .object({
    name: z.string().min(1).max(SUB_PROCESSOR_LIMITS.name),
    purpose: z.string().min(1).max(SUB_PROCESSOR_LIMITS.purpose),
    region: z.string().min(1).max(SUB_PROCESSOR_LIMITS.region),
    website: z.string().url().max(SUB_PROCESSOR_LIMITS.website).nullable().optional(),
    notes: z.string().max(SUB_PROCESSOR_LIMITS.notes).nullable().optional(),
  })
  .strict();

const PATCH_BODY = z
  .object({
    name: z.string().min(1).max(SUB_PROCESSOR_LIMITS.name).optional(),
    purpose: z.string().min(1).max(SUB_PROCESSOR_LIMITS.purpose).optional(),
    region: z.string().min(1).max(SUB_PROCESSOR_LIMITS.region).optional(),
    website: z.string().url().max(SUB_PROCESSOR_LIMITS.website).nullable().optional(),
    notes: z.string().max(SUB_PROCESSOR_LIMITS.notes).nullable().optional(),
    status: z.enum(['active', 'retired']).optional(),
  })
  .strict();

const SETTINGS_BODY = z
  .object({
    intro: z.string().max(SUB_PROCESSOR_LIMITS.intro).optional(),
    contactEmail: z.string().email().max(SUB_PROCESSOR_LIMITS.contactEmail).nullable().optional(),
  })
  .strict();

const ID_PARAMS = z.object({ id: z.string().min(1).max(64) });

function changeTitle(change: ChangeEvent): string {
  switch (change.kind) {
    case 'added':
      return `Sub-processor added: ${change.entry.name}`;
    case 'retired':
      return `Sub-processor retired: ${change.entry.name}`;
    case 'restored':
      return `Sub-processor restored: ${change.entry.name}`;
    case 'updated':
    default:
      return `Sub-processor updated: ${change.entry.name}`;
  }
}

function changeBody(change: ChangeEvent): string {
  const e = change.entry;
  return `${e.purpose} (region: ${e.region}). Review the disclosure list.`;
}

async function broadcastChange(
  dataDir: string,
  change: ChangeEvent,
): Promise<void> {
  // Fan out to every member so customers with an account in the
  // workspace see the disclosure surface a notification. Best-effort:
  // each delivery is independently swallowed so one bad inbox file
  // cannot block the rest of the broadcast.
  try {
    const members = await listMembers(dataDir);
    await Promise.all(
      members.map((m) =>
        notify(dataDir, {
          userId: m.userId,
          kind: 'sub-processor.changed',
          title: changeTitle(change),
          body: changeBody(change),
          href: '/settings/sub-processors',
          meta: {
            kind: change.kind,
            id: change.entry.id,
            name: change.entry.name,
          },
          dedupeKey: `sub-processor.${change.kind}.${change.entry.id}`,
        }).catch(() => undefined),
      ),
    );
  } catch {
    // Registry of members unavailable; swallow.
  }
}

function entryDiff(change: ChangeEvent): Record<string, unknown> {
  const e = change.entry;
  const base: Record<string, unknown> = {
    id: e.id,
    name: e.name,
    status: e.status,
    region: e.region,
  };
  if (change.previous) {
    const diff: Record<string, [unknown, unknown]> = {};
    for (const k of ['name', 'purpose', 'region', 'website', 'status', 'notes'] as const) {
      if (change.previous[k] !== e[k]) {
        diff[k] = [change.previous[k], e[k]];
      }
    }
    base.changed = diff;
  }
  return base;
}

export const subProcessorsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public list. No auth, no scope, no rate-limit branch (the global
  // limiter already covers it). This is the URL the customer's DPA
  // references; if it 401s, the DPA itself is unsignable.
  app.get('/sub-processors', {
    handler: async () => {
      const reg = await getRegistry(app.clawmind.dataDir);
      return publicView(reg);
    },
  });

  // Admin / operator view. Includes notes + updatedBy.
  app.get('/sub-processors/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.SubProcessorsRead),
    ],
    handler: async () => {
      const reg = await getRegistry(app.clawmind.dataDir);
      return reg;
    },
  });

  app.post('/sub-processors', {
    schema: { body: POST_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SubProcessorsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          // Validate-only: same 400 the real path would have produced.
          const previewed = validateCreate(req.body);
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('sub-processor.add', true),
            resource: '/v1/sub-processors',
            meta: { ip: req.ip, requestId: req.id, name: previewed.name },
          });
          return reply.code(200).send({ dryRun: true, preview: previewed });
        }
        const { registry, change } = await addEntry(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('sub-processor.add', false),
          resource: '/v1/sub-processors',
          meta: { ip: req.ip, requestId: req.id, ...entryDiff(change) },
        });
        await broadcastChange(app.clawmind.dataDir, change);
        return reply.code(201).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof SubProcessorValidationError) {
          return reply.code(400).send({ error: 'invalid sub-processor', message: err.message });
        }
        throw err;
      }
    },
  });

  app.patch('/sub-processors/:id', {
    schema: { body: PATCH_BODY, params: ID_PARAMS, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SubProcessorsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          // Run the real path against a snapshot, then bail without
          // saving. Simpler: just resolve the current entry and echo
          // the merged shape so the operator sees what would change.
          const reg = await getRegistry(app.clawmind.dataDir);
          const existing = reg.entries.find((e) => e.id === req.params.id);
          if (!existing) {
            return reply.code(404).send({ error: 'not found' });
          }
          const preview = { ...existing, ...req.body };
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('sub-processor.update', true),
            resource: `/v1/sub-processors/${req.params.id}`,
            meta: { ip: req.ip, requestId: req.id, id: req.params.id },
          });
          return reply.code(200).send({ dryRun: true, preview });
        }
        const { registry, change } = await updateEntry(
          app.clawmind.dataDir,
          userId,
          req.params.id,
          req.body,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('sub-processor.update', false),
          resource: `/v1/sub-processors/${req.params.id}`,
          meta: { ip: req.ip, requestId: req.id, ...entryDiff(change) },
        });
        await broadcastChange(app.clawmind.dataDir, change);
        return reply.code(200).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof SubProcessorValidationError) {
          if (err.message.startsWith('no sub-processor')) {
            return reply.code(404).send({ error: 'not found', message: err.message });
          }
          return reply.code(400).send({ error: 'invalid sub-processor', message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/sub-processors/:id', {
    schema: { params: ID_PARAMS, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SubProcessorsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const reg = await getRegistry(app.clawmind.dataDir);
          const existing = reg.entries.find((e) => e.id === req.params.id);
          if (!existing) {
            return reply.code(404).send({ error: 'not found' });
          }
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('sub-processor.retire', true),
            resource: `/v1/sub-processors/${req.params.id}`,
            meta: { ip: req.ip, requestId: req.id, id: req.params.id },
          });
          return reply.code(200).send({ dryRun: true, preview: { ...existing, status: 'retired' } });
        }
        const { registry, change } = await retireEntry(
          app.clawmind.dataDir,
          userId,
          req.params.id,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('sub-processor.retire', false),
          resource: `/v1/sub-processors/${req.params.id}`,
          meta: { ip: req.ip, requestId: req.id, ...entryDiff(change) },
        });
        await broadcastChange(app.clawmind.dataDir, change);
        return reply.code(200).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof SubProcessorValidationError) {
          if (err.message.startsWith('no sub-processor')) {
            return reply.code(404).send({ error: 'not found', message: err.message });
          }
          return reply.code(400).send({ error: 'invalid sub-processor', message: err.message });
        }
        throw err;
      }
    },
  });

  app.put('/sub-processors/settings', {
    schema: { body: SETTINGS_BODY },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SubProcessorsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const next = await updateSettings(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'sub-processor.settings.update',
          resource: '/v1/sub-processors/settings',
          meta: {
            ip: req.ip,
            requestId: req.id,
            hasIntro: next.intro.length > 0,
            hasContact: next.contactEmail !== null,
          },
        });
        return next;
      } catch (err) {
        if (err instanceof SubProcessorValidationError) {
          return reply.code(400).send({ error: 'invalid settings', message: err.message });
        }
        throw err;
      }
    },
  });
};
