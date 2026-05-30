import type { FastifyInstance } from 'fastify';
import { healthRoutes } from './health.js';
import { searchRoutes } from './search.js';
import { askRoutes } from './ask.js';
import { ingestRoutes } from './ingest.js';
import { sourcesRoutes } from './sources.js';
import { historyRoutes } from './history.js';
import { savedRoutes } from './saved.js';
import { shareRoutes } from './share.js';
import { conversationRoutes } from './conversations.js';
import { feedbackRoutes } from './feedback.js';
import { digestRoutes } from './digests.js';
import { keyRoutes } from './keys.js';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(searchRoutes, { prefix: '/v1' });
  await app.register(askRoutes, { prefix: '/v1' });
  await app.register(ingestRoutes, { prefix: '/v1' });
  await app.register(sourcesRoutes, { prefix: '/v1' });
  await app.register(historyRoutes, { prefix: '/v1' });
  await app.register(savedRoutes, { prefix: '/v1' });
  await app.register(shareRoutes, { prefix: '/v1' });
  await app.register(conversationRoutes, { prefix: '/v1' });
  await app.register(feedbackRoutes, { prefix: '/v1' });
  await app.register(digestRoutes, { prefix: '/v1' });
  await app.register(keyRoutes, { prefix: '/v1' });
}
