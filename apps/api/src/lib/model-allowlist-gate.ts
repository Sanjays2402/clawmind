import type { FastifyReply, FastifyInstance } from 'fastify';
import { getPolicy, evaluate } from '../services/model-allowlist.js';

// Shared model-allowlist gate. Called AFTER the LLM returns its model
// tag and BEFORE we commit the answer to history or fan it out to
// webhooks. Returns true when the answer may proceed; false when this
// helper has already replied with 422 'model-not-allowed' and the route
// handler must stop.
//
// We intentionally evaluate post-call rather than pre-call because the
// router supports a fallback chain: knowing which model actually served
// the request is the only reliable signal that the workspace policy
// was honoured. Pre-call would only check the configured primary.
export async function enforceModelAllowlist(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  route: string,
  model: string,
): Promise<boolean> {
  const policy = await getPolicy(app.clawmind.dataDir);
  const decision = evaluate(policy, model);
  if (decision.allowed) return true;
  await app.clawmind.audit.write({
    actor: userId,
    action: 'model-allowlist.blocked',
    resource: route,
    meta: { model, mode: decision.mode },
  });
  reply.code(422).send({
    error: 'model-not-allowed',
    message:
      'The model that served this request is not approved by the workspace model allowlist.',
    model,
    mode: decision.mode,
  });
  return false;
}
