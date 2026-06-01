import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createRequest,
  verifyRequest,
  listRequests,
  getRequest,
  updateRequest,
  publicView,
  DsrValidationError,
  DSR_KINDS,
  MAX_DETAILS,
  MAX_NOTE,
  MAX_EMAIL,
  type DsrStatus,
} from '../services/dsr.js';
import {
  issueCertificate,
  listCertificates,
  getCertificate,
  findByDsr,
  verifySignature,
  subjectEmailMatches,
  publicView as certPublicView,
  CertificateValidationError,
} from '../services/erasure-certificates.js';
import { Scopes } from '../scopes.js';

// Data Subject Request (DSR) queue endpoints.
//
//   POST /v1/dsr/submit                  PUBLIC, no auth (GDPR statutory)
//   GET  /v1/dsr/verify/:id/:token       PUBLIC, no auth (subject confirms email)
//   GET  /v1/dsr                         admin+ (list / triage)
//   GET  /v1/dsr/:id                     admin+
//   PATCH /v1/dsr/:id                    owner + MFA (status / note)
//
// The public submission endpoint is the whole reason this module exists:
// a non-member whose personal data may have been ingested into the
// workspace must be able to request access or erasure without an
// account. We rate-limit it through the global limiter (per IP) that
// already protects the unauthenticated /v1/sub-processors path and cap
// the queue size in the service layer to bound disk usage during
// abuse waves.
//
// The verify step exists so the queue cannot be poisoned by spoofed
// emails. The plaintext token is returned exactly once in the POST
// response and must be carried back via the verify URL before the
// request becomes visible on the admin queue as 'pending'.

const SubmitBody = z
  .object({
    subjectEmail: z.string().min(3).max(MAX_EMAIL),
    kind: z.enum(DSR_KINDS as readonly [string, ...string[]]),
    details: z.string().max(MAX_DETAILS).optional().nullable(),
    workspaceId: z.string().min(1).max(200).optional().nullable(),
    // Honeypot: bots fill every field. Real form leaves this blank.
    // We accept the submission but quietly drop it (200 with a fake id)
    // so the bot does not learn the trap. The fake id is non-routable.
    website: z.string().optional(),
  })
  .strict();

const UpdateBody = z
  .object({
    status: z.enum(['pending', 'acknowledged', 'fulfilled', 'rejected']).optional(),
    note: z.string().max(MAX_NOTE).nullable().optional(),
  })
  .strict()
  .refine((b) => b.status !== undefined || b.note !== undefined, {
    message: 'at least one of status, note required',
  });

const IdParam = z.object({ id: z.string().min(1).max(80) });
const VerifyParam = z.object({
  id: z.string().min(1).max(80),
  token: z.string().min(8).max(120),
});

const ListQuery = z.object({
  status: z.enum(['unverified', 'pending', 'acknowledged', 'fulfilled', 'rejected']).optional(),
});

function handleValidation(err: unknown, reply: import('fastify').FastifyReply) {
  if (err instanceof DsrValidationError) {
    return reply.code(400).send({
      error: { code: 'dsr_validation', field: err.field, message: err.message },
    });
  }
  throw err;
}

export const dsrRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------- Public submission ----------
  app.post('/dsr/submit', {
    schema: { body: SubmitBody },
    handler: async (req, reply) => {
      const body = req.body as z.infer<typeof SubmitBody>;

      // Honeypot tripped: respond 202 with a non-routable id so the bot
      // sees a success but the row is never created and there is no
      // verify token to follow.
      if (body.website && body.website.trim().length > 0) {
        return reply.code(202).send({ id: 'dsr_honeypot', status: 'unverified' });
      }

      try {
        const { record, verifyToken } = await createRequest(app.clawmind.dataDir, {
          subjectEmail: body.subjectEmail,
          kind: body.kind as (typeof DSR_KINDS)[number],
          details: body.details ?? null,
          workspaceId: body.workspaceId ?? null,
          submitterIp: req.ip ?? null,
        });
        await app.clawmind.audit.write({
          actor: 'public',
          action: 'dsr.submit',
          resource: `/v1/dsr/${record.id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            kind: record.kind,
            workspaceId: record.workspaceId,
            ipHash: record.submitterIpHash,
          },
        });
        return reply.code(201).send({
          id: record.id,
          status: record.status,
          // Subject must follow this URL (or POST the token back) to
          // confirm control of the email. We return both for clients
          // that want to mail the link themselves.
          verifyToken,
          verifyPath: `/v1/dsr/verify/${encodeURIComponent(record.id)}/${encodeURIComponent(verifyToken)}`,
        });
      } catch (err) {
        return handleValidation(err, reply);
      }
    },
  });

  // ---------- Public verify ----------
  app.get('/dsr/verify/:id/:token', {
    schema: { params: VerifyParam },
    handler: async (req, reply) => {
      const { id, token } = req.params as z.infer<typeof VerifyParam>;
      const r = await verifyRequest(app.clawmind.dataDir, id, token);
      if (!r) {
        await app.clawmind.audit.write({
          actor: 'public',
          action: 'dsr.verify.fail',
          resource: `/v1/dsr/${id}`,
          meta: { ip: req.ip, requestId: req.id },
        });
        return reply.code(404).send({
          error: { code: 'dsr_verify_failed', message: 'invalid or expired verification' },
        });
      }
      await app.clawmind.audit.write({
        actor: 'public',
        action: 'dsr.verify',
        resource: `/v1/dsr/${id}`,
        meta: { ip: req.ip, requestId: req.id, kind: r.kind },
      });
      return reply.code(200).send({ request: publicView(r) });
    },
  });

  // ---------- Admin list ----------
  app.get('/dsr', {
    schema: { querystring: ListQuery },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DsrRead),
    ],
    handler: async (req) => {
      const { status } = req.query as z.infer<typeof ListQuery>;
      const rows = await listRequests(app.clawmind.dataDir, { status: status as DsrStatus | undefined });
      return { requests: rows };
    },
  });

  // ---------- Admin single ----------
  app.get('/dsr/:id', {
    schema: { params: IdParam },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DsrRead),
    ],
    handler: async (req, reply) => {
      const { id } = req.params as z.infer<typeof IdParam>;
      const r = await getRequest(app.clawmind.dataDir, id);
      if (!r) return reply.code(404).send({ error: { code: 'not_found' } });
      return { request: r };
    },
  });

  // ---------- Owner update (status / note) ----------
  app.patch('/dsr/:id', {
    schema: { params: IdParam, body: UpdateBody },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.DsrManage),
    ],
    handler: async (req, reply) => {
      const { id } = req.params as z.infer<typeof IdParam>;
      const body = req.body as z.infer<typeof UpdateBody>;
      try {
        const updated = await updateRequest(
          app.clawmind.dataDir,
          id,
          req.user!.id,
          body,
        );
        if (!updated) return reply.code(404).send({ error: { code: 'not_found' } });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'dsr.update',
          resource: `/v1/dsr/${id}`,
          meta: {
            ip: req.ip,
            requestId: req.id,
            status: updated.status,
            noteChanged: body.note !== undefined,
          },
        });

        // GDPR Article 17 erasure receipt: when an erasure request
        // transitions to fulfilled, mint an externally-verifiable
        // destruction certificate the subject can hand to their auditor.
        // Idempotent: issueCertificate returns the existing row if one
        // already exists for this DSR id.
        let certificateId: string | undefined;
        if (updated.kind === 'erasure' && updated.status === 'fulfilled' && updated.resolvedAt) {
          try {
            const cert = await issueCertificate(app.clawmind.dataDir, {
              dsrId: updated.id,
              workspaceId: updated.workspaceId,
              subjectEmail: updated.subjectEmail,
              scope: updated.note ?? updated.details ?? '',
              fulfilledBy: req.user!.id,
              fulfilledAt: updated.resolvedAt,
            });
            certificateId = cert.id;
            await app.clawmind.audit.write({
              actor: req.user!.id,
              action: 'erasure-certificate.issue',
              resource: `/v1/erasure-certificates/${cert.id}`,
              meta: {
                ip: req.ip,
                requestId: req.id,
                dsrId: updated.id,
                contentFingerprint: cert.contentFingerprint,
              },
            });
          } catch (err) {
            if (err instanceof CertificateValidationError) {
              return reply.code(400).send({
                error: {
                  code: 'erasure_certificate_validation',
                  field: err.field,
                  message: err.message,
                },
              });
            }
            throw err;
          }
        }
        return { request: updated, ...(certificateId ? { certificateId } : {}) };
      } catch (err) {
        return handleValidation(err, reply);
      }
    },
  });

  // ---------- Erasure certificates ----------
  // Public read: a data subject (or their auditor) follows the URL the
  // workspace gave them and gets the signed receipt. We deliberately
  // never list publicly; the holder must know the certificate id or
  // the DSR id they originally submitted.
  app.get('/erasure-certificates/:id', {
    schema: { params: z.object({ id: z.string().min(1).max(80) }) },
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const cert = await getCertificate(app.clawmind.dataDir, id);
      if (!cert) return reply.code(404).send({ error: { code: 'not_found' } });
      const valid = await verifySignature(app.clawmind.dataDir, cert);
      return reply.code(200).send({ certificate: certPublicView(cert), signatureValid: valid });
    },
  });

  app.get('/erasure-certificates/by-dsr/:dsrId', {
    schema: { params: z.object({ dsrId: z.string().min(1).max(80) }) },
    handler: async (req, reply) => {
      const { dsrId } = req.params as { dsrId: string };
      const cert = await findByDsr(app.clawmind.dataDir, dsrId);
      if (!cert) return reply.code(404).send({ error: { code: 'not_found' } });
      const valid = await verifySignature(app.clawmind.dataDir, cert);
      return reply.code(200).send({ certificate: certPublicView(cert), signatureValid: valid });
    },
  });

  // Public verify: subject proves ownership of the deletion receipt by
  // replaying the email they originally submitted. Body uses POST so the
  // email never lands in access logs / referrer headers.
  app.post('/erasure-certificates/:id/verify', {
    schema: {
      params: z.object({ id: z.string().min(1).max(80) }),
      body: z.object({ subjectEmail: z.string().min(3).max(MAX_EMAIL) }).strict(),
    },
    handler: async (req, reply) => {
      const { id } = req.params as { id: string };
      const { subjectEmail } = req.body as { subjectEmail: string };
      const cert = await getCertificate(app.clawmind.dataDir, id);
      if (!cert) return reply.code(404).send({ error: { code: 'not_found' } });
      const signatureValid = await verifySignature(app.clawmind.dataDir, cert);
      const subjectMatches = subjectEmailMatches(cert, subjectEmail);
      return reply.code(200).send({
        certificateId: cert.id,
        dsrId: cert.dsrId,
        signatureValid,
        subjectMatches,
        verified: signatureValid && subjectMatches && !cert.revokedAt,
        revokedAt: cert.revokedAt,
      });
    },
  });

  // Admin list: triage view of every receipt the workspace has minted.
  app.get('/erasure-certificates', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.ErasureCertificatesRead),
    ],
    handler: async () => {
      const rows = await listCertificates(app.clawmind.dataDir);
      return { certificates: rows };
    },
  });
};
