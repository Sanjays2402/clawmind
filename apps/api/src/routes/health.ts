import type { FastifyPluginAsync } from 'fastify';
import { snapshot } from '@clawmind/telemetry';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    ok: true,
    embed: await app.clawmind.embed.health(),
    llm: await app.clawmind.llm.health(),
    chunks: await app.clawmind.lance.count(),
    bm25: app.clawmind.bm25.size(),
    docs: app.clawmind.manifest.size(),
  }));

  app.get('/metrics', async () => snapshot());

  app.get('/version', async () => ({ version: '0.1.0', name: 'clawmind-api' }));
};
