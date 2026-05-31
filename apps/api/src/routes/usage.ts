import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getUsage, getWorkspaceUsage, DEFAULT_FREE_LIMIT } from '../services/usage.js';
import {
  getPolicy as getQuotaPolicy,
  effectiveWorkspaceLimit,
  effectiveUserLimit,
} from '../services/workspace-quota.js';
import { Scopes } from '../scopes.js';

export const usageRoutes: FastifyPluginAsyncZod = async (app) => {
  // Per-user monthly usage. The displayed `limit` honours the workspace
  // policy: if the owner set a per-member cap, that wins; otherwise the
  // historical free-tier default is used so existing clients keep working.
  app.get('/usage', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.UsageRead)],
    handler: async (req) => {
      const policy = await getQuotaPolicy(app.clawmind.dataDir);
      const userLimit = effectiveUserLimit(policy);
      const limit = Number.isFinite(userLimit) ? userLimit : DEFAULT_FREE_LIMIT;
      const summary = await getUsage(app.clawmind.dataDir, req.user!.id, Date.now(), limit);

      const wsLimit = effectiveWorkspaceLimit(policy);
      const ws = await getWorkspaceUsage(app.clawmind.dataDir, Date.now(), wsLimit);
      return {
        ...summary,
        workspace: {
          period: ws.period,
          used: ws.used,
          // Marshal Infinity as null so JSON stays clean and the UI can
          // render an "Unlimited" badge deterministically.
          limit: Number.isFinite(ws.limit) ? ws.limit : null,
          remaining: Number.isFinite(ws.remaining) ? ws.remaining : null,
          resetsAt: ws.resetsAt,
          byKind: ws.byKind,
          members: ws.members,
        },
      };
    },
  });
};
