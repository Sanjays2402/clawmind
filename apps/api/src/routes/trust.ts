import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  getProfile,
  updateProfile,
  publicView,
  renderSecurityTxt,
  TrustValidationError,
  TRUST_LIMITS,
} from '../services/trust.js';
import { Scopes } from '../scopes.js';
import { DryRunQuery, isDryRun, auditAction } from '../lib/dry-run.js';

// Trust Center endpoints.
//
//   GET    /v1/trust                  public, no auth   (procurement bait)
//   GET    /v1/trust/admin            admin+, full incl. updatedBy
//   PUT    /v1/trust                  owner+MFA, audit
//   GET    /.well-known/security.txt  public, RFC 9116 derived from profile
//
// The unauthenticated GET is the URL a buyer's vendor-review tool will
// crawl; keeping it auth-free is the whole point of the feature. The
// admin GET surfaces operator-only metadata (updatedBy) that should
// never leak from an internet-exposed instance.

const FrameworkSchema = z
  .object({
    name: z.string().min(1).max(TRUST_LIMITS.frameworkName),
    status: z.enum(['in_progress', 'achieved', 'not_pursued']),
    issuedAt: z.string().max(40).nullable().optional(),
    auditor: z.string().max(TRUST_LIMITS.auditor).nullable().optional(),
    reportUrl: z.string().url().max(TRUST_LIMITS.url).nullable().optional(),
  })
  .strict();

const LinkSchema = z
  .object({
    label: z.string().min(1).max(TRUST_LIMITS.linkLabel),
    url: z.string().url().max(TRUST_LIMITS.url),
  })
  .strict();

const PUT_BODY = z
  .object({
    summary: z.string().max(TRUST_LIMITS.summary).optional(),
    securityContactEmail: z
      .string()
      .email()
      .max(TRUST_LIMITS.email)
      .nullable()
      .optional(),
    vulnerabilityPolicyUrl: z
      .string()
      .url()
      .max(TRUST_LIMITS.url)
      .nullable()
      .optional(),
    frameworks: z.array(FrameworkSchema).max(TRUST_LIMITS.maxFrameworks).optional(),
    encryptionAtRest: z.string().max(TRUST_LIMITS.encryptionField).nullable().optional(),
    encryptionInTransit: z.string().max(TRUST_LIMITS.encryptionField).nullable().optional(),
    dataResidency: z.string().max(TRUST_LIMITS.residency).nullable().optional(),
    links: z.array(LinkSchema).max(TRUST_LIMITS.maxLinks).optional(),
  })
  .strict();

export const trustRoutes: FastifyPluginAsyncZod = async (app) => {
  // Public trust profile. This is the URL a procurement reviewer or a
  // buyer's vendor-review tool will hit; if it 401s, the conversation
  // ends before it starts.
  app.get('/trust', {
    handler: async (_req, reply) => {
      const profile = await getProfile(app.clawmind.dataDir);
      // Short cache so a vendor-review crawler does not hammer disk
      // but operator edits are reflected within a few minutes.
      reply.header('cache-control', 'public, max-age=300');
      return publicView(profile);
    },
  });

  // Operator view. Same shape plus updatedBy + updatedAt.
  app.get('/trust/admin', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireScope(Scopes.TrustRead),
    ],
    handler: async () => {
      return getProfile(app.clawmind.dataDir);
    },
  });

  // Owner replaces (or partially updates) the profile. Every edit is
  // audited because the public page is a regulatory-adjacent surface.
  app.put('/trust', {
    schema: { body: PUT_BODY, querystring: DryRunQuery },
    preHandler: [
      app.requireAuth,
      app.requireRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.TrustManage),
    ],
    handler: async (req, reply) => {
      const userId = req.user!.id;
      const dryRun = isDryRun(req.query.dry_run);
      try {
        if (dryRun) {
          // Validate-only: never touch disk, never write audit-as-applied.
          await app.clawmind.audit.write({
            actor: userId,
            action: auditAction('trust.update', true),
            resource: '/v1/trust',
            meta: { ip: req.ip, requestId: req.id, dryRun: true },
          });
          return reply.code(200).send({ dryRun: true });
        }
        const next = await updateProfile(app.clawmind.dataDir, userId, req.body);
        await app.clawmind.audit.write({
          actor: userId,
          action: auditAction('trust.update', false),
          resource: '/v1/trust',
          meta: {
            ip: req.ip,
            requestId: req.id,
            frameworks: next.frameworks.length,
            links: next.links.length,
            hasContact: Boolean(next.securityContactEmail),
          },
        });
        return reply.code(200).send(next);
      } catch (err) {
        if (err instanceof TrustValidationError) {
          return reply.code(400).send({ error: 'invalid trust profile', message: err.message });
        }
        throw err;
      }
    },
  });
};

// security.txt is served at /.well-known/security.txt per RFC 9116. It
// is registered as a separate plugin so it is mounted at the root
// rather than under /v1, which is where vulnerability scanners look.
export const securityTxtRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/.well-known/security.txt', {
    handler: async (_req, reply) => {
      const profile = await getProfile(app.clawmind.dataDir);
      const body = renderSecurityTxt(profile);
      if (!body) {
        // Better to 404 than serve a malformed security.txt; scanners
        // flag a broken file as a finding, whereas a missing one is
        // simply "feature not configured".
        return reply.code(404).send({ error: 'security.txt not configured' });
      }
      reply.header('content-type', 'text/plain; charset=utf-8');
      reply.header('cache-control', 'public, max-age=300');
      return body;
    },
  });
};
