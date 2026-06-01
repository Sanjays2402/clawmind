import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { Scopes } from '../scopes.js';
import {
  issueCanaryKey,
  listCanaryKeys,
  revokeKey,
  redact,
  findKeyById,
  loadKeys,
} from '../services/api-keys.js';
import {
  listIncidents,
  clearIncidents,
} from '../services/api-key-honeytokens.js';

// Honeytoken (canary) API keys. See services/api-key-honeytokens.ts for
// the full rationale. These routes are intentionally scoped under
// /v1/keys/canary so they sit next to regular key management in the
// admin console, but never appear in the regular /v1/keys listing.

const IssueBody = z.object({
  label: z.string().min(1).max(80),
  note: z.string().max(500).nullable().optional(),
});

const IncidentsQuery = z.object({
  keyId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const honeytokenRoutes: FastifyPluginAsyncZod = async (app) => {
  // List existing canaries. Surfaces label, note, createdAt, revokedAt
  // and tripCount so an operator can see at a glance which traps are
  // armed and which have fired. Owner+MFA gated.
  app.get('/keys/canary', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.KeysManage)],
    handler: async (req) => {
      const keys = await listCanaryKeys(app.clawmind.dataDir, req.user!.id);
      const incidents = await listIncidents(app.clawmind.dataDir);
      const tripCounts = new Map<string, number>();
      for (const inc of incidents) {
        tripCounts.set(inc.keyId, (tripCounts.get(inc.keyId) ?? 0) + 1);
      }
      const items = keys.map((k) => ({
        ...redact(k),
        tripCount: tripCounts.get(k.id) ?? 0,
      }));
      return {
        items,
        totalIncidents: incidents.length,
      };
    },
  });

  app.post('/keys/canary', {
    schema: { body: IssueBody },
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req) => {
      const issued = await issueCanaryKey(app.clawmind.dataDir, {
        userId: req.user!.id,
        label: req.body.label,
        note: req.body.note ?? null,
      });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'api_key.honeytoken.issued',
        resource: issued.record.id,
        meta: { label: issued.record.label, note: issued.record.canaryNote ?? null },
      });
      return { key: redact(issued.record), secret: issued.secret };
    },
  });

  app.delete<{ Params: { id: string } }>('/keys/canary/:id', {
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req, reply) => {
      const rec = await findKeyById(app.clawmind.dataDir, req.params.id);
      if (!rec || rec.userId !== req.user!.id || rec.isCanary !== true) {
        return reply.code(404).send({ error: 'not found' });
      }
      const ok = await revokeKey(app.clawmind.dataDir, req.user!.id, req.params.id);
      if (!ok) return reply.code(404).send({ error: 'not found' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'api_key.honeytoken.revoked',
        resource: req.params.id,
      });
      return { ok: true };
    },
  });

  // Forensic incident log. Newest first. Optional keyId filter so an
  // operator can drill into a specific trap.
  app.get<{ Querystring: z.infer<typeof IncidentsQuery> }>('/keys/canary/incidents', {
    schema: { querystring: IncidentsQuery },
    preHandler: [app.requireAuth, app.requireScope(Scopes.KeysManage)],
    handler: async (req) => {
      const items = await listIncidents(app.clawmind.dataDir, {
        keyId: req.query.keyId,
        limit: req.query.limit,
      });
      return { items };
    },
  });

  // Owner-only clear. Useful after an incident has been triaged and
  // exported to the long-term SIEM via the audit drain.
  app.delete('/keys/canary/incidents', {
    preHandler: [app.requireRole('owner'), app.requireMfa, app.requireScope(Scopes.KeysManage)],
    handler: async (req) => {
      const removed = await clearIncidents(app.clawmind.dataDir);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'api_key.honeytoken.incidents.cleared',
        resource: 'all',
        meta: { removed },
      });
      return { ok: true, removed };
    },
  });

  // Internal use only: silence the unused import lint when loadKeys
  // is not referenced. Kept available for future debug endpoints.
  void loadKeys;
};
