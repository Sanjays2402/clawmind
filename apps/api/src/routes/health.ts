import type { FastifyPluginAsync } from 'fastify';
import { snapshot, renderProm, PROM_CONTENT_TYPE } from '@clawmind/telemetry';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // Liveness: process is up and serving requests. No downstream calls so
  // Kubernetes does not kill us when the embed sidecar is slow.
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
