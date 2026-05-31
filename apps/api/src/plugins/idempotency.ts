import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  isValidKey,
  hashBody,
  lookup,
  record,
  captureHeaders,
  type IdempotencyRecord,
} from '../services/idempotency.js';

// Idempotency-Key middleware
//
// Applies only to mutating HTTP methods (POST / PUT / PATCH / DELETE) and
// only when the caller is authenticated, so anonymous traffic cannot fill
// the on-disk registry.
//
// First request with a given key:
//   - Runs the handler normally.
//   - On a successful response (2xx) we persist status + body so retries
//     replay it.
//
// Retry with the same key + same body:
//   - Short-circuited in preHandler and the cached response is replayed.
//   - Adds `Idempotency-Replay: true` so the client can tell.
//
// Retry with the same key but a different body:
//   - 409 Conflict, so a coding error does not silently mutate state.
//
// Non-2xx responses are deliberately not cached: a client retrying a 500 or
// a 429 should get a real fresh attempt, not a permanent replay of the
// failure.

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const HEADER = 'idempotency-key';
const REPLAY_HEADER = 'idempotency-replay';

type ReqState = {
  key: string;
  actor: string;
  method: string;
  path: string;
  bodyHash: string;
};

declare module 'fastify' {
  interface FastifyRequest {
    _idem?: ReqState;
  }
}

function actorFor(req: FastifyRequest): string | null {
  const u = req.user;
  if (!u) return null;
  if (u.apiKeyId) return `k:${u.apiKeyId}`;
  return `u:${u.id}`;
}

function rawBodyString(req: FastifyRequest): string {
  // Fastify has parsed JSON bodies into objects by the time preHandler
  // runs. Re-serialise deterministically for hashing. Empty bodies hash to
  // the empty string's sha256, which is fine.
  if (req.body == null) return '';
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return (req.body as Buffer).toString('utf8');
  try {
    return JSON.stringify(req.body);
  } catch {
    return '';
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING.has(req.method)) return;
    const raw = req.headers[HEADER];
    if (!raw) return;
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !isValidKey(key)) {
      return reply.code(400).send({
        error: 'invalid_idempotency_key',
        message: `Idempotency-Key must match [A-Za-z0-9_.:-]{8,200}`,
      });
    }
    const actor = actorFor(req);
    // Only authenticated callers can use Idempotency-Key. Anonymous traffic
    // would let anyone fill the on-disk registry, and a replay would leak
    // another caller's response. Reject loudly so misconfigured clients
    // notice instead of silently losing idempotency.
    if (!actor) {
      return reply.code(401).send({
        error: 'idempotency_requires_auth',
        message: 'Idempotency-Key requires an authenticated session or API key',
      });
    }
    const path = req.routeOptions?.url ?? req.url.split('?')[0] ?? req.url;
    const bodyHash = hashBody(rawBodyString(req));
    const result = await lookup(
      app.clawmind.dataDir,
      actor,
      req.method,
      path,
      key,
      bodyHash,
    );
    if (result.kind === 'conflict') {
      return reply.code(409).send({
        error: 'idempotency_key_reused',
        message:
          'Idempotency-Key was already used for a different request body on this route',
      });
    }
    if (result.kind === 'replay') {
      const rec = result.record;
      for (const [hk, hv] of Object.entries(rec.headers)) {
        reply.header(hk, hv);
      }
      reply.header(REPLAY_HEADER, 'true');
      reply.code(rec.status);
      return reply.send(Buffer.from(rec.bodyB64, 'base64'));
    }
    req._idem = {
      key,
      actor,
      method: req.method,
      path: path,
      bodyHash,
    } as ReqState;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const state = req._idem;
    if (!state) return payload;
    if (reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    // Normalise to a buffer once so the on-disk copy matches what we ship.
    let buf: Buffer;
    if (payload == null) buf = Buffer.alloc(0);
    else if (Buffer.isBuffer(payload)) buf = payload;
    else if (typeof payload === 'string') buf = Buffer.from(payload, 'utf8');
    else {
      // Streams etc: do not attempt to cache, the caller will not be able
      // to replay them correctly anyway.
      return payload;
    }
    const rec: IdempotencyRecord = {
      actor: state.actor,
      method: state.method,
      path: state.path,
      key: state.key,
      bodyHash: state.bodyHash,
      status: reply.statusCode,
      headers: captureHeaders(reply.getHeaders() as Record<string, unknown>),
      bodyB64: buf.toString('base64'),
      createdAt: Date.now(),
    };
    // Best-effort. If the disk write fails we still serve the response;
    // the client just loses idempotency on this specific request.
    try {
      await record(app.clawmind.dataDir, rec);
    } catch (err) {
      req.log.warn({ err }, 'idempotency persist failed');
    }
    return payload;
  });
};

export const idempotencyPlugin = fp(plugin, { name: 'idempotency' });
