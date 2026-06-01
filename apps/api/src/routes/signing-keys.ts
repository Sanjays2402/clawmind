import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getJwks, getPublicMaterial, verifyPayload } from '../services/signing-keys.js';
import {
  getDocument,
  canonicalAttestation,
  verifyAttestationSignature,
} from '../services/warrant-canary.js';

// Public signing-key surfaces.
//
//   GET  /.well-known/clawmind-signing.json      JWKS (RFC 7517) for offline verifiers
//   GET  /.well-known/clawmind-signing.pem       PEM public key for openssl pkeyutl users
//   POST /v1/signing/verify                      reference verifier for arbitrary payloads
//   POST /v1/warrant-canary/verify               reference verifier for a canary record
//
// All four are unauthenticated by design: the whole point of the
// public signing key is that an auditor can verify our published
// artefacts without having an account on the instance. The verify
// endpoints are server-side conveniences; the canonical workflow is
// "fetch the JWKS once, then verify offline with stock crypto".

const VERIFY_PAYLOAD = z
  .object({
    canonical: z.string().min(1).max(64 * 1024),
    signature: z.string().min(1).max(512),
    kid: z.string().min(1).max(128),
  })
  .strict();

const VERIFY_ATTESTATION = z
  .object({
    // Mirrors CanaryAttestation. We accept the full record (including
    // the embedded `proof`) so an auditor can paste exactly what they
    // pulled from /v1/warrant-canary and get back a boolean.
    record: z
      .object({
        id: z.string(),
        statement: z.string(),
        attestedAt: z.number().int(),
        cadenceDays: z.number().int(),
        expiresAt: z.number().int(),
        fingerprint: z.string(),
        proof: z
          .object({
            signature: z.string(),
            kid: z.string(),
            alg: z.literal('EdDSA'),
            digest: z.string(),
          })
          .nullable(),
        withdrawnAt: z.number().int().nullable().optional(),
        withdrawnBy: z.string().nullable().optional(),
        withdrawnReason: z.string().nullable().optional(),
        attestedBy: z.string().optional(),
      })
      .passthrough(),
  })
  .strict();

export const signingKeysWellKnownRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/.well-known/clawmind-signing.json', {
    handler: async (_req, reply) => {
      const jwks = await getJwks(app.clawmind.dataDir);
      reply.header('content-type', 'application/jwk-set+json');
      // 5 minute cache: the key does not rotate at request cadence,
      // but operators may rebuild storage during incident response,
      // so we do not want a CDN pinning a stale key forever.
      reply.header('cache-control', 'public, max-age=300');
      return jwks;
    },
  });

  app.get('/.well-known/clawmind-signing.pem', {
    handler: async (_req, reply) => {
      const mat = await getPublicMaterial(app.clawmind.dataDir);
      reply.header('content-type', 'application/x-pem-file');
      reply.header('cache-control', 'public, max-age=300');
      return mat.publicPem;
    },
  });
};

export const signingKeysRoutes: FastifyPluginAsyncZod = async (app) => {
  // Operator-facing key descriptor: same data as the JWKS plus the
  // PEM and createdAt timestamp. The trust-center UI consumes this
  // to render a copy-able fingerprint without parsing JWK.
  app.get('/signing/key', {
    handler: async (_req, reply) => {
      const mat = await getPublicMaterial(app.clawmind.dataDir);
      reply.header('cache-control', 'public, max-age=60');
      return mat;
    },
  });

  // Reference verifier for arbitrary payloads. Strict zod schema +
  // explicit reason codes so a buyer's integration test can assert
  // the exact failure mode (wrong kid vs wrong signature).
  app.post('/signing/verify', {
    schema: { body: VERIFY_PAYLOAD },
    handler: async (req, reply) => {
      const { canonical, signature, kid } = req.body;
      const mat = await getPublicMaterial(app.clawmind.dataDir);
      if (kid !== mat.kid) {
        return reply.code(200).send({
          valid: false,
          reason: 'kid does not match current workspace key',
          currentKid: mat.kid,
        });
      }
      const ok = await verifyPayload(app.clawmind.dataDir, canonical, { signature, kid });
      return reply.code(200).send({
        valid: ok,
        reason: ok ? null : 'signature does not verify',
        currentKid: mat.kid,
      });
    },
  });

  // Convenience verifier that re-derives the canonical bytes from
  // the supplied record. Equivalent to /signing/verify but spares
  // auditors from having to reimplement canonicalAttestation().
  app.post('/warrant-canary/verify', {
    schema: { body: VERIFY_ATTESTATION },
    handler: async (req, reply) => {
      const record = req.body.record as Parameters<typeof verifyAttestationSignature>[1];
      const result = await verifyAttestationSignature(app.clawmind.dataDir, record);
      const mat = await getPublicMaterial(app.clawmind.dataDir);
      // We also include the canonical bytes we computed, so an
      // auditor can diff against their own serialiser if their
      // verifier comes back valid=false. This is the single biggest
      // support-load reducer for any signature-verification API.
      return reply.code(200).send({
        valid: result.valid,
        reason: result.reason,
        currentKid: mat.kid,
        canonical: canonicalAttestation(record),
      });
    },
  });

  // Tiny pinning helper: a buyer's vendor-review tool can hit this
  // to confirm the fingerprint they recorded last quarter still
  // matches what the live instance is publishing today.
  app.get('/warrant-canary/key-fingerprint', {
    handler: async (_req, reply) => {
      const mat = await getPublicMaterial(app.clawmind.dataDir);
      reply.header('cache-control', 'public, max-age=300');
      return { kid: mat.kid, alg: mat.alg, crv: mat.crv, createdAt: mat.createdAt };
    },
  });

  // Re-verify a stored attestation by id without the caller having
  // to paste the record. Useful for "did this specific attestation
  // come from your key?" questions in procurement tickets.
  app.get('/warrant-canary/attestations/:id/verify', {
    schema: {
      params: z.object({ id: z.string().min(1).max(64) }).strict(),
    },
    handler: async (req, reply) => {
      const doc = await getDocument(app.clawmind.dataDir);
      const record = doc.history.find((r) => r.id === req.params.id);
      if (!record) {
        return reply.code(404).send({ error: 'attestation not found', id: req.params.id });
      }
      const result = await verifyAttestationSignature(app.clawmind.dataDir, record);
      const mat = await getPublicMaterial(app.clawmind.dataDir);
      return reply.code(200).send({
        id: record.id,
        valid: result.valid,
        reason: result.reason,
        currentKid: mat.kid,
      });
    },
  });
};
