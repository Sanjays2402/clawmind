import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { notify } from './notifications.js';
import { assertPublicUrl, parseSafeUrl, UnsafeUrlError, type UrlGuardOptions } from './url-guard.js';
import { checkWebhookUrl } from './webhook-allowlist.js';
import { checkEvents as checkEventsAllowed } from './webhook-events-allowlist.js';

// Module-level guard options. The server overwrites this at boot from env
// (allowPrivate + allowedPorts). Defaults are deny-by-default in production
// but allow-private under NODE_ENV=test so the existing webhook tests can
// keep using https://example.com without hitting real DNS in CI sandboxes.
let GUARD_OPTS: UrlGuardOptions = {
  allowPrivate: process.env.NODE_ENV === 'test',
};

export function configureWebhookUrlGuard(opts: UrlGuardOptions) {
  GUARD_OPTS = { ...opts };
}

export function getWebhookUrlGuard(): UrlGuardOptions {
  return GUARD_OPTS;
}

export { UnsafeUrlError } from './url-guard.js';

// Outbound webhooks let a customer's own service react to ClawMind events
// (currently `ask.completed`) without polling /v1/history. Each subscription
// is per-user and stored in webhooks.json, while every delivery attempt is
// appended to webhook-deliveries.jsonl so the user can audit what we sent
// and replay failures.
//
// Signing: every POST carries an `X-ClawMind-Signature` header of the form
//   t=<unix-ms>,v1=<hex(hmac_sha256(secret, `${t}.${body}`))>
// which is the standard "timestamped HMAC" pattern (Stripe-style). The
// receiver re-derives the HMAC over the verbatim request body and rejects
// anything older than a few minutes to defeat replay.

export const WEBHOOK_EVENTS = ['ask.completed', 'ingest.completed', 'audit.event'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookRecord {
  id: string;
  userId: string;
  url: string;
  events: WebhookEvent[];
  secret: string;          // shown to the user; used to sign payloads
  // Zero-downtime secret rotation: when an owner rotates the secret we keep
  // the prior one around for a grace window. During the grace, every
  // delivery carries BOTH x-clawmind-signature (new) and
  // x-clawmind-signature-prev (old), so a receiver mid-deploy can validate
  // either. The old secret is dropped automatically once the window
  // expires, so a stolen secret never stays valid forever.
  previousSecret?: string;
  previousSecretExpiresAt?: number;
  active: boolean;
  createdAt: number;
  lastDeliveryAt: number | null;
  lastStatus: number | null;   // last HTTP status code we observed
  failureCount: number;        // consecutive failures since last success
}

// Default overlap window when rotating a signing secret. Long enough that a
// rolling deploy of the receiver finishes comfortably; short enough that a
// leaked secret has a bounded blast radius.
export const DEFAULT_ROTATION_GRACE_MS = 24 * 60 * 60_000;

export interface DeliveryRecord {
  id: string;
  webhookId: string;
  userId: string;
  event: WebhookEvent;
  ts: number;
  url: string;
  attempt: number;             // 1-based attempt number for this delivery
  status: number | null;       // HTTP status (null on network error)
  ok: boolean;
  error?: string;
  durationMs: number;
  // Original payload that was POSTed to the receiver, kept so a user can
  // manually redeliver a failed event from the dashboard without having to
  // replay the original ask. Stored as the JSON-serialisable data field
  // (not the full event envelope, which is rebuilt at fire time).
  payload?: unknown;
  // When set, this row was produced by a manual redeliver of `parentId`.
  parentId?: string;
}

const MAX_ATTEMPTS = 3;
// Exponential backoff between in-process retries. Real production systems
// would use a durable queue, but this gives users a real "retry on 5xx"
// experience without dragging in a job runner for a local-first app.
const RETRY_DELAYS_MS = [500, 2_000];
const DELIVERY_TIMEOUT_MS = 5_000;
// After this many consecutive failures we flip `active=false` so a dead
// endpoint stops eating retry budget. The user can re-enable it via PATCH.
const AUTO_DISABLE_AFTER = 10;

function subsFile(dataDir: string) { return join(dataDir, 'webhooks.json'); }
function logFile(dataDir: string) { return join(dataDir, 'webhook-deliveries.jsonl'); }

function isValidUrl(url: string): boolean {
  try {
    parseSafeUrl(url, GUARD_OPTS);
    return true;
  } catch {
    return false;
  }
}

export function sign(secret: string, body: string, ts: number = Date.now()): string {
  const mac = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${mac}`;
}

export function verify(
  secret: string,
  body: string,
  header: string,
  toleranceMs = 5 * 60_000,
  previousSecret?: string,
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    }),
  );
  const t = Number(parts.t);
  const v1 = String(parts.v1 || '');
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(Date.now() - t) > toleranceMs) return false;
  const candidates = [secret, ...(previousSecret ? [previousSecret] : [])];
  for (const s of candidates) {
    const expected = createHmac('sha256', s).update(`${t}.${body}`).digest('hex');
    if (expected.length !== v1.length) continue;
    try {
      if (timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'))) return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}

/**
 * Generate a new signing secret for `id` and demote the current one to a
 * grace window. Returns the updated record (including the freshly minted
 * secret) so the caller can show it to the user exactly once. Subsequent
 * reads via list/get use redact() and never expose either secret again.
 */
export async function rotateSecret(
  dataDir: string,
  userId: string,
  id: string,
  graceMs: number = DEFAULT_ROTATION_GRACE_MS,
): Promise<WebhookRecord | null> {
  const all = await loadAll(dataDir);
  const idx = all.findIndex((w) => w.id === id && w.userId === userId);
  if (idx === -1) return null;
  const cur = all[idx]!;
  const safeGrace = Math.max(60_000, Math.min(graceMs, 7 * 24 * 60 * 60_000));
  cur.previousSecret = cur.secret;
  cur.previousSecretExpiresAt = Date.now() + safeGrace;
  cur.secret = 'whsec_' + randomBytes(24).toString('hex');
  await saveAll(dataDir, all);
  return cur;
}

export async function loadAll(dataDir: string): Promise<WebhookRecord[]> {
  try {
    const raw = await readFile(subsFile(dataDir), 'utf8');
    return JSON.parse(raw) as WebhookRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveAll(dataDir: string, list: WebhookRecord[]) {
  const f = subsFile(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(list, null, 2));
}

export async function listForUser(dataDir: string, userId: string): Promise<WebhookRecord[]> {
  const all = await loadAll(dataDir);
  return all.filter((w) => w.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

export async function createWebhook(
  dataDir: string,
  userId: string,
  url: string,
  events: WebhookEvent[],
): Promise<WebhookRecord> {
  // Full SSRF check (shape + DNS) at registration time. deliverOnce repeats
  // the DNS half on every attempt to defeat rebinding.
  try {
    await assertPublicUrl(url, GUARD_OPTS);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new Error(`unsafe url: ${err.message}`);
    throw err;
  }
  // Workspace-managed destination allowlist (egress). Owners can lock
  // outbound webhooks down to an approved host set; reject at registration
  // when a URL would never pass delivery.
  const allow = await checkWebhookUrl(dataDir, userId, url);
  if (!allow.allowed) throw new Error(`blocked by webhook allowlist: ${allow.reason}`);
  if (events.length === 0) throw new Error('events must not be empty');
  for (const e of events) {
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
      throw new Error(`unknown event: ${e}`);
    }
  }
  // Workspace-managed event-type allowlist. Owners can restrict which
  // event subjects (ask.completed, etc.) may be subscribed to so a
  // compromised admin cannot register a sink for sensitive events.
  const eventAllow = await checkEventsAllowed(dataDir, userId, events);
  if (!eventAllow.allowed) throw new Error(`blocked by webhook event allowlist: ${eventAllow.reason}`);
  const all = await loadAll(dataDir);
  const record: WebhookRecord = {
    id: 'wh_' + nanoid(12),
    userId,
    url,
    events,
    secret: 'whsec_' + randomBytes(24).toString('hex'),
    active: true,
    createdAt: Date.now(),
    lastDeliveryAt: null,
    lastStatus: null,
    failureCount: 0,
  };
  all.push(record);
  await saveAll(dataDir, all);
  return record;
}

export async function updateWebhook(
  dataDir: string,
  userId: string,
  id: string,
  patch: { url?: string; events?: WebhookEvent[]; active?: boolean },
): Promise<WebhookRecord | null> {
  const all = await loadAll(dataDir);
  const idx = all.findIndex((w) => w.id === id && w.userId === userId);
  if (idx === -1) return null;
  const cur = all[idx]!;
  if (patch.url !== undefined) {
    try {
      await assertPublicUrl(patch.url, GUARD_OPTS);
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw new Error(`unsafe url: ${err.message}`);
      throw err;
    }
    const allow = await checkWebhookUrl(dataDir, userId, patch.url);
    if (!allow.allowed) throw new Error(`blocked by webhook allowlist: ${allow.reason}`);
    cur.url = patch.url;
  }
  if (patch.events !== undefined) {
    if (patch.events.length === 0) throw new Error('events must not be empty');
    for (const e of patch.events) {
      if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
        throw new Error(`unknown event: ${e}`);
      }
    }
    const eventAllow = await checkEventsAllowed(dataDir, userId, patch.events);
    if (!eventAllow.allowed) {
      throw new Error(`blocked by webhook event allowlist: ${eventAllow.reason}`);
    }
    cur.events = patch.events;
  }
  if (patch.active !== undefined) {
    cur.active = patch.active;
    if (patch.active) cur.failureCount = 0;
  }
  await saveAll(dataDir, all);
  return cur;
}

export async function deleteWebhook(dataDir: string, userId: string, id: string): Promise<boolean> {
  const all = await loadAll(dataDir);
  const next = all.filter((w) => !(w.id === id && w.userId === userId));
  if (next.length === all.length) return false;
  await saveAll(dataDir, next);
  return true;
}

export async function appendDelivery(dataDir: string, d: DeliveryRecord) {
  const f = logFile(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await appendFile(f, JSON.stringify(d) + '\n');
}

export async function listDeliveries(
  dataDir: string,
  userId: string,
  webhookId?: string,
  limit = 100,
): Promise<DeliveryRecord[]> {
  let raw = '';
  try {
    raw = await readFile(logFile(dataDir), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: DeliveryRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let rec: DeliveryRecord;
    try { rec = JSON.parse(line) as DeliveryRecord; } catch { continue; }
    if (rec.userId !== userId) continue;
    if (webhookId && rec.webhookId !== webhookId) continue;
    out.push(rec);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, Math.max(1, Math.min(limit, 1000)));
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/**
 * Attempt one delivery with up to MAX_ATTEMPTS tries, exponential backoff on
 * network errors and 5xx responses. Returns the final delivery record.
 * Exported for the test suite; the public emit() loops over subscribers.
 */
export async function deliverOnce(
  dataDir: string,
  webhook: WebhookRecord,
  event: WebhookEvent,
  payload: unknown,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  parentId?: string,
): Promise<DeliveryRecord> {
  const body = JSON.stringify({ id: 'evt_' + nanoid(12), event, ts: Date.now(), data: payload });
  let lastStatus: number | null = null;
  let lastErr: string | undefined;
  let ok = false;
  let attempt = 0;
  // Drop an expired previous secret before we sign so we never accidentally
  // emit a header with a stale credential. Persisted later via the emit()
  // bookkeeping save.
  if (webhook.previousSecret && webhook.previousSecretExpiresAt && webhook.previousSecretExpiresAt < Date.now()) {
    webhook.previousSecret = undefined;
    webhook.previousSecretExpiresAt = undefined;
  }
  for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ts = Date.now();
    const sig = sign(webhook.secret, body, ts);
    const prevSig = webhook.previousSecret ? sign(webhook.previousSecret, body, ts) : null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    const started = Date.now();
    // Re-check the target on every attempt. If the receiver's DNS now
    // points at a private / metadata address, refuse to send instead of
    // leaking the signed payload (which may carry attribution + tenant ids)
    // into an internal endpoint. We intentionally do NOT retry on this
    // failure: it is a configuration problem, not a transient network blip.
    try {
      await assertPublicUrl(webhook.url, GUARD_OPTS);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err instanceof UnsafeUrlError
        ? `blocked: ${err.message}`
        : (err as Error).message || 'url guard failed';
      lastStatus = null;
      ok = false;
      break;
    }
    // Workspace allowlist re-check. Owners can tighten the allowed-host
    // set after a webhook was registered; we must not keep firing at a
    // receiver that is no longer approved. Like the SSRF check above,
    // this is treated as a hard config failure, not a retriable error.
    const allowCheck = await checkWebhookUrl(dataDir, webhook.userId, webhook.url);
    if (!allowCheck.allowed) {
      clearTimeout(timer);
      lastErr = `blocked by webhook allowlist: ${allowCheck.reason}`;
      lastStatus = null;
      ok = false;
      break;
    }
    // Workspace event-type allowlist re-check. If an owner removed this
    // event subject from the allowlist after the subscription was made,
    // honour that immediately rather than continuing to leak payloads
    // until the admin remembers to delete the webhook. Same hard-failure
    // treatment: do not retry, log the reason, surface in delivery log.
    const evtCheck = await checkEventsAllowed(dataDir, webhook.userId, [event]);
    if (!evtCheck.allowed) {
      clearTimeout(timer);
      lastErr = `blocked by webhook event allowlist: ${evtCheck.reason}`;
      lastStatus = null;
      ok = false;
      break;
    }
    try {
      const res = await fetchImpl(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'clawmind-webhooks/1',
          'x-clawmind-event': event,
          'x-clawmind-delivery': webhook.id,
          'x-clawmind-signature': sig,
          ...(prevSig ? { 'x-clawmind-signature-prev': prevSig } : {}),
          ...(parentId ? { 'x-clawmind-redelivery-of': parentId } : {}),
        },
        body,
        signal: controller.signal,
      });
      lastStatus = res.status;
      lastErr = undefined;
      ok = res.status >= 200 && res.status < 300;
    } catch (err) {
      lastErr = (err as Error).message || 'network error';
      lastStatus = null;
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    const rec: DeliveryRecord = {
      id: 'dlv_' + nanoid(10),
      webhookId: webhook.id,
      userId: webhook.userId,
      event,
      ts: started,
      url: webhook.url,
      attempt,
      status: lastStatus,
      ok,
      error: lastErr,
      durationMs: Date.now() - started,
      payload,
      ...(parentId ? { parentId } : {}),
    };
    await appendDelivery(dataDir, rec);
    if (ok) return rec;
    // Don't retry 4xx (client misconfigured the endpoint); only retry on
    // network errors and 5xx where retrying might actually help.
    const retriable = lastStatus === null || (lastStatus >= 500 && lastStatus <= 599);
    if (!retriable) return rec;
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1] ?? 2_000));
  }
  return {
    id: 'dlv_' + nanoid(10),
    webhookId: webhook.id,
    userId: webhook.userId,
    event,
    ts: Date.now(),
    url: webhook.url,
    attempt,
    status: lastStatus,
    ok,
    error: lastErr,
    durationMs: 0,
    payload,
    ...(parentId ? { parentId } : {}),
  };
}

/**
 * Find a past delivery owned by `userId` and fire it again at the
 * webhook's current URL. Useful when a receiver was down or returned a
 * 4xx that the user has since fixed; rather than waiting for the next
 * organic event, they can replay the failed one straight from the
 * dashboard. The replayed attempt lands in the delivery log with a
 * `parentId` pointing back at the original row so the history stays
 * auditable.
 */
export async function redeliver(
  dataDir: string,
  userId: string,
  deliveryId: string,
  fetchImpl?: FetchLike,
): Promise<{ delivery: DeliveryRecord } | { error: 'not_found' } | { error: 'no_payload' } | { error: 'webhook_gone' }> {
  // Scan the log for the requested row. The log file is append-only and
  // bounded by listDeliveries readers, so a linear scan here is fine for
  // the local-first scale this app targets.
  let raw = '';
  try {
    raw = await readFile(logFile(dataDir), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { error: 'not_found' };
    throw err;
  }
  let original: DeliveryRecord | null = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let rec: DeliveryRecord;
    try { rec = JSON.parse(line) as DeliveryRecord; } catch { continue; }
    if (rec.id === deliveryId && rec.userId === userId) { original = rec; break; }
  }
  if (!original) return { error: 'not_found' };
  // Deliveries logged before this feature shipped don't carry their
  // payload. We can't faithfully replay those, so surface a clear error
  // instead of inventing data.
  if (typeof original.payload === 'undefined') return { error: 'no_payload' };
  const all = await loadAll(dataDir);
  const wh = all.find((w) => w.id === original.webhookId && w.userId === userId);
  if (!wh) return { error: 'webhook_gone' };
  const rec = await deliverOnce(dataDir, wh, original.event, original.payload, fetchImpl, original.id);
  // Mirror the bookkeeping that emit() does for organic fires so the
  // webhook card on the dashboard reflects the latest manual attempt too.
  wh.lastDeliveryAt = Date.now();
  wh.lastStatus = rec.status;
  if (rec.ok) wh.failureCount = 0;
  await saveAll(dataDir, all);
  return { delivery: rec };
}

/**
 * Fire an event to every active subscriber that listens for it. Failures
 * are isolated per subscriber so one bad endpoint cannot block delivery to
 * the rest. Updates last status / failure counters and auto-disables a
 * subscription after AUTO_DISABLE_AFTER consecutive failures.
 */
export async function emit(
  dataDir: string,
  event: WebhookEvent,
  payload: unknown,
  userId: string,
  fetchImpl?: FetchLike,
): Promise<void> {
  const all = await loadAll(dataDir);
  const targets = all.filter((w) => w.userId === userId && w.active && w.events.includes(event));
  if (targets.length === 0) return;
  let changed = false;
  for (const wh of targets) {
    try {
      const result = await deliverOnce(dataDir, wh, event, payload, fetchImpl);
      wh.lastDeliveryAt = Date.now();
      wh.lastStatus = result.status;
      if (result.ok) {
        wh.failureCount = 0;
      } else {
        wh.failureCount += 1;
        if (wh.failureCount >= AUTO_DISABLE_AFTER) {
          wh.active = false;
          void notify(dataDir, {
            userId: wh.userId,
            kind: 'webhook.disabled',
            title: 'Webhook disabled after repeated failures',
            body: `${wh.url} failed ${wh.failureCount} times in a row and was paused.`,
            href: '/webhooks',
            meta: { webhookId: wh.id, url: wh.url, failureCount: wh.failureCount },
          });
        }
      }
      changed = true;
    } catch {
      // Never let webhook bookkeeping break the user-facing request that
      // triggered the emit. Errors already land in the delivery log.
    }
  }
  if (changed) await saveAll(dataDir, all);
}

/**
 * Fire an event to every active subscriber across every workspace owner.
 * Used for tenant-wide system events (notably `audit.event`) where the
 * subscriber is a SIEM connector installed at workspace level and the
 * triggering actor may differ from the webhook owner. Per-subscriber
 * failures are isolated and bookkeeping mirrors emit().
 */
export async function emitToAll(
  dataDir: string,
  event: WebhookEvent,
  payload: unknown,
  fetchImpl?: FetchLike,
): Promise<void> {
  const all = await loadAll(dataDir);
  const targets = all.filter((w) => w.active && w.events.includes(event));
  if (targets.length === 0) return;
  let changed = false;
  for (const wh of targets) {
    try {
      const result = await deliverOnce(dataDir, wh, event, payload, fetchImpl);
      wh.lastDeliveryAt = Date.now();
      wh.lastStatus = result.status;
      if (result.ok) {
        wh.failureCount = 0;
      } else {
        wh.failureCount += 1;
        if (wh.failureCount >= AUTO_DISABLE_AFTER) {
          wh.active = false;
          void notify(dataDir, {
            userId: wh.userId,
            kind: 'webhook.disabled',
            title: 'Webhook disabled after repeated failures',
            body: `${wh.url} failed ${wh.failureCount} times in a row and was paused.`,
            href: '/webhooks',
            meta: { webhookId: wh.id, url: wh.url, failureCount: wh.failureCount },
          });
        }
      }
      changed = true;
    } catch {
      // Never let webhook bookkeeping break the caller. Errors already
      // landed in the per-subscriber delivery log.
    }
  }
  if (changed) await saveAll(dataDir, all);
}

export function redact(w: WebhookRecord) {
  // Hide the secret on list reads; it is only returned once at create time.
  // Also drop the previousSecret blob (still surface its expiry so the UI
  // can render a "grace period ends in X" badge).
  return { ...w, secret: undefined, previousSecret: undefined };
}
