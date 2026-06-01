import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getAttestation,
  updateAttestation,
  signCurrent,
  renderCycloneDx,
  collectComponents,
  publicAttestation,
  resolveRepoRoot,
  canonicalHash,
  SBOM_LIMITS,
  SbomValidationError,
} from '../services/sbom.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Software Bill of Materials (CycloneDX 1.5) endpoints.
//
//   GET /v1/sbom.json                       public, no auth (CycloneDX 1.5)
//   GET /v1/sbom/summary                    public, no auth (counts + signature)
//   GET /v1/sbom/admin                      admin+, full incl. updatedBy
//   PUT /v1/admin/sbom/attestation          owner+MFA, audit
//   POST /v1/admin/sbom/attestation/sign    owner+MFA, audit
//
// The unauthenticated GET is the URL a buyer's vulnerability-management
// pipeline (Anchore, Snyk, Dependency-Track) ingests; if it 401s the
// procurement review ends. Mutations are owner+MFA because the
// attestation overlay is a publicly visible vendor statement: a silent
// edit to the repository URL or build commit is a supply-chain event.
//
// Components themselves are derived at request time from on-disk
// package.json files so a malicious admin cannot quietly drop a
// vulnerable library from the published SBOM.

const ATTESTATION_BODY = z
  .object({
    vendor: z.string().max(SBOM_LIMITS.vendor).optional(),
    repository: z.string().max(SBOM_LIMITS.repository).optional(),
    commit: z.string().max(SBOM_LIMITS.commit).optional(),
    notes: z.string().max(SBOM_LIMITS.notes).optional(),
  })
  .strict();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const sbomRoutes: FastifyPluginAsyncZod = async (app) => {
  const repoRoot = await resolveRepoRoot(process.cwd());

  async function buildDoc() {
    const attestation = await getAttestation(app.clawmind.dataDir);
    return renderCycloneDx({
      repoRoot,
      rootName: 'clawmind',
      rootVersion: '0.1.0',
      attestation,
      now: Date.now(),
    });
  }

  app.get('/sbom.json', {
    handler: async (_req, reply) => {
      const doc = await buildDoc();
      reply.header('cache-control', 'public, max-age=300');
      reply.header('content-type', 'application/vnd.cyclonedx+json; charset=utf-8');
      return doc;
    },
  });

  app.get('/sbom/summary', {
    handler: async (_req, reply) => {
      const attestation = await getAttestation(app.clawmind.dataDir);
      const components = await collectComponents(repoRoot);
      const required = components.filter((c) => c.scope === 'required').length;
      const optional = components.length - required;
      const workspace = components.filter((c) => c.type === 'application').length;
      reply.header('cache-control', 'public, max-age=300');
      return {
        specVersion: '1.5',
        format: 'CycloneDX',
        components: { total: components.length, required, optional, workspace },
        attestation: publicAttestation(attestation),
      };
    },
  });

  app.get('/sbom/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.SbomRead),
    ],
    handler: async () => {
      const attestation = await getAttestation(app.clawmind.dataDir);
      const components = await collectComponents(repoRoot);
      return { attestation, componentCount: components.length };
    },
  });

  app.put('/admin/sbom/attestation', {
    schema: { body: ATTESTATION_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SbomManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const body = isPlainObject(req.body) ? req.body : {};
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('sbom.attestation.update', true),
            resource: '/v1/admin/sbom/attestation',
            meta: { ip: req.ip, requestId: req.id, dryRun: true, fields: Object.keys(body) },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await updateAttestation(app.clawmind.dataDir, userId, body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('sbom.attestation.update', false),
          resource: '/v1/admin/sbom/attestation',
          meta: {
            ip: req.ip,
            requestId: req.id,
            fields: Object.keys(body),
            commit: next.commit,
            repository: next.repository,
            vendor: next.vendor,
            signatureCleared: true,
          },
        });
        return next;
      } catch (err) {
        if (err instanceof SbomValidationError) {
          reply.code(400);
          return { error: 'invalid_attestation', message: err.message };
        }
        throw err;
      }
    },
  });

  app.post('/admin/sbom/attestation/sign', {
    schema: { querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.SbomManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      const doc = await buildDoc();
      const hash = canonicalHash(doc);
      if (dryRun) {
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('sbom.attestation.sign', true),
          resource: '/v1/admin/sbom/attestation/sign',
          meta: {
            ip: req.ip,
            requestId: req.id,
            dryRun: true,
            componentCount: doc.components.length,
            hash,
          },
        });
        return reply.code(200).send({ dryRun: true, hash, componentCount: doc.components.length });
      }
      const next = await signCurrent({ dir: app.clawmind.dataDir, userId, doc });
      await app.clawmind.audit.write({
        actor: userId,
        action: auditAction('sbom.attestation.sign', false),
        resource: '/v1/admin/sbom/attestation/sign',
        meta: { ip: req.ip, requestId: req.id, hash, componentCount: doc.components.length },
      });
      return next;
    },
  });
};
