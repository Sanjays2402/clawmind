import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { nanoid } from 'nanoid';
import { ask } from '@clawmind/rag';
import { Scopes } from '../scopes.js';
import { recordHistory } from '../services/history.js';
import { recordUsage } from '../services/usage.js';
import { enforceQuotaGate } from '../lib/quota-gate.js';
import {
  BATCH_LIMITS,
  extractRows,
  resultsToCsv,
  type BatchResult,
  type BatchRow,
} from '../services/batch.js';

// JSON request shape. The text/csv path bypasses Zod and is handled inline.
const BatchBody = z.object({
  queries: z.array(z.string().min(1).max(2000)).min(1).max(BATCH_LIMITS.MAX_BATCH),
  namespaces: z.array(z.string()).optional(),
  k: z.number().int().min(1).max(50).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

export const batchRoutes: FastifyPluginAsyncZod = async (app) => {
  // Accept raw CSV bodies (`content-type: text/csv`). Fastify will hand us
  // a string instead of trying to JSON-parse it.
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/ask/batch', {
    preHandler: [app.requireAuth, app.requireScope(Scopes.Ask)],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    handler: async (req, reply) => {
      const ct = (req.headers['content-type'] ?? '').toLowerCase();
      let rows: BatchRow[];
      let format: 'json' | 'csv' = 'json';
      let namespaces: string[] | undefined;
      let k: number | undefined;

      try {
        if (ct.startsWith('text/csv')) {
          const csv = typeof req.body === 'string' ? req.body : '';
          rows = extractRows(csv);
          // Default to CSV out for CSV in so curl users get a file back.
          format = (req.query as { format?: string })?.format === 'json' ? 'json' : 'csv';
        } else {
          const parsed = BatchBody.safeParse(req.body);
          if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
          }
          rows = parsed.data.queries.map((q) => ({ q }));
          format = parsed.data.format ?? 'json';
          namespaces = parsed.data.namespaces;
          k = parsed.data.k;
        }
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      // Quota covers the whole batch so a user can't bypass the meter by
      // bundling 100 questions into one HTTP call.
      const gate = await enforceQuotaGate(app, reply, req.user!.id, rows.length);
      if (!gate.ok) return;

      const batchId = nanoid(10);
      const results: BatchResult[] = [];
      let okCount = 0;
      let errCount = 0;

      for (const row of rows) {
        const t0 = Date.now();
        try {
          const expanded = app.aliases.expandQuery(row.q);
          const result = await ask(app.rag, {
            q: expanded,
            k: k ?? 8,
            namespaces: namespaces as never,
            mmrLambda: 0.5,
            hybridAlpha: 0.5,
            expand: true,
          });
          const id = nanoid(10);
          await recordHistory(app.clawmind.dataDir, {
            id,
            ts: Date.now(),
            userId: req.user!.id,
            query: row.q,
            answer: result.text,
            sources: result.sources,
            model: result.model,
          });
          results.push({
            q: row.q,
            tag: row.tag,
            ok: true,
            answer: result.text,
            model: result.model,
            sources: result.sources.length,
            durationMs: Date.now() - t0,
          });
          okCount++;
        } catch (err) {
          results.push({
            q: row.q,
            tag: row.tag,
            ok: false,
            error: (err as Error).message,
            durationMs: Date.now() - t0,
          });
          errCount++;
        }
      }

      // Record usage for every row we actually attempted, regardless of
      // outcome, so a bad question still counts against the quota the
      // user just consumed compute on.
      await recordUsage(app.clawmind.dataDir, req.user!.id, 'ask', rows.length).catch(() => undefined);

      if (format === 'csv') {
        reply.header('content-type', 'text/csv; charset=utf-8');
        reply.header(
          'content-disposition',
          `attachment; filename="clawmind-batch-${batchId}.csv"`,
        );
        return reply.send(resultsToCsv(results));
      }

      return {
        id: batchId,
        total: rows.length,
        ok: okCount,
        failed: errCount,
        results,
      };
    },
  });
};
