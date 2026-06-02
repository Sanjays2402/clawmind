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
  filterEntries,
  RopaValidationError,
  ROPA_LIMITS,
  ROPA_LEGAL_BASIS_VALUES,
  type ChangeEvent,
} from '../services/ropa.js';
import { listMembers } from '../services/members.js';
import { notify } from '../services/notifications.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Record of Processing Activities (GDPR Art. 30) endpoints.
//
//   GET    /v1/ropa                       public, no auth (DPA-citable)
//   GET    /v1/ropa/admin                 admin+, operator view incl. notes
//   POST   /v1/ropa                       owner+MFA, audit + broadcast
//   PATCH  /v1/ropa/:id                   owner+MFA, audit + broadcast
//   DELETE /v1/ropa/:id                   owner+MFA, audit + broadcast (retire)
//   PUT    /v1/ropa/settings              owner+MFA, audit (intro+contact+dpo)
//
// The unauthenticated GET is the URL customers cite from their own
// Art. 30 register; if it 401s, the buyer's DPO cannot complete their
// review. The admin GET surfaces operator-only metadata (notes,
// updatedBy) that must never leak to the public page.
//
// Every mutation writes a structured audit entry AND fans out a
// `ropa.changed` in-app notification to every workspace member,
// satisfying the "advance notice of material changes to processing"
// clause most enterprise master agreements require. Notification
// delivery is best-effort: a failed broadcast must not roll back the
// registry write.

const BASIS = z.enum(ROPA_LEGAL_BASIS_VALUES as unknown as [string, ...string[]]);

const POST_BODY = z
  .object({
    name: z.string().min(1).max(ROPA_LIMITS.name),
    purpose: z.string().min(1).max(ROPA_LIMITS.purpose),
    legalBasis: BASIS,
    dataCategories: z.string().min(1).max(ROPA_LIMITS.dataCategories),
    dataSubjects: z.string().min(1).max(ROPA_LIMITS.dataSubjects),
    storageRegion: z.string().min(1).max(ROPA_LIMITS.storageRegion),
    retention: z.string().min(1).max(ROPA_LIMITS.retention),
    recipients: z.string().max(ROPA_LIMITS.recipients).nullable().optional(),
    transferMechanism: z.string().max(ROPA_LIMITS.transferMechanism).nullable().optional(),
    notes: z.string().max(ROPA_LIMITS.notes).nullable().optional(),
  })
  .strict();

const PATCH_BODY = z
  .object({
    name: z.string().min(1).max(ROPA_LIMITS.name).optional(),
    purpose: z.string().min(1).max(ROPA_LIMITS.purpose).optional(),
    legalBasis: BASIS.optional(),
    dataCategories: z.string().min(1).max(ROPA_LIMITS.dataCategories).optional(),
    dataSubjects: z.string().min(1).max(ROPA_LIMITS.dataSubjects).optional(),
    storageRegion: z.string().min(1).max(ROPA_LIMITS.storageRegion).optional(),
    retention: z.string().min(1).max(ROPA_LIMITS.retention).optional(),
    recipients: z.string().max(ROPA_LIMITS.recipients).nullable().optional(),
    transferMechanism: z.string().max(ROPA_LIMITS.transferMechanism).nullable().optional(),
    notes: z.string().max(ROPA_LIMITS.notes).nullable().optional(),
    status: z.enum(['active', 'retired']).optional(),
  })
  .strict();

const SETTINGS_BODY = z
  .object({
    intro: z.string().max(ROPA_LIMITS.intro).optional(),
    controllerContact: z
      .string()
      .email()
      .max(ROPA_LIMITS.controllerContact)
      .nullable()
      .optional(),
    dpoName: z.string().max(ROPA_LIMITS.dpoName).nullable().optional(),
  })
  .strict();

const ID_PARAMS = z.object({ id: z.string().min(1).max(64) });

function changeTitle(change: ChangeEvent): string {
  switch (change.kind) {
    case 'added':
      return `Processing activity added: ${change.entry.name}`;
    case 'retired':
      return `Processing activity retired: ${change.entry.name}`;
    case 'restored':
      return `Processing activity restored: ${change.entry.name}`;
    case 'updated':
    default:
      return `Processing activity updated: ${change.entry.name}`;
  }
}

function changeBody(change: ChangeEvent): string {
  const e = change.entry;
  return `${e.purpose} (basis: ${e.legalBasis}, region: ${e.storageRegion}).`;
}

async function broadcastChange(dataDir: string, change: ChangeEvent): Promise<void> {
  try {
    const members = await listMembers(dataDir);
    await Promise.all(
      members.map((m) =>
        notify(dataDir, {
          userId: m.userId,
          kind: 'ropa.changed',
          title: changeTitle(change),
          body: changeBody(change),
          href: '/settings/ropa',
          meta: {
            kind: change.kind,
            id: change.entry.id,
            name: change.entry.name,
          },
          dedupeKey: `ropa.${change.kind}.${change.entry.id}`,
        }).catch(() => undefined),
      ),
    );
  } catch {
    // Member registry unavailable; swallow.
  }
}

function entryDiff(change: ChangeEvent): Record<string, unknown> {
  const e = change.entry;
  const base: Record<string, unknown> = {
    id: e.id,
    name: e.name,
    status: e.status,
    legalBasis: e.legalBasis,
    storageRegion: e.storageRegion,
  };
  if (change.previous) {
    const diff: Record<string, [unknown, unknown]> = {};
    for (const k of [
      'name',
      'purpose',
      'legalBasis',
      'dataCategories',
      'dataSubjects',
      'storageRegion',
      'retention',
      'recipients',
      'transferMechanism',
      'status',
      'notes',
    ] as const) {
      if (change.previous[k] !== e[k]) {
        diff[k] = [change.previous[k], e[k]];
      }
    }
    base.changed = diff;
  }
  return base;
}

export const ropaRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public list. No auth. The URL customers cite from their own Art.
  // 30 register; gating it would make the DPA unsignable.
  //
  // Optional `q` is a case-insensitive substring filter over name,
  // purpose, data categories, data subjects, storage region,
  // recipients, retention, and transfer mechanism. Mirrors the q
  // filter on /sub-processors, /recovery-contacts, /aliases, etc.
  // so a DPO scanning for "stripe" or "us-east-1" against a long
  // register doesn't have to load the full page.
  app.get<{ Querystring: { q?: string } }>('/ropa', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    handler: async (req) => {
      const reg = await getRegistry(app.clawmind.dataDir);
      const view = publicView(reg);
      return { ...view, entries: filterEntries(view.entries, req.query.q) };
    },
  });

  app.get<{ Querystring: { q?: string } }>('/ropa/admin', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.RopaRead)],
    handler: async (req) => {
      const reg = await getRegistry(app.clawmind.dataDir);
      return { ...reg, entries: filterEntries(reg.entries, req.query.q) };
    },
  });

  app.post('/ropa', {
    schema: { body: POST_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RopaManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const previewed = validateCreate(req.body as any);
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('ropa.add', true),
            resource: '/v1/ropa',
            meta: { ip: req.ip, requestId: req.id, name: previewed.name },
          });
          return reply.code(200).send({ dryRun: true, preview: previewed });
        }
        const { registry, change } = await addEntry(
          app.clawmind.dataDir,
          userId,
          req.body as any,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('ropa.add', false),
          resource: '/v1/ropa',
          meta: { ip: req.ip, requestId: req.id, ...entryDiff(change) },
        });
        await broadcastChange(app.clawmind.dataDir, change);
        return reply.code(201).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof RopaValidationError) {
          return reply.code(400).send({ error: 'invalid processing activity', message: err.message });
        }
        throw err;
      }
    },
  });

  app.patch('/ropa/:id', {
    schema: { body: PATCH_BODY, params: ID_PARAMS, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RopaManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const reg = await getRegistry(app.clawmind.dataDir);
          const existing = reg.entries.find((e) => e.id === (req.params as any).id);
          if (!existing) return reply.code(404).send({ error: 'not found' });
          const preview = { ...existing, ...(req.body as any) };
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('ropa.update', true),
            resource: `/v1/ropa/${(req.params as any).id}`,
            meta: { ip: req.ip, requestId: req.id, id: (req.params as any).id },
          });
          return reply.code(200).send({ dryRun: true, preview });
        }
        const { registry, change } = await updateEntry(
          app.clawmind.dataDir,
          userId,
          (req.params as any).id,
          req.body as any,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('ropa.update', false),
          resource: `/v1/ropa/${(req.params as any).id}`,
          meta: { ip: req.ip, requestId: req.id, ...entryDiff(change) },
        });
        await broadcastChange(app.clawmind.dataDir, change);
        return reply.code(200).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof RopaValidationError) {
          if (err.message.startsWith('no processing activity')) {
            return reply.code(404).send({ error: 'not found', message: err.message });
          }
          return reply.code(400).send({ error: 'invalid processing activity', message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/ropa/:id', {
    schema: { params: ID_PARAMS, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RopaManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const reg = await getRegistry(app.clawmind.dataDir);
          const existing = reg.entries.find((e) => e.id === (req.params as any).id);
          if (!existing) return reply.code(404).send({ error: 'not found' });
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('ropa.retire', true),
            resource: `/v1/ropa/${(req.params as any).id}`,
            meta: { ip: req.ip, requestId: req.id, id: (req.params as any).id },
          });
          return reply
            .code(200)
            .send({ dryRun: true, preview: { ...existing, status: 'retired' } });
        }
        const { registry, change } = await retireEntry(
          app.clawmind.dataDir,
          userId,
          (req.params as any).id,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('ropa.retire', false),
          resource: `/v1/ropa/${(req.params as any).id}`,
          meta: { ip: req.ip, requestId: req.id, ...entryDiff(change) },
        });
        await broadcastChange(app.clawmind.dataDir, change);
        return reply.code(200).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof RopaValidationError) {
          if (err.message.startsWith('no processing activity')) {
            return reply.code(404).send({ error: 'not found', message: err.message });
          }
          return reply.code(400).send({ error: 'invalid processing activity', message: err.message });
        }
        throw err;
      }
    },
  });

  app.put('/ropa/settings', {
    schema: { body: SETTINGS_BODY },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RopaManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const next = await updateSettings(app.clawmind.dataDir, userId, req.body as any);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'ropa.settings.update',
          resource: '/v1/ropa/settings',
          meta: {
            ip: req.ip,
            requestId: req.id,
            hasIntro: next.intro.length > 0,
            hasContact: next.controllerContact !== null,
            hasDpo: next.dpoName !== null,
          },
        });
        return next;
      } catch (err) {
        if (err instanceof RopaValidationError) {
          return reply.code(400).send({ error: 'invalid settings', message: err.message });
        }
        throw err;
      }
    },
  });
};
