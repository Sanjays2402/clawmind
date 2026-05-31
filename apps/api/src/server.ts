import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { loadEnv, lancedbDir, bm25Dir, manifestPath, auditPath, auditAnchorsPath, dataDir } from '@clawmind/config';import { createLogger, startTracing, initSentry } from '@clawmind/telemetry';
import { LanceStore, BM25Index, IngestManifest, AuditLog, AuditAnchorStore } from '@clawmind/store';
import { MlxEmbedClient, OpenAIEmbedClient, FallbackEmbedProvider } from '@clawmind/embed';
import { buildDefaultLLM } from '@clawmind/llm';
import { registerRoutes } from './routes/index.js';
import { configureWebhookUrlGuard, emitToAll as emitToAllWebhooks } from './services/webhooks.js';
import {
  getRecord as getWorkspaceOriginAllowlist,
  originAllowedByWorkspace,
} from './services/workspace-origin-allowlist.js';
import { normaliseOrigin } from './services/api-keys.js';
import { authPlugin } from './plugins/auth.js';
import { ipAllowlistPlugin } from './plugins/ip-allowlist.js';
import { workspaceIpAllowlistPlugin } from './plugins/workspace-ip-allowlist.js';
import { workspaceFreezePlugin } from './plugins/workspace-freeze.js';
import { workspaceDeletionPlugin } from './plugins/workspace-deletion.js';
import { dataResidencyPlugin } from './plugins/data-residency.js';
import { mfaPolicyPlugin } from './plugins/mfa-policy.js';
import { auditPlugin } from './plugins/audit.js';
import { ragPlugin } from './plugins/rag.js';
import { httpMetricsPlugin } from './plugins/http-metrics.js';
import { sentryPlugin } from './plugins/sentry.js';
import { requestIdPlugin, pickRequestId } from './plugins/request-id.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import policyGatePlugin from './plugins/policy-gate.js';
import { idempotencyPlugin } from './plugins/idempotency.js';

export async function buildApp(): Promise<any> {
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

  // SCIM clients send application/scim+json; route the body through the
  // built-in JSON parser so /scim/v2/Users POST/PATCH receive a parsed body.
  app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const trimmed = (body as string).trim();
      done(null, trimmed.length === 0 ? {} : JSON.parse(trimmed));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await app.register(sensible);

  // CORS: the static CLAWMIND_API_CORS_ORIGIN value is the vendor-managed
  // baseline (typically the hosted dashboard). On top of that, workspace
  // owners can add their own browser origins via the workspace-origin-
  // allowlist API so an enterprise dashboard at app.acme.com is not blocked
  // at preflight. We read the file on every check rather than caching to
  // keep the surface trivially auditable; the file is bounded and parsed
  // once per preflight, not once per request.
  const baselineOrigins: string[] = ((): string[] => {
    const v = env.CLAWMIND_API_CORS_ORIGIN as unknown;
    if (Array.isArray(v)) return v.map((o) => String(o)).filter((s) => s.length > 0);
    if (typeof v === 'string') {
      return v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  })();
  function originMatchesBaseline(origin: string): boolean {
    if (baselineOrigins.length === 0) return false;
    const normReq = normaliseOrigin(origin);
    for (const b of baselineOrigins) {
      if (b === '*' || b === origin) return true;
      const norm = normaliseOrigin(b);
      if (norm && normReq && norm === normReq) return true;
    }
    return false;
  }
  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser callers omit Origin. Mirror @fastify/cors default by
      // accepting these so curl, server-to-server, and SDK callers work.
      if (!origin) return cb(null, true);
      if (originMatchesBaseline(origin)) return cb(null, true);
      // Workspace-managed additive list. Owner-controlled, audited on
      // every change.
      getWorkspaceOriginAllowlist(dataDir(env))
        .then((rec) => cb(null, originAllowedByWorkspace(origin, rec)))
        .catch(() => cb(null, false));
    },
    credentials: true,
  });
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
    onWrite: (event) => {
      // Fan out every audit append to any webhook subscribed to
      // 'audit.event'. Wrapped in setImmediate so the write returns to
      // its caller without waiting on network I/O; emitToAll isolates
      // per-subscriber failures internally.
      setImmediate(() => {
        void emitToAllWebhooks(dataDir(env), 'audit.event', { event }).catch(
          () => undefined,
        );
      });
    },
  });
  const llm = buildDefaultLLM(env);

  // Tamper-evident anchor store over the audit chain. HMAC-signed with
  // the session secret so a file-level attacker who truncates the audit
  // log cannot also forge a fresh anchor that hides the truncation.
  const auditAnchors = new AuditAnchorStore(
    auditAnchorsPath(env),
    env.CLAWMIND_SESSION_SECRET,
  );

  app.decorate('clawmind', {
    env, embed, lance, bm25, bm25File: `${bm25Dir(env)}/bm25.json`,
    manifest, audit, auditAnchors, llm, dataDir: dataDir(env),
  });

  // Wire webhook SSRF guard from env once per boot. Re-checked on every
  // outbound delivery so a tenant cannot DNS-rebind around it.
  configureWebhookUrlGuard({
    allowPrivate: env.CLAWMIND_WEBHOOK_ALLOW_PRIVATE,
    allowedPorts: env.CLAWMIND_WEBHOOK_ALLOWED_PORTS
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0 && n < 65536),
  });

  await app.register(requestIdPlugin);
  await app.register(securityHeadersPlugin, {
    hstsEnabled: env.CLAWMIND_HSTS_ENABLED,
    hstsMaxAgeSeconds: env.CLAWMIND_HSTS_MAX_AGE_SECONDS,
  });
  await app.register(httpMetricsPlugin);
  await app.register(sentryPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(ipAllowlistPlugin);
  await app.register(workspaceIpAllowlistPlugin);
  await app.register(workspaceFreezePlugin);
  await app.register(workspaceDeletionPlugin);
  await app.register(dataResidencyPlugin);
  await app.register(mfaPolicyPlugin);
  await app.register(policyGatePlugin);
  await app.register(idempotencyPlugin);
  await app.register(ragPlugin);
  await registerRoutes(app as unknown as Parameters<typeof registerRoutes>[0]);

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
      auditAnchors: AuditAnchorStore;
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
