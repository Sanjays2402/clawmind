import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { loadEnv, lancedbDir, bm25Dir, manifestPath, auditPath, dataDir } from '@clawmind/config';
import { createLogger, startTracing, initSentry } from '@clawmind/telemetry';
import { LanceStore, BM25Index, IngestManifest, AuditLog } from '@clawmind/store';
import { MlxEmbedClient, OpenAIEmbedClient, FallbackEmbedProvider } from '@clawmind/embed';
import { buildDefaultLLM } from '@clawmind/llm';
import { registerRoutes } from './routes/index.js';
import { authPlugin } from './plugins/auth.js';
import { auditPlugin } from './plugins/audit.js';
import { ragPlugin } from './plugins/rag.js';
import { httpMetricsPlugin } from './plugins/http-metrics.js';
import { sentryPlugin } from './plugins/sentry.js';
import { requestIdPlugin, pickRequestId } from './plugins/request-id.js';

export async function buildApp() {
  const env = loadEnv();
  const logger = createLogger({ name: 'clawmind-api', level: env.CLAWMIND_LOG_LEVEL });
  await startTracing({
    enabled: env.CLAWMIND_OTEL_ENABLED,
    endpoint: env.CLAWMIND_OTEL_ENDPOINT,
    serviceName: 'clawmind-api',
  });
  initSentry({
    dsn: env.CLAWMIND_SENTRY_DSN || undefined,
    environment: env.CLAWMIND_SENTRY_ENVIRONMENT,
    release: env.CLAWMIND_SENTRY_RELEASE || undefined,
    serviceName: 'clawmind-api',
    tracesSampleRate: env.CLAWMIND_SENTRY_TRACES_SAMPLE_RATE,
  });

  const app = Fastify({
    loggerInstance: logger as never,
    // Honour an upstream X-Request-Id when present, otherwise mint one.
    // This becomes req.id, is logged by Fastify on every entry, and is
    // echoed back on the response by the request-id plugin.
    genReqId: (req) => pickRequestId(req.headers['x-request-id']),
    requestIdLogLabel: 'requestId',
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(cors, { origin: env.CLAWMIND_API_CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    // Key on the authenticated user when available so a single shared IP
    // (laptop on tethering, container behind a proxy) cannot starve everyone
    // else. API-key-backed requests get keyed on the key id, session users on
    // their session id, anonymous requests fall back to IP.
    keyGenerator(req) {
      const u = (req as { user?: { id: string; apiKeyId?: string } }).user;
      if (u?.apiKeyId) return `k:${u.apiKeyId}`;
      if (u?.id) return `u:${u.id}`;
      return `ip:${req.ip}`;
    },
  });
  await app.register(cookie);
  await app.register(session, {
    secret: env.CLAWMIND_SESSION_SECRET.padEnd(32, '0'),
    cookieName: 'cm.sid',
    cookie: { secure: false, httpOnly: true, sameSite: 'lax' },
    saveUninitialized: false,
  });

  // Build services
  const mlx = new MlxEmbedClient({
    baseUrl: env.CLAWMIND_EMBED_URL,
    model: env.CLAWMIND_EMBED_MODEL,
    dim: env.CLAWMIND_EMBED_DIM,
  });
  const openaiFallback = new OpenAIEmbedClient({
    baseUrl: env.CLAWMIND_LLM_FALLBACK_URL,
    model: 'text-embedding-3-small',
    dim: env.CLAWMIND_EMBED_DIM,
  });
  const embed = new FallbackEmbedProvider([mlx, openaiFallback]);

  const lance = new LanceStore({ dir: lancedbDir(env), dim: env.CLAWMIND_EMBED_DIM });
  await lance.init();
  await lance.ensureTable();
  const bm25 = await BM25Index.load(`${bm25Dir(env)}/bm25.json`);
  const manifest = new IngestManifest(manifestPath(env));
  await manifest.load();
  const audit = new AuditLog(auditPath(env), {
    maxBytes: env.CLAWMIND_AUDIT_MAX_BYTES,
    keepFiles: env.CLAWMIND_AUDIT_KEEP_FILES,
  });
  const llm = buildDefaultLLM(env);

  app.decorate('clawmind', {
    env, embed, lance, bm25, bm25File: `${bm25Dir(env)}/bm25.json`,
    manifest, audit, llm, dataDir: dataDir(env),
  });

  await app.register(requestIdPlugin);
  await app.register(httpMetricsPlugin);
  await app.register(sentryPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(ragPlugin);
  await registerRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    clawmind: {
      env: ReturnType<typeof loadEnv>;
      embed: FallbackEmbedProvider;
      lance: LanceStore;
      bm25: BM25Index;
      bm25File: string;
      manifest: IngestManifest;
      audit: AuditLog;
      llm: ReturnType<typeof buildDefaultLLM>;
      dataDir: string;
    };
  }
  interface Session {
    userId?: string;
    github?: string;
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);
if (isMain) {
  buildApp()
    .then(async (app) => {
      const env = app.clawmind.env;
      await app.listen({ host: env.CLAWMIND_API_HOST, port: env.CLAWMIND_API_PORT });
      app.log.info({ port: env.CLAWMIND_API_PORT }, 'ClawMind API ready');
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
