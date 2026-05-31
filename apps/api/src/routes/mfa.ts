import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  startEnrollment,
  confirmEnrollment,
  verifyForStepUp,
  disableMfa,
  regenerateRecoveryCodes,
  getStatus,
  loadMfa,
} from '../services/mfa.js';
import { Scopes } from '../scopes.js';

// MFA endpoints for the authenticated session user.
//
//   GET    /v1/mfa/status                 enrollment + confirmation state
//   POST   /v1/mfa/enroll                 begin enrollment, returns secret + recovery
//   POST   /v1/mfa/confirm     {code}     finish enrollment by proving possession
//   POST   /v1/mfa/verify      {code}     step-up an existing session for sensitive ops
//   POST   /v1/mfa/recovery/regenerate    issue fresh recovery codes, invalidating old
//   DELETE /v1/mfa             {code}     disable MFA after one final code check
//
// All endpoints require an authenticated session (not just an API key) so
// MFA is bound to the human, not a piece of automation. API key callers
// skip MFA entirely; their scoping is their security model.

const CodeBody = z.object({ code: z.string().min(6).max(20) });

export const mfaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/mfa/status', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.MfaRead)],
    handler: async (req) => {
      const status = await getStatus(app.clawmind.dataDir, req.user!.id);
      const sess = req.session as unknown as { mfaVerifiedAt?: number };
      const verifiedAt = sess.mfaVerifiedAt ?? null;
      const stepUpActive =
        status.confirmed &&
        verifiedAt !== null &&
        Date.now() - verifiedAt < status.stepUpTtlSec * 1000;
      return {
        ...status,
        sessionStepUpActive: stepUpActive,
        sessionVerifiedAt: verifiedAt,
      };
    },
  });

  app.post('/mfa/enroll', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.MfaManage)],
    handler: async (req, reply) => {
      if (req.user!.via !== 'session') {
        return reply.code(400).send({ error: 'mfa enrollment requires an interactive session' });
      }
      try {
        const result = await startEnrollment(app.clawmind.dataDir, req.user!.id, {
          accountLabel: req.user!.email ?? req.user!.github ?? req.user!.id,
        });
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'mfa.enroll.start',
          resource: 'mfa',
        });
        return result;
      } catch (err) {
        return reply.code(409).send({ error: (err as Error).message });
      }
    },
  });

  app.post('/mfa/confirm', {
    schema: { body: CodeBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.MfaManage)],
    handler: async (req, reply) => {
      const result = await confirmEnrollment(
        app.clawmind.dataDir,
        req.user!.id,
        req.body.code,
      );
      if (!result.ok) return reply.code(400).send({ error: 'invalid code', reason: result.reason });
      // Confirming counts as a step-up too: the user just proved possession.
      (req.session as unknown as { mfaVerifiedAt?: number }).mfaVerifiedAt = Date.now();
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'mfa.enroll.confirm',
        resource: 'mfa',
      });
      return { ok: true };
    },
  });

  app.post('/mfa/verify', {
    schema: { body: CodeBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.MfaManage)],
    handler: async (req, reply) => {
      const result = await verifyForStepUp(
        app.clawmind.dataDir,
        req.user!.id,
        req.body.code,
      );
      if (!result.ok) {
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'mfa.verify.failed',
          resource: 'mfa',
          meta: { reason: result.reason },
        });
        return reply.code(401).send({ error: 'invalid code', reason: result.reason });
      }
      (req.session as unknown as { mfaVerifiedAt?: number }).mfaVerifiedAt = Date.now();
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'mfa.verify',
        resource: 'mfa',
        meta: { method: result.method },
      });
      const status = await getStatus(app.clawmind.dataDir, req.user!.id);
      return {
        ok: true,
        method: result.method,
        recoveryCodesRemaining: status.recoveryCodesRemaining,
        stepUpExpiresAt: Date.now() + status.stepUpTtlSec * 1000,
      };
    },
  });

  app.post('/mfa/recovery/regenerate', {
    schema: { body: CodeBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.MfaManage)],
    handler: async (req, reply) => {
      // Regenerating recovery codes is itself a sensitive operation: it
      // invalidates the printed sheet a customer keeps in a safe. Require a
      // fresh code check rather than relying on the step-up window.
      const verify = await verifyForStepUp(app.clawmind.dataDir, req.user!.id, req.body.code);
      if (!verify.ok) return reply.code(401).send({ error: 'invalid code' });
      const codes = await regenerateRecoveryCodes(app.clawmind.dataDir, req.user!.id);
      if (!codes) return reply.code(409).send({ error: 'mfa not enrolled' });
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'mfa.recovery.regenerate',
        resource: 'mfa',
      });
      return { recoveryCodes: codes };
    },
  });

  app.delete('/mfa', {
    schema: { body: CodeBody },
    preHandler: [app.requireAuth, app.requireScope(Scopes.MfaManage)],
    handler: async (req, reply) => {
      const record = await loadMfa(app.clawmind.dataDir, req.user!.id);
      if (!record) return reply.code(404).send({ error: 'mfa not enrolled' });
      if (record.confirmedAt) {
        const verify = await verifyForStepUp(app.clawmind.dataDir, req.user!.id, req.body.code);
        if (!verify.ok) return reply.code(401).send({ error: 'invalid code' });
      }
      await disableMfa(app.clawmind.dataDir, req.user!.id);
      (req.session as unknown as { mfaVerifiedAt?: number }).mfaVerifiedAt = undefined;
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'mfa.disable',
        resource: 'mfa',
      });
      return { ok: true };
    },
  });
};
