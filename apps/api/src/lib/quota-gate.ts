import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  enforceWorkspaceAndUserQuota,
  DEFAULT_FREE_LIMIT,
  type EnforceResult,
} from '../services/usage.js';
import {
  getPolicy as getQuotaPolicy,
  effectiveWorkspaceLimit,
  effectiveUserLimit,
} from '../services/workspace-quota.js';
import { applyRateLimitHeaders } from '../services/rate-headers.js';

/**
 * Enforces the workspace + per-user monthly quota for one logical
 * operation costing `units`. Returns `true` if the caller may proceed,
 * `false` if a 429 response was already written.
 *
 * `route` is the endpoint name the headers/body should reference
 * (e.g. '/v1/ask'). `endpoint` is what shows in error messages.
 */
export async function enforceQuotaGate(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  units: number,
): Promise<{ ok: true; result: EnforceResult } | { ok: false }> {
  const policy = await getQuotaPolicy(app.clawmind.dataDir);
  const wsLimit = effectiveWorkspaceLimit(policy);
  const userLimit = effectiveUserLimit(policy);
  const result = await enforceWorkspaceAndUserQuota(
    app.clawmind.dataDir,
    userId,
    units,
    wsLimit,
    Number.isFinite(userLimit) ? userLimit : DEFAULT_FREE_LIMIT,
  );
  if (result.allowed) return { ok: true, result };
  const ws = result.workspace!;
  const blockerIsWorkspace = result.blocker === 'workspace';
  const limit = blockerIsWorkspace ? ws.limit : result.summary.limit;
  const used = blockerIsWorkspace ? ws.used : result.summary.used;
  reply.header('x-clawmind-quota-used', String(used));
  reply.header(
    'x-clawmind-quota-limit',
    Number.isFinite(limit) ? String(limit) : 'unlimited',
  );
  reply.header('x-clawmind-quota-scope', blockerIsWorkspace ? 'workspace' : 'user');
  applyRateLimitHeaders(reply, {
    limit: Number.isFinite(limit) ? limit : 0,
    remaining: 0,
    resetMs: result.summary.resetsAt,
    windowSec: Math.max(1, Math.round((result.summary.resetsAt - Date.now()) / 1000)),
    policy: blockerIsWorkspace ? 'quota:workspace' : 'quota:monthly',
  });
  reply.code(429).send({
    error: 'quota exceeded',
    scope: blockerIsWorkspace ? 'workspace' : 'user',
    message: blockerIsWorkspace
      ? `Workspace monthly limit of ${limit} requests reached. Resets ${new Date(result.summary.resetsAt).toISOString()}.`
      : `Per-member monthly limit of ${limit} requests reached. Resets ${new Date(result.summary.resetsAt).toISOString()}.`,
    usage: result.summary,
    workspaceUsage: {
      period: ws.period,
      used: ws.used,
      limit: Number.isFinite(ws.limit) ? ws.limit : null,
      resetsAt: ws.resetsAt,
    },
  });
  return { ok: false };
}
