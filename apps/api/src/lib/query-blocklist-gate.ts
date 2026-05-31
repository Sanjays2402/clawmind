import type { FastifyReply } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { matchQuery } from '../services/query-blocklist.js';

// Shared blocklist gate used by /v1/ask, /v1/ask/stream, /v1/search and
// /v1/explain. Returns true when the request should continue, false when
// the route handler has already replied with 422 and must stop.
//
// We deliberately do NOT log the raw query into the audit log here:
// blocklist patterns frequently target regulated content (PII, named
// matters), so the operator already has the rule on disk and replaying
// the input would defeat the point. The audit entry records the rule
// id and the calling user only.
export async function enforceQueryBlocklist(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  route: string,
  q: string,
): Promise<boolean> {
  const match = await matchQuery(app.clawmind.dataDir, q);
  if (!match) return true;
  await app.clawmind.audit.write({
    actor: userId,
    action: 'query-blocklist.blocked',
    resource: route,
    meta: { ruleId: match.ruleId, mode: match.mode, label: match.label },
  });
  reply
    .code(422)
    .send({
      error: 'query-blocked',
      message:
        'This query was blocked by a workspace policy. Contact your workspace owner if you believe this is in error.',
      ruleId: match.ruleId,
    });
  return false;
}
