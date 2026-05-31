// In-process token bucket for per-API-key custom rate limits.
//
// The global limiter in server.ts gives every authenticated identity a
// shared ceiling; this module enforces a stricter, customer-configured cap
// on individual keys (e.g. a partner key that must not exceed 600 req/hour
// even though the global allowance is higher). State is per-process and
// resets on restart, which matches the global limiter's behaviour and is
// fine for a single-node deploy. A future Redis backend can swap in here
// without touching the call sites.

interface Bucket {
  /** Number of requests recorded in the current window. */
  count: number;
  /** Unix milliseconds when the current window started. */
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  limit: number;
  windowMs: number;
}

/**
 * Attempt to consume a single token from the bucket identified by `keyId`.
 * Fixed-window counter: simple, predictable, and matches the semantics of
 * the X-RateLimit-* headers we emit. Returns the resulting snapshot so the
 * caller can populate response headers regardless of outcome.
 */
export function consume(
  keyId: string,
  limit: { max: number; windowMs: number },
  now: number = Date.now(),
): ConsumeResult {
  const id = `apikey:${keyId}:${limit.max}:${limit.windowMs}`;
  let b = buckets.get(id);
  if (!b || now - b.windowStart >= limit.windowMs) {
    b = { count: 0, windowStart: now };
    buckets.set(id, b);
  }
  const allowed = b.count < limit.max;
  if (allowed) b.count += 1;
  const remaining = Math.max(0, limit.max - b.count);
  const resetMs = b.windowStart + limit.windowMs;
  return { allowed, remaining, resetMs, limit: limit.max, windowMs: limit.windowMs };
}

/** Reset every bucket. Intended for tests. */
export function _resetAllBuckets(): void {
  buckets.clear();
}
