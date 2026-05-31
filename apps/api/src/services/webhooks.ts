import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { notify } from './notifications.js';

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

export const WEBHOOK_EVENTS = ['ask.completed', 'ingest.completed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookRecord {
  id: string;
  userId: string;
  url: string;
  events: WebhookEvent[];
  secret: string;          // shown to the user; used to sign payloads
  active: boolean;
  createdAt: number;
  lastDeliveryAt: number | null;
  lastStatus: number | null;   // last HTTP status code we observed
  failureCount: number;        // consecutive failures since last success
}

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
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sign(secret: string, body: string, ts: number = Date.now()): string {
  const mac = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return `t=${ts},v1=${mac}`;
}

export function verify(secret: string, body: string, header: string, toleranceMs = 5 * 60_000): boolean {
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
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  if (expected.length !== v1.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch {
    return false;
  }
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
  if (!isValidUrl(url)) throw new Error('invalid url');
  if (events.length === 0) throw new Error('events must not be empty');
  for (const e of events) {
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
      throw new Error(`unknown event: ${e}`);
    }
  }
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
    if (!isValidUrl(patch.url)) throw new Error('invalid url');
    cur.url = patch.url;
  }
  if (patch.events !== undefined) {
    if (patch.events.length === 0) throw new Error('events must not be empty');
    for (const e of patch.events) {
      if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
        throw new Error(`unknown event: ${e}`);
      }
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
): Promise<DeliveryRecord> {
  const body = JSON.stringify({ id: 'evt_' + nanoid(12), event, ts: Date.now(), data: payload });
  let lastStatus: number | null = null;
  let lastErr: string | undefined;
  let ok = false;
  let attempt = 0;
  for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ts = Date.now();
    const sig = sign(webhook.secret, body, ts);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    const started = Date.now();
    try {
      const res = await fetchImpl(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'clawmind-webhooks/1',
          'x-clawmind-event': event,
          'x-clawmind-delivery': webhook.id,
          'x-clawmind-signature': sig,
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
  };
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

export function redact(w: WebhookRecord) {
  // Hide the secret on list reads; it is only returned once at create time.
  return { ...w, secret: undefined };
}
