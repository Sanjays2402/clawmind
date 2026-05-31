// Standardized rate-limit response headers.
//
// Enterprise SDKs (Okta SCIM, Stripe-style clients, k8s clients, etc.) all
// expect a consistent shape on 429 responses so they can back off correctly.
// We emit:
//
//   X-RateLimit-Limit      max requests in the window
//   X-RateLimit-Remaining  remaining tokens after this request
//   X-RateLimit-Reset      unix seconds when the window resets
//   Retry-After            seconds the caller should wait (RFC 7231)
//   RateLimit-Policy       draft-ietf-httpapi-ratelimit-headers value
//   RateLimit-Limit        draft equivalent of X-RateLimit-Limit
//   RateLimit-Remaining    draft equivalent of X-RateLimit-Remaining
//   RateLimit-Reset        draft equivalent of X-RateLimit-Reset (seconds)
//
// Use applyRateLimitHeaders() on every 429 site so a buyer testing against
// our API sees identical headers across /ask, /search, /ingest, and the
// global limiter.

import type { FastifyReply } from 'fastify';

export interface RateLimitSnapshot {
  /** Maximum requests allowed in the window. */
  limit: number;
  /** Tokens left after the current (rejected or accepted) request. */
  remaining: number;
  /** Unix milliseconds when the window resets. */
  resetMs: number;
  /** Window size in seconds, used in RateLimit-Policy. */
  windowSec: number;
  /** Human label for the policy (e.g. 'key', 'route:ask', 'quota:monthly'). */
  policy?: string;
}

export function applyRateLimitHeaders(reply: FastifyReply, snap: RateLimitSnapshot, now: number = Date.now()): void {
  const resetSec = Math.max(0, Math.ceil((snap.resetMs - now) / 1000));
  const remaining = Math.max(0, Math.floor(snap.remaining));
  reply.header('x-ratelimit-limit', String(snap.limit));
  reply.header('x-ratelimit-remaining', String(remaining));
  reply.header('x-ratelimit-reset', String(Math.ceil(snap.resetMs / 1000)));
  reply.header('ratelimit-limit', String(snap.limit));
  reply.header('ratelimit-remaining', String(remaining));
  reply.header('ratelimit-reset', String(resetSec));
  const policy = snap.policy ? `;policy=${JSON.stringify(snap.policy)}` : '';
  reply.header('ratelimit-policy', `${snap.limit};w=${snap.windowSec}${policy}`);
  // Retry-After is only meaningful when the caller is over budget.
  if (remaining === 0) reply.header('retry-after', String(resetSec));
}
