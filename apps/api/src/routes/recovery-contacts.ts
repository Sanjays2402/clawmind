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
  RecoveryContactValidationError,
  RECOVERY_CONTACT_LIMITS,
} from '../services/recovery-contacts.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Recovery contacts endpoints (SOC2 CC7.4 / BCP escalation list).
//
//   GET    /v1/recovery-contacts                 public, no auth
//   GET    /v1/recovery-contacts/admin           admin+, full incl. notes
//   POST   /v1/recovery-contacts                 owner+MFA, audit
//   PATCH  /v1/recovery-contacts/:id             owner+MFA, audit
//   DELETE /v1/recovery-contacts/:id             owner+MFA, audit (retire)
//   PUT    /v1/recovery-contacts/settings        owner+MFA, audit
//
// The unauthenticated GET is the URL a buyer's incident-response
// runbook cites. Keeping it auth-free is the point of the feature;
// publicListed=false on every entry yields an empty list but the
// endpoint itself must always answer 200 so a probe from the
// buyer's vendor-management tool does not page their on-call.

const POST_BODY = z
  .object({
    name: z.string().min(1).max(RECOVERY_CONTACT_LIMITS.name),
    role: z.string().min(1).max(RECOVERY_CONTACT_LIMITS.role),
    email: z.string().email().max(RECOVERY_CONTACT_LIMITS.email),
    phone: z.string().max(RECOVERY_CONTACT_LIMITS.phone).nullable().optional(),
    priority: z.number().int().min(1).max(999).optional(),
    publicListed: z.boolean().optional(),
    notes: z.string().max(RECOVERY_CONTACT_LIMITS.notes).nullable().optional(),
  })
  .strict();

const PATCH_BODY = z
  .object({
    name: z.string().min(1).max(RECOVERY_CONTACT_LIMITS.name).optional(),
    role: z.string().min(1).max(RECOVERY_CONTACT_LIMITS.role).optional(),
    email: z.string().email().max(RECOVERY_CONTACT_LIMITS.email).optional(),
    phone: z.string().max(RECOVERY_CONTACT_LIMITS.phone).nullable().optional(),
    priority: z.number().int().min(1).max(999).optional(),
    publicListed: z.boolean().optional(),
    notes: z.string().max(RECOVERY_CONTACT_LIMITS.notes).nullable().optional(),
    status: z.enum(['active', 'retired']).optional(),
  })
  .strict();

const SETTINGS_BODY = z
  .object({
    intro: z.string().max(RECOVERY_CONTACT_LIMITS.intro).optional(),
    fallbackEmail: z
      .string()
      .email()
      .max(RECOVERY_CONTACT_LIMITS.fallbackEmail)
      .nullable()
      .optional(),
  })
  .strict();

const ID_PARAMS = z.object({ id: z.string().min(1).max(64) });

function entryMeta(prev: unknown, entry: Record<string, unknown>): Record<string, unknown> {
  // Audit meta: emit the public-safe identifying fields plus a per-
  // field diff against the previous row. We never log notes — they
  // can carry operational secrets ("the after-hours Signal number
  // is +1...") and the audit chain has a longer retention than the
  // registry itself.
  const base: Record<string, unknown> = {
    id: entry.id,
    name: entry.name,
    role: entry.role,
    email: entry.email,
    status: entry.status,
    publicListed: entry.publicListed,
    priority: entry.priority,
  };
  if (prev && typeof prev === 'object') {
    const p = prev as Record<string, unknown>;
    const diff: Record<string, [unknown, unknown]> = {};
    for (const k of ['name', 'role', 'email', 'phone', 'priority', 'publicListed', 'status'] as const) {
      if (p[k] !== entry[k]) diff[k] = [p[k], entry[k]];
    }
    base.changed = diff;
  }
  return base;
}

export const recoveryContactsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public list. No auth — this is the URL a buyer's IR runbook
  // cites. publicListed=false entries are filtered out by
  // publicView so the operator can keep internal escalation tiers
  // private without losing the public surface entirely.
  //
  // Optional `q` filters entries by a case-insensitive substring of
  // the contact's name, role, or email so a buyer's on-call can pull
  // "every SRE" or "every contact at @example.com" with one URL the
  // runbook already cites. Mirrors the q filter on /pins, /mutes,
  // /aliases, and /sub-processors.
  app.get<{ Querystring: { q?: string } }>('/recovery-contacts', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    handler: async (req) => {
      const reg = await getRegistry(app.clawmind.dataDir);
      const view = publicView(reg);
      const entries = filterEntries(view.entries, req.query.q);
      return { ...view, entries };
    },
  });

  // Operator view. Includes notes + updatedBy + retired entries.
  app.get('/recovery-contacts/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.RecoveryContactsRead),
    ],
    handler: async () => {
      const reg = await getRegistry(app.clawmind.dataDir);
      return reg;
    },
  });

  app.post('/recovery-contacts', {
    schema: { body: POST_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RecoveryContactsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const previewed = validateCreate(req.body);
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('recovery-contact.add', true),
            resource: '/v1/recovery-contacts',
            meta: {
              ip: req.ip,
              requestId: req.id,
              name: previewed.name,
              email: previewed.email,
            },
          });
          return reply.code(200).send({ dryRun: true, preview: previewed });
        }
        const { registry, change } = await addEntry(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('recovery-contact.add', false),
          resource: '/v1/recovery-contacts',
          meta: { ip: req.ip, requestId: req.id, ...entryMeta(null, change.entry as unknown as Record<string, unknown>) },
        });
        return reply.code(201).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof RecoveryContactValidationError) {
          return reply.code(400).send({ error: 'invalid recovery contact', message: err.message });
        }
        throw err;
      }
    },
  });

  app.patch('/recovery-contacts/:id', {
    schema: { body: PATCH_BODY, params: ID_PARAMS, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RecoveryContactsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const reg = await getRegistry(app.clawmind.dataDir);
          const existing = reg.entries.find((e) => e.id === req.params.id);
          if (!existing) return reply.code(404).send({ error: 'not found' });
          const preview = { ...existing, ...req.body };
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('recovery-contact.update', true),
            resource: `/v1/recovery-contacts/${req.params.id}`,
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
          action: auditAction('recovery-contact.update', false),
          resource: `/v1/recovery-contacts/${req.params.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            ...entryMeta(
              change.previous as unknown as Record<string, unknown>,
              change.entry as unknown as Record<string, unknown>,
            ),
          },
        });
        return reply.code(200).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof RecoveryContactValidationError) {
          if (err.message.startsWith('no recovery contact')) {
            return reply.code(404).send({ error: 'not found', message: err.message });
          }
          return reply.code(400).send({ error: 'invalid recovery contact', message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/recovery-contacts/:id', {
    schema: { params: ID_PARAMS, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RecoveryContactsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const reg = await getRegistry(app.clawmind.dataDir);
          const existing = reg.entries.find((e) => e.id === req.params.id);
          if (!existing) return reply.code(404).send({ error: 'not found' });
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('recovery-contact.retire', true),
            resource: `/v1/recovery-contacts/${req.params.id}`,
            meta: { ip: req.ip, requestId: req.id, id: req.params.id },
          });
          return reply
            .code(200)
            .send({ dryRun: true, preview: { ...existing, status: 'retired' } });
        }
        const { registry, change } = await retireEntry(
          app.clawmind.dataDir,
          userId,
          req.params.id,
        );
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('recovery-contact.retire', false),
          resource: `/v1/recovery-contacts/${req.params.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            ...entryMeta(
              change.previous as unknown as Record<string, unknown>,
              change.entry as unknown as Record<string, unknown>,
            ),
          },
        });
        return reply.code(200).send({ entry: change.entry, registry });
      } catch (err) {
        if (err instanceof RecoveryContactValidationError) {
          if (err.message.startsWith('no recovery contact')) {
            return reply.code(404).send({ error: 'not found', message: err.message });
          }
          return reply.code(400).send({ error: 'invalid recovery contact', message: err.message });
        }
        throw err;
      }
    },
  });

  app.put('/recovery-contacts/settings', {
    schema: { body: SETTINGS_BODY },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.RecoveryContactsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      try {
        const next = await updateSettings(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: 'recovery-contact.settings.update',
          resource: '/v1/recovery-contacts/settings',
          meta: {
            ip: req.ip,
            requestId: req.id,
            hasIntro: next.intro.length > 0,
            hasFallback: next.fallbackEmail !== null,
          },
        });
        return next;
      } catch (err) {
        if (err instanceof RecoveryContactValidationError) {
          return reply.code(400).send({ error: 'invalid settings', message: err.message });
        }
        throw err;
      }
    },
  });
};
