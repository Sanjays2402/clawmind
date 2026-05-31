import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { evaluateUser, isMfaPolicyAllowedPath } from '../services/mfa-policy.js';

// Workspace MFA enforcement.
//
// Runs after auth so we know who is calling. For session users (humans)
// the gate denies any non-allowlisted mutating call with HTTP 412 once
// the workspace policy is enforced and the per-user grace window has
// elapsed without an MFA enrolment. API-key callers are exempt: their
// security model is scope plus per-key IP allowlist plus per-key rate
// limits, and there is no interactive surface to prompt for a TOTP code
// mid-API request.
//
// The 412 (Precondition Failed) status was chosen over 401 / 403 so
// clients can distinguish "your credentials are fine but workspace
// policy requires an additional setup step" from "bad credentials" or
// "wrong role". The response body carries a stable machine-readable
// error so SDKs can route the user to /settings/mfa without parsing
// English.

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.user) return;
    if (req.user.via === 'api-key') return;
    if (isMfaPolicyAllowedPath(req.method, req.url)) return;
    let result;
    try {
      result = await evaluateUser(app.clawmind.dataDir, req.user.id);
    } catch {
      // Fail-open on transient disk read errors so a corrupt policy file
      // does not lock the entire workspace out. The doctor route surfaces
      // the underlying file error separately.
      return;
    }
    if (result.allowed) return;
    await app.clawmind.audit
      .write({
        actor: req.user.id,
        action: 'mfa-policy.denied',
        resource: req.url,
        meta: {
          method: req.method,
          reason: result.reason,
          graceEndsAt: result.graceEndsAt,
          ip: req.ip,
        },
      })
      .catch(() => undefined);
    reply.header('x-mfa-required', '1');
    return reply.code(412).send({
      error: 'mfa_enrollment_required',
      message:
        'This workspace requires every member to enrol multi-factor auth before writing. ' +
        'Enrol at /settings/mfa to continue.',
      enrollUrl: '/settings/mfa',
      graceEndedAt: result.graceEndsAt,
    });
  });
};

export const mfaPolicyPlugin = fp(plugin, { name: 'mfa-policy' });
