import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getRegister,
  createBreach,
  updateBreach,
  deleteBreach,
  publicView,
  publicList,
  filterRegister,
  toCsv,
  validateCreate,
  BreachValidationError,
  BREACH_LIMITS,
} from '../services/breach-register.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Personal Data Breach Notification Register (GDPR Art. 33 / 34).
//
//   GET    /v1/breach-register             public list, no auth
//   GET    /v1/breach-register.csv         public CSV export, no auth
//   GET    /v1/breach-register/admin       admin+, full incl. internalNotes
//   GET    /v1/breach-register/:id         public per-breach view
//   POST   /v1/breach-register             owner+MFA, audited
//   PUT    /v1/breach-register/:id         owner+MFA, audited
//   DELETE /v1/breach-register/:id         owner+MFA, audited
//
// Unauthenticated GETs are intentional: enterprise procurement DPAs
// link to the URL from the buyer's own register, so requiring auth
// defeats the purpose. The admin GET adds internalNotes + updatedBy
// for compliance operators.

const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
const StatusSchema = z.enum(['open', 'contained', 'closed']);
const AuthStatusSchema = z.enum(['not_required', 'pending', 'notified', 'delayed']);
const SubjStatusSchema = z.enum(['not_required', 'pending', 'notified', 'public_communication']);

const BODY = z
  .object({
    reference: z.string().min(1).max(BREACH_LIMITS.reference),
    title: z.string().min(1).max(BREACH_LIMITS.title),
    summary: z.string().min(1).max(BREACH_LIMITS.summary),
    severity: SeveritySchema,
    status: StatusSchema,
    discoveredAt: z.number().int().positive(),
    occurredAt: z.number().int().positive().nullable().optional(),
    containedAt: z.number().int().positive().nullable().optional(),
    closedAt: z.number().int().positive().nullable().optional(),
    dataCategories: z.string().min(1).max(BREACH_LIMITS.dataCategories),
    dataSubjects: z.string().min(1).max(BREACH_LIMITS.dataSubjects),
    approxRecords: z.number().int().min(0).nullable().optional(),
    approxSubjects: z.number().int().min(0).nullable().optional(),
    likelyConsequences: z.string().min(1).max(BREACH_LIMITS.likelyConsequences),
    mitigations: z.string().min(1).max(BREACH_LIMITS.mitigations),
    authorityNotification: AuthStatusSchema,
    authorityName: z.string().max(BREACH_LIMITS.authorityName).nullable().optional(),
    authorityNotifiedAt: z.number().int().positive().nullable().optional(),
    delayJustification: z.string().max(BREACH_LIMITS.delayJustification).nullable().optional(),
    subjectNotification: SubjStatusSchema,
    subjectNotifiedAt: z.number().int().positive().nullable().optional(),
    contact: z.string().max(BREACH_LIMITS.contact).nullable().optional(),
    internalNotes: z.string().max(BREACH_LIMITS.internalNotes).nullable().optional(),
  })
  .strict();

const IdParam = z.object({ id: z.string().trim().min(1).max(64) });

function mapValidation(err: unknown, reply: any): boolean {
  if (err instanceof BreachValidationError) {
    if (err.message === 'breach not found') {
      reply.code(404).send({ error: 'breach not found' });
      return true;
    }
    reply.code(400).send({ error: 'invalid breach', message: err.message });
    return true;
  }
  return false;
}

export const breachRegisterRoutes: FastifyPluginAsyncZod = async (app) => {
  // Optional `q` filters entries by a case-insensitive substring of
  // reference, title, summary, dataCategories, or dataSubjects so a
  // DPO can pull "every breach touching backups" or grep for a ticket
  // id without scraping the full register. Mirrors the q filter on
  // /incidents, /sub-processors, /recovery-contacts, /pins, /mutes,
  // and /aliases.
  const QSchema = z.object({
    q: z.string().trim().min(1).max(200).optional(),
  });

  app.get<{ Querystring: { q?: string } }>('/breach-register', {
    schema: { querystring: QSchema },
    handler: async (req, reply) => {
      const reg = await getRegister(app.clawmind.dataDir);
      reply.header('cache-control', 'public, max-age=300');
      return publicList(filterRegister(reg, req.query.q));
    },
  });

  app.get<{ Querystring: { q?: string } }>('/breach-register.csv', {
    schema: { querystring: QSchema },
    handler: async (req, reply) => {
      const reg = await getRegister(app.clawmind.dataDir);
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="breach-register.csv"')
        .header('cache-control', 'public, max-age=300')
        .send(toCsv(filterRegister(reg, req.query.q)));
    },
  });

  // Operator view. Registered before /:id so the literal route wins.
  app.get('/breach-register/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.BreachRegisterRead),
    ],
    handler: async () => {
      const reg = await getRegister(app.clawmind.dataDir);
      return { entries: reg.entries, updatedAt: reg.updatedAt, updatedBy: reg.updatedBy };
    },
  });

  app.get('/breach-register/:id', {
    schema: { params: IdParam },
    handler: async (req, reply) => {
      const reg = await getRegister(app.clawmind.dataDir);
      const entry = reg.entries.find((e) => e.id === req.params.id);
      if (!entry) return reply.code(404).send({ error: 'breach not found' });
      reply.header('cache-control', 'public, max-age=300');
      return publicView(entry);
    },
  });

  app.post('/breach-register', {
    schema: { body: BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.BreachRegisterManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          validateCreate(req.body);
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('breach-register.create', true),
            resource: '/v1/breach-register',
            meta: { ip: req.ip, requestId: req.id, dryRun: true, reference: req.body.reference },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await createBreach(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('breach-register.create', false),
          resource: `/v1/breach-register/${next.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            reference: next.reference,
            severity: next.severity,
            status: next.status,
            authorityNotification: next.authorityNotification,
            subjectNotification: next.subjectNotification,
          },
        });
        return reply.code(201).send(next);
      } catch (err) {
        if (mapValidation(err, reply)) return;
        throw err;
      }
    },
  });

  app.put('/breach-register/:id', {
    schema: { params: IdParam, body: BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.BreachRegisterManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          validateCreate(req.body);
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('breach-register.update', true),
            resource: `/v1/breach-register/${req.params.id}`,
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await updateBreach(app.clawmind.dataDir, userId, req.params.id, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('breach-register.update', false),
          resource: `/v1/breach-register/${next.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            reference: next.reference,
            severity: next.severity,
            status: next.status,
            authorityNotification: next.authorityNotification,
          },
        });
        return reply.code(200).send(next);
      } catch (err) {
        if (mapValidation(err, reply)) return;
        throw err;
      }
    },
  });

  app.delete('/breach-register/:id', {
    schema: { params: IdParam, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.BreachRegisterManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      if (dryRun) {
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('breach-register.delete', true),
          resource: `/v1/breach-register/${req.params.id}`,
          meta: { ip: req.ip, requestId: req.id, dryRun: true },
        });
        return reply.code(200).send({ dryRun: true });
      }
      const ok = await deleteBreach(app.clawmind.dataDir, userId, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'breach not found' });
      await app.clawmind.audit.write({
        actor: userId,
        action: auditAction('breach-register.delete', false),
        resource: `/v1/breach-register/${req.params.id}`,
        meta: { ip: req.ip, requestId: req.id },
      });
      return reply.code(200).send({ deleted: true });
    },
  });
};
