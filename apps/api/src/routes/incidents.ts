import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  deleteIncident,
  publicView,
  publicList,
  filterIncidents,
  IncidentValidationError,
  INCIDENT_LIMITS,
} from '../services/incidents.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Security Incident Disclosure Log endpoints.
//
//   GET    /v1/incidents              public, no auth (procurement timeline)
//   GET    /v1/incidents/admin        admin+, full incl. privateNotes
//   GET    /v1/incidents/:id          public per-incident view
//   POST   /v1/incidents              owner+MFA, audited
//   PUT    /v1/incidents/:id          owner+MFA, audited
//   DELETE /v1/incidents/:id          owner+MFA, audited
//
// The unauthenticated GETs are the URLs a buyer's vendor-review tool
// will crawl; keeping them auth-free is the whole point of the feature.
// The admin GET surfaces operator-only metadata (privateNotes, updatedBy)
// that should never leak from an internet-exposed instance.

const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
const StatusSchema = z.enum(['investigating', 'identified', 'monitoring', 'resolved']);

const UpdateSchema = z
  .object({
    at: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    message: z.string().min(1).max(INCIDENT_LIMITS.updateMessage),
    status: StatusSchema,
  })
  .strict();

const BODY = z
  .object({
    title: z.string().min(1).max(INCIDENT_LIMITS.title),
    summary: z.string().max(INCIDENT_LIMITS.summary).optional(),
    severity: SeveritySchema,
    status: StatusSchema,
    startedAt: z.union([z.number().int().positive(), z.string().min(1)]),
    resolvedAt: z.union([z.number().int().positive(), z.string().min(1)]).nullable().optional(),
    affectedComponents: z.array(z.string().min(1).max(INCIDENT_LIMITS.component)).max(INCIDENT_LIMITS.maxComponents).optional(),
    customerDataImpacted: z.boolean().optional(),
    updates: z.array(UpdateSchema).max(INCIDENT_LIMITS.maxUpdates).optional(),
    privateNotes: z.string().max(INCIDENT_LIMITS.privateNotes).optional(),
  })
  .strict();

const IdParam = z.object({ id: z.string().trim().min(1).max(64) });

export const incidentsRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public list. This is the URL procurement reviewers and a buyer's
  // vendor-review tool will hit; if it 401s, the conversation ends
  // before it starts.
  //
  // Optional `q` filters entries by a case-insensitive substring of
  // the incident title, summary, or any affectedComponents entry so a
  // buyer's on-call can pull "every incident touching api" or grep the
  // disclosure log for a keyword without scraping the full timeline.
  // Mirrors the q filter on /sub-processors, /recovery-contacts,
  // /pins, /mutes, and /aliases.
  app.get<{ Querystring: { q?: string } }>('/incidents', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    handler: async (req, reply) => {
      const incidents = await listIncidents(app.clawmind.dataDir);
      const filtered = filterIncidents(incidents, req.query.q);
      reply.header('cache-control', 'public, max-age=300');
      return publicList(filtered);
    },
  });

  // Operator view of the full list. Surfaces privateNotes + updatedBy.
  // Registered before /incidents/:id so the literal route wins lookup.
  app.get('/incidents/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.IncidentsRead),
    ],
    handler: async () => {
      return { incidents: await listIncidents(app.clawmind.dataDir) };
    },
  });

  // Public per-incident view.
  app.get('/incidents/:id', {
    schema: { params: IdParam },
    handler: async (req, reply) => {
      const inc = await getIncident(app.clawmind.dataDir, req.params.id);
      if (!inc) return reply.code(404).send({ error: 'incident not found' });
      reply.header('cache-control', 'public, max-age=300');
      return publicView(inc);
    },
  });

  app.post('/incidents', {
    schema: { body: BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.IncidentsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('incidents.create', true),
            resource: '/v1/incidents',
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await createIncident(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('incidents.create', false),
          resource: `/v1/incidents/${next.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            severity: next.severity,
            status: next.status,
            customerDataImpacted: next.customerDataImpacted,
          },
        });
        return reply.code(201).send(next);
      } catch (err) {
        if (err instanceof IncidentValidationError) {
          return reply.code(400).send({ error: 'invalid incident', message: err.message });
        }
        throw err;
      }
    },
  });

  app.put('/incidents/:id', {
    schema: { params: IdParam, body: BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.IncidentsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('incidents.update', true),
            resource: `/v1/incidents/${req.params.id}`,
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await updateIncident(app.clawmind.dataDir, userId, req.params.id, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('incidents.update', false),
          resource: `/v1/incidents/${next.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            severity: next.severity,
            status: next.status,
            customerDataImpacted: next.customerDataImpacted,
          },
        });
        return reply.code(200).send(next);
      } catch (err) {
        if (err instanceof IncidentValidationError) {
          if (err.message === 'incident not found') {
            return reply.code(404).send({ error: 'incident not found' });
          }
          return reply.code(400).send({ error: 'invalid incident', message: err.message });
        }
        throw err;
      }
    },
  });

  app.delete('/incidents/:id', {
    schema: { params: IdParam, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.IncidentsManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      if (dryRun) {
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('incidents.delete', true),
          resource: `/v1/incidents/${req.params.id}`,
          meta: { ip: req.ip, requestId: req.id, dryRun: true },
        });
        return reply.code(200).send({ dryRun: true });
      }
      const ok = await deleteIncident(app.clawmind.dataDir, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'incident not found' });
      await app.clawmind.audit.write({
        actor: userId,
        action: auditAction('incidents.delete', false),
        resource: `/v1/incidents/${req.params.id}`,
        meta: { ip: req.ip, requestId: req.id },
      });
      return reply.code(200).send({ deleted: true });
    },
  });
};
