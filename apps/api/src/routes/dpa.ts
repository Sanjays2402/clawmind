import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  listVersions,
  getVersion,
  currentVersion,
  recordAcceptance,
  listAcceptances,
  getAcceptance,
  currentAcceptance,
  verifySignature,
  validateAccept,
  canonicalReceipt,
  DpaValidationError,
  DPA_LIMITS,
  type DpaAcceptance,
} from '../services/dpa.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Data Processing Agreement (DPA) endpoints.
//
//   GET    /v1/dpa/versions                  public, no auth   (buyer diff)
//   GET    /v1/dpa/versions/:id              public, no auth   (full body + fingerprint)
//   GET    /v1/dpa/status                    public, no auth   (is a DPA on file?)
//   GET    /v1/dpa/acceptances               admin+, full list incl. IP + actor
//   GET    /v1/dpa/acceptances/:id           admin+, single record
//   GET    /v1/dpa/acceptances/:id/receipt   admin+, exportable signed receipt
//   POST   /v1/dpa/acceptances/:id/verify    admin+, re-verify signature server-side
//   POST   /v1/dpa/accept                    owner+MFA, record acceptance + audit
//
// The public version + status endpoints are unauthenticated because
// they are exactly what a buyer's procurement reviewer needs before
// they have credentials to the workspace. The acceptance ledger
// (signatory PII, IP) is admin-only.

const ACCEPT_BODY = z
  .object({
    versionId: z.string().min(1).max(64).optional(),
    signatoryName: z.string().min(1).max(DPA_LIMITS.signatoryName),
    signatoryTitle: z.string().min(1).max(DPA_LIMITS.signatoryTitle),
    signatoryEmail: z.string().email().max(DPA_LIMITS.signatoryEmail),
    notes: z.string().max(DPA_LIMITS.notes).nullable().optional(),
  })
  .strict();

const ID_PARAMS = z.object({ id: z.string().min(1).max(64) });
const VERSION_PARAMS = z.object({ id: z.string().min(1).max(64) });

function publicVersion(v: ReturnType<typeof listVersions>[number]) {
  return {
    id: v.id,
    label: v.label,
    effective: v.effective,
    fingerprint: v.fingerprint,
    changelog: v.changelog,
    bodyBytes: Buffer.byteLength(v.body, 'utf8'),
  };
}

function publicAcceptance(a: DpaAcceptance) {
  // Status view: do NOT leak signatory PII or IP to unauthenticated
  // callers. The buyer just needs proof that a DPA is on file and
  // which version.
  return {
    versionId: a.versionId,
    versionLabel: a.versionLabel,
    versionFingerprint: a.versionFingerprint,
    acceptedAt: a.acceptedAt,
  };
}

export const dpaRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public list of versions. Stable URL a buyer can cite.
  app.get('/dpa/versions', {
    handler: async () => ({ versions: listVersions().map(publicVersion) }),
  });

  // Public full body of a single version. Allows the buyer to diff the
  // exact bytes against their own copy before countersignature.
  app.get('/dpa/versions/:id', {
    schema: { params: VERSION_PARAMS },
    handler: async (req, reply) => {
      const v = getVersion(req.params.id);
      if (!v) return reply.code(404).send({ error: 'not found' });
      return {
        ...publicVersion(v),
        body: v.body,
      };
    },
  });

  // Public status: is a DPA on file, and against which version?
  app.get('/dpa/status', {
    handler: async () => {
      const latest = currentVersion();
      const accepted = await currentAcceptance(app.clawmind.dataDir);
      return {
        latestVersion: publicVersion(latest),
        accepted: accepted ? publicAcceptance(accepted) : null,
        upToDate: accepted ? accepted.versionId === latest.id : false,
      };
    },
  });

  // Admin full list including signatory PII and capturing IP. Read-only.
  app.get('/dpa/acceptances', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DpaRead),
    ],
    handler: async () => {
      const acceptances = await listAcceptances(app.clawmind.dataDir);
      return { acceptances };
    },
  });

  app.get('/dpa/acceptances/:id', {
    schema: { params: ID_PARAMS },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DpaRead),
    ],
    handler: async (req, reply) => {
      const a = await getAcceptance(app.clawmind.dataDir, req.params.id);
      if (!a) return reply.code(404).send({ error: 'not found' });
      return a;
    },
  });

  // Exportable signed receipt. This is the file the buyer's legal team
  // archives alongside the countersigned MSA. The receipt contains the
  // canonical bytes the signature was computed over, so an offline
  // verifier with the same secret can re-check it without contacting
  // the server.
  app.get('/dpa/acceptances/:id/receipt', {
    schema: { params: ID_PARAMS },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DpaRead),
    ],
    handler: async (req, reply) => {
      const a = await getAcceptance(app.clawmind.dataDir, req.params.id);
      if (!a) return reply.code(404).send({ error: 'not found' });
      const canonical = canonicalReceipt({
        id: a.id,
        workspaceId: a.workspaceId,
        versionId: a.versionId,
        versionFingerprint: a.versionFingerprint,
        signatoryName: a.signatoryName,
        signatoryTitle: a.signatoryTitle,
        signatoryEmail: a.signatoryEmail,
        acceptedByUserId: a.acceptedByUserId,
        acceptedAt: a.acceptedAt,
      });
      reply.header(
        'content-disposition',
        `attachment; filename="dpa-receipt-${a.id}.json"`,
      );
      return {
        receipt: {
          id: a.id,
          workspaceId: a.workspaceId,
          versionId: a.versionId,
          versionLabel: a.versionLabel,
          versionFingerprint: a.versionFingerprint,
          signatoryName: a.signatoryName,
          signatoryTitle: a.signatoryTitle,
          signatoryEmail: a.signatoryEmail,
          acceptedByUserId: a.acceptedByUserId,
          acceptedAt: a.acceptedAt,
          acceptedFromIp: a.acceptedFromIp,
          notes: a.notes,
        },
        canonical,
        algo: a.algo,
        signature: a.signature,
      };
    },
  });

  // Server-side re-verification. Useful for the admin UI to render a
  // green tick next to each acceptance after a config restore.
  app.post('/dpa/acceptances/:id/verify', {
    schema: { params: ID_PARAMS },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.DpaRead),
    ],
    handler: async (req, reply) => {
      const a = await getAcceptance(app.clawmind.dataDir, req.params.id);
      if (!a) return reply.code(404).send({ error: 'not found' });
      const ok = await verifySignature(app.clawmind.dataDir, a);
      return { ok };
    },
  });

  // Owner-only, MFA-gated. Records the binding acceptance.
  app.post('/dpa/accept', {
    schema: { body: ACCEPT_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.DpaManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          const preview = validateAccept(req.body);
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('dpa.accept', true),
            resource: '/v1/dpa/accept',
            meta: {
              ip: req.ip,
              requestId: req.id,
              versionId: preview.versionId,
              signatoryEmail: preview.signatoryEmail,
            },
          });
          return reply.code(200).send({ dryRun: true, preview });
        }
        const acceptance = await recordAcceptance(app.clawmind.dataDir, req.body, {
          acceptedByUserId: userId,
          acceptedFromIp: req.ip,
        });
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('dpa.accept', false),
          resource: '/v1/dpa/accept',
          meta: {
            ip: req.ip,
            requestId: req.id,
            id: acceptance.id,
            versionId: acceptance.versionId,
            versionLabel: acceptance.versionLabel,
            versionFingerprint: acceptance.versionFingerprint,
            signatoryEmail: acceptance.signatoryEmail,
            signatoryName: acceptance.signatoryName,
            signatoryTitle: acceptance.signatoryTitle,
          },
        });
        return reply.code(201).send({ acceptance });
      } catch (err) {
        if (err instanceof DpaValidationError) {
          return reply
            .code(400)
            .send({ error: 'invalid acceptance', field: err.field, message: err.message });
        }
        throw err;
      }
    },
  });
};
