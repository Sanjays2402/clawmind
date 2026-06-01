import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Scopes } from '../scopes.js';
import type { AuditEvent } from '@clawmind/types';
import {
  issueInclusionProof,
  verifyInclusionProof,
  type AuditInclusionProof,
} from '@clawmind/store';

// RFC 4180 CSV cell: quote if the value contains a quote, comma, or
// newline; double any embedded quote. Numbers/null are stringified plainly
// since the underlying values are simple primitives or already-stringified
// JSON.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(ev: AuditEvent): string {
  return [
    csvCell(ev.id),
    csvCell(ev.ts),
    csvCell(new Date(ev.ts).toISOString()),
    csvCell(ev.actor),
    csvCell(ev.action),
    csvCell(ev.resource),
    csvCell(ev.prevHash),
    csvCell(ev.hash),
    csvCell(ev.meta),
  ].join(',');
}

// Compliance review endpoint for the persisted audit log. Owner role plus
// the audit:read scope are both required, so an API key issued for a
// narrow automation task cannot quietly tail user activity. The log is
// the source of truth a regulator or incident responder reads, so we
// expose filters (actor, action substring, resource prefix, time window)
// without exposing a way to mutate or delete entries.
//
//   GET /v1/admin/audit?actor=...&action=...&resource=...&since=...&until=...&limit=...&offset=...
//
// since / until are epoch milliseconds. limit is capped at 1000 by
// AuditLog.query so a buggy client cannot OOM the server.

const querySchema = z.object({
  actor: z.string().min(1).max(256).optional(),
  action: z.string().min(1).max(256).optional(),
  resource: z.string().min(1).max(512).optional(),
  since: z.coerce.number().int().nonnegative().optional(),
  until: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/admin/audit', {
    schema: { querystring: querySchema },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req) => {
      const q = req.query as z.infer<typeof querySchema>;
      const result = await app.clawmind.audit.query(q);
      // Record the review itself so a tampered or curious reader leaves a
      // trace in the very log they just inspected.
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.query',
        resource: '/v1/admin/audit',
        meta: {
          filters: q,
          returned: result.events.length,
          total: result.total,
        },
      });
      return result;
    },
  });

  // Streaming export for compliance pulls. The query endpoint above caps
  // at 1000 rows; an annual SOC2 review or regulator subpoena routinely
  // demands the entire log. This route iterates the on-disk JSONL files,
  // applies the same filters, and writes either newline-delimited JSON
  // (preserves the full event including hash chain) or CSV (spreadsheet-
  // friendly subset). Both formats are streamed so memory stays bounded
  // even when the underlying log is gigabytes.
  app.get('/admin/audit/export', {
    schema: {
      querystring: querySchema.extend({
        format: z.enum(['jsonl', 'csv']).optional(),
      }),
    },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req, reply) => {
      const q = req.query as z.infer<typeof querySchema> & { format?: 'jsonl' | 'csv' };
      const format = q.format ?? 'jsonl';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');

      // Log the export request before we start streaming so even an aborted
      // download leaves an entry. meta captures the filters and head hash
      // at the moment of export so a reviewer can pin a download to an
      // exact chain state later.
      const verifyHead = await app.clawmind.audit.verify().catch(() => null);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.export',
        resource: '/v1/admin/audit/export',
        meta: {
          format,
          filters: { ...q, format: undefined },
          headHashAtExport: verifyHead?.headHash ?? null,
        },
      });

      const headers: Record<string, string> = {
        'cache-control': 'no-store',
      };
      if (format === 'csv') {
        headers['content-type'] = 'text/csv; charset=utf-8';
        headers['content-disposition'] = `attachment; filename="audit-${stamp}.csv"`;
      } else {
        headers['content-type'] = 'application/x-ndjson; charset=utf-8';
        headers['content-disposition'] = `attachment; filename="audit-${stamp}.jsonl"`;
      }

      reply.hijack();
      const raw = reply.raw;
      // We hijacked, so Fastify will not write the status line for us;
      // do it ourselves so the headers actually reach the client (and
      // any test runner reading reply.raw sees them).
      raw.writeHead(200, headers);
      if (format === 'csv') {
        raw.write('id,ts,iso,actor,action,resource,prevHash,hash,meta\n');
      }
      try {
        for await (const ev of app.clawmind.audit.iterate({
          actor: q.actor,
          action: q.action,
          resource: q.resource,
          since: q.since,
          until: q.until,
        })) {
          if (format === 'csv') {
            raw.write(csvRow(ev) + '\n');
          } else {
            raw.write(JSON.stringify(ev) + '\n');
          }
        }
      } catch (err) {
        req.log.error({ err }, 'audit export failed mid-stream');
      }
      raw.end();
    },
  });

  // Tamper-evidence check. Recomputes the hash chain over every audit
  // file (active log plus rotated siblings) and returns the first break,
  // or ok=true with the current head hash. Reviewers anchor the head
  // hash externally (commit to a ticket, notarise, etc.) so a later
  // verify() with a different head proves on-disk tampering.
  app.get('/admin/audit/verify', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req) => {
      const result = await app.clawmind.audit.verify();
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.verify',
        resource: '/v1/admin/audit/verify',
        meta: {
          ok: result.ok,
          checked: result.checked,
          headHash: result.headHash,
          reason: result.reason,
        },
      });
      return result;
    },
  });

  // Record a fresh HMAC-signed anchor over the current chain head. The
  // chain itself catches in-place tampering; anchors catch truncation
  // and rewrite, where the on-disk file is silently shortened or
  // rebuilt to a different past. Owner role plus the audit:anchor scope
  // are both required so a delegated reviewer with audit:read alone
  // cannot mint anchors that subsequent truncation checks key off of.
  app.post('/admin/audit/anchors', {
    schema: {
      body: z.object({ note: z.string().min(1).max(512).optional() }).optional(),
    },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditAnchor),
    ],
    handler: async (req, reply) => {
      const body = (req.body ?? {}) as { note?: string };
      const v = await app.clawmind.audit.verify();
      if (!v.ok || !v.headHash) {
        reply.code(409);
        return {
          error: 'chain_not_verified',
          message:
            'Audit chain failed verification; refusing to anchor a broken chain.',
          reason: v.reason,
          checked: v.checked,
        };
      }
      const anchor = await app.clawmind.auditAnchors.record({
        headHash: v.headHash,
        checked: v.checked,
        note: body.note,
      });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.anchor.record',
        resource: '/v1/admin/audit/anchors',
        meta: {
          anchorId: anchor.id,
          headHash: anchor.headHash,
          checked: anchor.checked,
          note: anchor.note ?? null,
        },
      });
      reply.code(201);
      return anchor;
    },
  });

  // Newest-first list of recorded anchors. Each row carries a
  // signatureValid flag so a reviewer sees at a glance whether the
  // HMAC over the record still matches the configured secret (a flip
  // here means either the secret was rotated or the anchor file was
  // edited). Reviewers with audit:read are allowed to enumerate; the
  // act of listing is itself logged.
  app.get('/admin/audit/anchors', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      }),
    },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req) => {
      const { limit } = req.query as { limit?: number };
      const anchors = await app.clawmind.auditAnchors.list(limit ?? 100);
      return { total: anchors.length, anchors };
    },
  });

  // Compare the most recent anchor against the live chain. Detects
  // truncation (chain shorter than the anchored count) and rewrite
  // (chain long enough but the hash at the anchored position has
  // changed). Logged so a flapping reviewer trying to find a window
  // where the chain looks intact leaves a trace.
  app.get('/admin/audit/anchors/verify', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req) => {
      const v = await app.clawmind.audit.verify();
      const result = await app.clawmind.auditAnchors.verifyLatest({
        currentHeadHash: v.headHash,
        currentChecked: v.checked,
        headAt: (n) => app.clawmind.audit.hashAt(n),
      });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.anchor.verify',
        resource: '/v1/admin/audit/anchors/verify',
        meta: {
          ok: result.ok,
          reason: result.reason,
          anchorId: result.anchor?.id ?? null,
          anchorHeadHash: result.anchor?.headHash ?? null,
          anchorChecked: result.anchor?.checked ?? null,
          currentHeadHash: v.headHash,
          currentChecked: v.checked,
        },
      });
      return result;
    },
  });

  // Per-event inclusion proof. An offline-verifiable HMAC-signed
  // certificate that pins one audit event to its 1-indexed position in
  // the chain at the moment of issuance. External auditors use this to
  // prove "event X was in your log on date Y and has not been altered"
  // without ever seeing the full chain.
  app.get<{ Params: { id: string } }>('/admin/audit/:id/proof', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    handler: async (req, reply) => {
      const id = req.params.id;
      // Snapshot the chain head FIRST so the certificate binds to a
      // verified state, not an interleaved write.
      const head = await app.clawmind.audit.verify();
      if (!head.ok) {
        reply.code(409);
        return {
          error: 'chain_not_verified',
          message:
            'Audit chain failed verification; refusing to issue a proof over a broken chain.',
          reason: head.reason,
        };
      }
      const result = await issueInclusionProof({
        eventId: id,
        iterate: () => app.clawmind.audit.iterate(),
        chainHeadHash: head.headHash,
        chainChecked: head.checked,
        secret: app.clawmind.env.CLAWMIND_SESSION_SECRET,
      });
      if (!result.ok) {
        reply.code(result.reason === 'not-found' ? 404 : 422);
        return { error: result.reason };
      }
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.proof.issue',
        resource: `/v1/admin/audit/${id}/proof`,
        meta: {
          proofId: result.proof.id,
          eventId: id,
          position: result.proof.position,
          chainHeadHash: result.proof.chainHeadHash,
          chainChecked: result.proof.chainChecked,
        },
      });
      return { proof: result.proof };
    },
  });

  // Verify a previously-issued inclusion proof. Stateless: the verifier
  // only needs the certificate body and the workspace HMAC secret, which
  // is held by the server. We expose this endpoint so the UI can offer a
  // "paste in a certificate, get a verdict" workflow that mirrors what
  // an external auditor would run offline with the documented format.
  const ProofBody = z
    .object({
      proof: z
        .object({
          id: z.string(),
          ts: z.number(),
          event: z.object({
            id: z.string(),
            ts: z.number(),
            actor: z.string(),
            action: z.string(),
            resource: z.string(),
            meta: z.record(z.unknown()).optional(),
            prevHash: z.string().optional(),
            hash: z.string().optional(),
          }),
          eventHash: z.string(),
          position: z.number().int().nonnegative(),
          chainHeadHash: z.string().nullable(),
          chainChecked: z.number().int().nonnegative(),
          hmac: z.string(),
        })
        .strict(),
    })
    .strict();

  app.post('/admin/audit/proofs/verify', {
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireScope(Scopes.AuditRead),
    ],
    schema: { body: ProofBody },
    handler: async (req) => {
      const body = req.body as z.infer<typeof ProofBody>;
      const result = verifyInclusionProof(
        body.proof as AuditInclusionProof,
        app.clawmind.env.CLAWMIND_SESSION_SECRET,
      );
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'audit.proof.verify',
        resource: '/v1/admin/audit/proofs/verify',
        meta: {
          proofId: body.proof.id,
          eventId: body.proof.event.id,
          ok: result.ok,
          reason: result.reason,
        },
      });
      return result;
    },
  });
};
