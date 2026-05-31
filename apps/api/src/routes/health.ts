import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { snapshot, renderProm, PROM_CONTENT_TYPE } from '@clawmind/telemetry';

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // True liveness: only proves the event loop is responsive. Zero downstream
  // calls, zero allocations of consequence, so Kubernetes will not restart
  // the pod when the embed sidecar or LLM provider is slow or degraded.
  // The Helm livenessProbe targets this path.
  app.get('/live', async (_req, reply) => {
    reply.code(200);
    return { ok: true };
  });

  // Deep status. Calls embed and LLM health and reports index sizes. Useful
  // for dashboards and on-call but NOT safe as a Kubernetes livenessProbe
  // because a flaky dependency would cause the API pod to be killed.
  app.get('/health', async () => ({
    ok: true,
    embed: await app.clawmind.embed.health(),
    llm: await app.clawmind.llm.health(),
    chunks: await app.clawmind.lance.count(),
    bm25: app.clawmind.bm25.size(),
    docs: app.clawmind.manifest.size(),
  }));

  // Readiness: cheap, no network. Returns 503 until the LanceDB table and
  // ingest manifest are loaded, so the Service does not route traffic to a
  // pod that cannot answer search yet.
  app.get('/ready', async (_req, reply) => {
    const ready = {
      lance: typeof app.clawmind.lance.count === 'function',
      bm25: app.clawmind.bm25 !== undefined,
      manifest: app.clawmind.manifest !== undefined,
    };
    const ok = Object.values(ready).every(Boolean);
    reply.code(ok ? 200 : 503);
    return { ok, ...ready };
  });

  // Prometheus exposition. Negotiate on Accept so curl and dashboards keep
  // working with the legacy JSON snapshot.
  app.get('/metrics', async (req, reply) => {
    const accept = String(req.headers.accept ?? '');
    const wantsJson = accept.includes('application/json');
    if (wantsJson) return snapshot();
    reply.header('content-type', PROM_CONTENT_TYPE);
    return renderProm();
  });

  app.get('/metrics.json', async () => snapshot());

  app.get('/version', async () => ({ version: '0.1.0', name: 'clawmind-api' }));
};
