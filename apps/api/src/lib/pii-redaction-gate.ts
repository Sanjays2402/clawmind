import type { FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { applyRedaction, getPolicy } from '../services/pii-redaction.js';

// Shared PII gate used by /v1/ask, /v1/ask/stream, /v1/search, /v1/explain
// and /v1/batch. Runs BEFORE the query blocklist so that the blocklist
// regexes never see the raw secret either.
//
// Behaviour:
//   * Returns { ok: true, query } with the (possibly redacted) query
//     string the caller should pass downstream. The original `req.body.q`
//     should be replaced with this value before retrieval.
//   * Returns { ok: false } when a 'block' detector fired; in that case
//     this function has already sent a 422 response and the route
//     handler must stop.
//
// We deliberately do NOT log the raw query or the matched substring in
// the audit log. Doing so would defeat the entire point of the policy.
// We log only the detector class names and counts.

export interface PiiGateResult {
  ok: boolean;
  query?: string;
}

export async function enforcePiiRedaction(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  route: string,
  q: string,
): Promise<PiiGateResult> {
  if (typeof q !== 'string' || q.length === 0) {
    return { ok: true, query: q };
  }
  const policy = await getPolicy(app.clawmind.dataDir);
  const result = applyRedaction(q, policy);

  if (result.blockedBy) {
    await app.clawmind.audit.write({
      actor: userId,
      action: 'pii-redaction.blocked',
      resource: route,
      meta: {
        blockedBy: result.blockedBy,
        matches: result.matches.map((m) => ({
          class: m.className,
          action: m.action,
          count: m.count,
        })),
      },
    });
    reply.code(422).send({
      error: 'pii-blocked',
      message:
        'This query was rejected by the workspace PII redaction policy. Remove the highlighted information and retry.',
      class: result.blockedBy,
    });
    return { ok: false };
  }

  if (result.matches.length > 0) {
    await app.clawmind.audit.write({
      actor: userId,
      action: 'pii-redaction.redacted',
      resource: route,
      meta: {
        matches: result.matches.map((m) => ({
          class: m.className,
          action: m.action,
          count: m.count,
        })),
      },
    });
  }

  return { ok: true, query: result.redacted };
}
