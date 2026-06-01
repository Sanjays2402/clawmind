// Workspace audit-log SIEM drains.
//
// What this provides: workspace owners register one or more HTTPS sinks
// (Splunk HEC, Datadog logs, a generic webhook, …); a background worker
// tails the local audit log and pushes new events to each sink as a
// signed JSONL batch. This is the continuous-monitoring half of audit
// (SOC2 CC7.2 / ISO 27001 A.12.4.1) that the existing pull-only
// /v1/admin/audit/export route does not satisfy: regulators expect the
// log to leave the box without an operator pressing a button.
//
// Design notes:
//   - Per-drain cursor (last delivered event ts + id) persisted to disk so
//     a restart does not replay the whole log nor drop events between the
//     last delivery and shutdown.
//   - Each batch carries an HMAC-SHA256 over the raw body using a secret
//     unique to the drain so the receiver can authenticate the sender and
//     reject replays (we include a monotonically increasing sequence and
//     timestamp inside the signed envelope).
//   - Exponential backoff (capped) with a bounded dead-letter list so a
//     transient receiver outage does not block the queue but a permanently
//     broken endpoint is visible to the operator instead of silently
//     swallowing audit traffic.
//   - Pure file storage (JSON) to match the rest of the codebase; no new
//     runtime dependency.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export type DrainKind = 'generic' | 'splunk-hec' | 'datadog';

export interface AuditDrain {
  id: string;
  kind: DrainKind;
  url: string;
  // Stored in plain text on disk like every other workspace secret in
  // this repo (webhooks.ts, encryption.ts). The trust model is "only the
  // workspace owner reads the data dir"; we mirror it for consistency
  // with the audit anchor secret rather than inventing a new envelope.
  secret: string;
  enabled: boolean;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  // Delivery state.
  lastCursor: { ts: number; id: string } | null;
  lastDeliveryAt: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  delivered: number;
  dropped: number;
}

// Public projection that never returns the shared secret. The secret is
// shown exactly once at create time (and on explicit rotation) so a
// browser cannot exfiltrate it on a refresh.
export type AuditDrainPublic = Omit<AuditDrain, 'secret'> & {
  secretFingerprint: string;
};

export interface DeadLetter {
  id: string;
  drainId: string;
  ts: number;
  count: number;
  status: number | null;
  error: string;
  cursor: { ts: number; id: string };
}

interface Storage {
  drains: AuditDrain[];
  dead: DeadLetter[];
}

const DIR = 'audit-drains';
const FILE = 'drains.json';
const TMP = 'drains.json.tmp';

function storageDir(dataDir: string): string {
  return join(dataDir, DIR);
}
function storagePath(dataDir: string): string {
  return join(storageDir(dataDir), FILE);
}

async function read(dataDir: string): Promise<Storage> {
  try {
    const raw = await readFile(storagePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Storage>;
    return {
      drains: Array.isArray(parsed.drains) ? parsed.drains : [],
      dead: Array.isArray(parsed.dead) ? parsed.dead : [],
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { drains: [], dead: [] };
    }
    throw err;
  }
}

async function writeAtomic(dataDir: string, s: Storage): Promise<void> {
  await mkdir(storageDir(dataDir), { recursive: true });
  const tmp = join(storageDir(dataDir), TMP);
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8');
  await rename(tmp, storagePath(dataDir));
}

function fingerprint(secret: string): string {
  return createHmac('sha256', 'clawmind-drain-fingerprint')
    .update(secret)
    .digest('hex')
    .slice(0, 12);
}

function toPublic(d: AuditDrain): AuditDrainPublic {
  const { secret, ...rest } = d;
  return { ...rest, secretFingerprint: fingerprint(secret) };
}

// URL guard: only http/https, no embedded credentials, no obvious link-
// local / loopback IPv4 unless explicitly enabled via env. The webhooks
// service has a richer SSRF guard; we route through that when available
// but keep an inline fallback so this module remains independently
// testable.
export function validateUrl(u: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'embedded_credentials_forbidden' };
  }
  const host = url.hostname;
  // Block obvious loopback / metadata. Operators on localhost dev should
  // override via webhook allowlist if needed.
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('169.254.')
  ) {
    if (process.env.CLAWMIND_ALLOW_LOOPBACK_DRAINS !== '1') {
      return { ok: false, reason: 'loopback_forbidden' };
    }
  }
  return { ok: true };
}

const KINDS: readonly DrainKind[] = ['generic', 'splunk-hec', 'datadog'];

export function validateKind(k: unknown): k is DrainKind {
  return typeof k === 'string' && (KINDS as readonly string[]).includes(k);
}

// Create a new drain. The secret is auto-generated if the caller does
// not supply one; we return the full record (including the plaintext
// secret) so the route layer can surface it exactly once.
export async function createDrain(
  dataDir: string,
  actor: string,
  input: { kind: DrainKind; url: string; secret?: string; enabled?: boolean },
): Promise<{ ok: true; drain: AuditDrain } | { ok: false; reason: string }> {
  if (!validateKind(input.kind)) return { ok: false, reason: 'invalid_kind' };
  const v = validateUrl(input.url);
  if (!v.ok) return { ok: false, reason: v.reason };
  const secret =
    input.secret && input.secret.length >= 16
      ? input.secret
      : randomBytes(32).toString('hex');
  if (secret.length > 256) return { ok: false, reason: 'secret_too_long' };
  const now = Date.now();
  const drain: AuditDrain = {
    id: `drn_${randomBytes(8).toString('hex')}`,
    kind: input.kind,
    url: input.url,
    secret,
    enabled: input.enabled !== false,
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
    lastCursor: null,
    lastDeliveryAt: null,
    lastError: null,
    consecutiveFailures: 0,
    delivered: 0,
    dropped: 0,
  };
  const s = await read(dataDir);
  if (s.drains.length >= 16) return { ok: false, reason: 'too_many_drains' };
  s.drains.push(drain);
  await writeAtomic(dataDir, s);
  return { ok: true, drain };
}

export async function listDrains(dataDir: string): Promise<AuditDrainPublic[]> {
  const s = await read(dataDir);
  return s.drains.map(toPublic);
}

export async function getDrain(
  dataDir: string,
  id: string,
): Promise<AuditDrainPublic | null> {
  const s = await read(dataDir);
  const d = s.drains.find((x) => x.id === id);
  return d ? toPublic(d) : null;
}

export async function updateDrain(
  dataDir: string,
  id: string,
  actor: string,
  patch: { enabled?: boolean; url?: string },
): Promise<{ ok: true; drain: AuditDrainPublic } | { ok: false; reason: string }> {
  const s = await read(dataDir);
  const d = s.drains.find((x) => x.id === id);
  if (!d) return { ok: false, reason: 'not_found' };
  if (patch.url !== undefined) {
    const v = validateUrl(patch.url);
    if (!v.ok) return { ok: false, reason: v.reason };
    d.url = patch.url;
  }
  if (patch.enabled !== undefined) {
    d.enabled = patch.enabled;
    if (patch.enabled) {
      // Clearing the error gate on re-enable gives the worker a fresh
      // chance immediately rather than waiting for the next backoff slot.
      d.consecutiveFailures = 0;
      d.lastError = null;
    }
  }
  d.updatedAt = Date.now();
  d.updatedBy = actor;
  await writeAtomic(dataDir, s);
  return { ok: true, drain: toPublic(d) };
}

export async function rotateSecret(
  dataDir: string,
  id: string,
  actor: string,
): Promise<{ ok: true; secret: string } | { ok: false; reason: string }> {
  const s = await read(dataDir);
  const d = s.drains.find((x) => x.id === id);
  if (!d) return { ok: false, reason: 'not_found' };
  d.secret = randomBytes(32).toString('hex');
  d.updatedAt = Date.now();
  d.updatedBy = actor;
  await writeAtomic(dataDir, s);
  return { ok: true, secret: d.secret };
}

export async function deleteDrain(
  dataDir: string,
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const s = await read(dataDir);
  const before = s.drains.length;
  s.drains = s.drains.filter((x) => x.id !== id);
  s.dead = s.dead.filter((x) => x.drainId !== id);
  if (s.drains.length === before) return { ok: false, reason: 'not_found' };
  await writeAtomic(dataDir, s);
  return { ok: true };
}

export async function listDeadLetters(
  dataDir: string,
  drainId?: string,
): Promise<DeadLetter[]> {
  const s = await read(dataDir);
  return drainId ? s.dead.filter((x) => x.drainId === drainId) : s.dead;
}

// Build the signed envelope that wraps the JSONL batch. The receiver
// authenticates by recomputing HMAC-SHA256(secret, body) and comparing
// constant-time against the X-ClawMind-Signature header.
//
// The body format is intentionally newline-delimited JSON so the
// receiver can stream it into Splunk HEC (each event a separate POST)
// or Datadog logs without re-parsing. We also include a JSON envelope
// header line on the very first line so the receiver sees the workspace
// id, drain id, batch sequence, and cursor without needing to consult
// the headers.

export interface DeliveryEnvelope {
  drainId: string;
  sequence: number;
  ts: number;
  count: number;
  cursorBefore: { ts: number; id: string } | null;
  cursorAfter: { ts: number; id: string };
}

export function buildBody(env: DeliveryEnvelope, events: unknown[]): string {
  const header = JSON.stringify({ __clawmind_drain__: env });
  const lines = events.map((e) => JSON.stringify(e));
  return [header, ...lines].join('\n') + '\n';
}

export function signBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

// Helper used only by tests / receivers that re-implement the verify
// path. Exposed so the receiver can constant-time compare without
// reimplementing the buffer dance.
export function verifySignature(
  secret: string,
  body: string,
  presented: string,
): boolean {
  const expected = signBody(secret, body);
  const a = Buffer.from(expected, 'hex');
  let b: Buffer;
  try {
    b = Buffer.from(presented, 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Compute next attempt time for a drain that has just failed. Capped at
// 1 hour so a temporarily-broken receiver does not back off into a state
// the worker effectively never retries.
export function nextRetryDelayMs(consecutiveFailures: number): number {
  const base = 1000;
  const max = 60 * 60 * 1000;
  const exp = Math.min(max, base * Math.pow(2, Math.min(consecutiveFailures, 12)));
  return exp;
}

// Drain worker. Tails the audit log iterator from each drain's last
// cursor, batches up to `maxBatch` events, posts them with HMAC, and
// updates the cursor on 2xx. On failure we increment consecutiveFailures
// and skip future ticks until nextRetryDelayMs has elapsed.
//
// The caller wires this with setInterval in the server bootstrap. The
// worker itself is single-shot: it takes one pass over every drain and
// returns. This makes the test surface trivial (call run() in a test,
// assert state) and keeps the interval the only knob.

export interface RunOptions {
  dataDir: string;
  iterate: (since: number) => AsyncIterable<{
    ts: number;
    id: string;
    [k: string]: unknown;
  }>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxBatch?: number;
  maxDeadLetters?: number;
}

export interface RunResult {
  attempted: number;
  delivered: number;
  failed: number;
  skipped: number;
}

export async function runOnce(opts: RunOptions): Promise<RunResult> {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const maxBatch = Math.max(1, Math.min(500, opts.maxBatch ?? 100));
  const maxDead = Math.max(1, Math.min(1000, opts.maxDeadLetters ?? 100));
  const s = await read(opts.dataDir);
  let attempted = 0;
  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  for (const d of s.drains) {
    if (!d.enabled) {
      skipped++;
      continue;
    }
    // Backoff gate. lastDeliveryAt always advances on attempt (success
    // or fail) so we can compare against now().
    if (d.consecutiveFailures > 0 && d.lastDeliveryAt) {
      const due = d.lastDeliveryAt + nextRetryDelayMs(d.consecutiveFailures);
      if (now() < due) {
        skipped++;
        continue;
      }
    }

    const sinceTs = d.lastCursor?.ts ?? 0;
    const sinceId = d.lastCursor?.id ?? '';
    const batch: { ts: number; id: string; [k: string]: unknown }[] = [];
    for await (const ev of opts.iterate(sinceTs)) {
      // The iterator returns events at-or-after sinceTs because filtering
      // happens in the audit-log layer at millisecond granularity; we
      // need a stable secondary key so two events written in the same
      // millisecond do not deduplicate the older one out. We use id
      // string comparison; ids are time-ordered nanoids in this repo.
      if (ev.ts < sinceTs) continue;
      if (ev.ts === sinceTs && ev.id <= sinceId) continue;
      batch.push(ev);
      if (batch.length >= maxBatch) break;
    }
    if (batch.length === 0) {
      skipped++;
      continue;
    }
    attempted++;

    const env: DeliveryEnvelope = {
      drainId: d.id,
      sequence: d.delivered + 1,
      ts: now(),
      count: batch.length,
      cursorBefore: d.lastCursor,
      cursorAfter: { ts: batch[batch.length - 1]!.ts, id: batch[batch.length - 1]!.id },
    };
    const body = buildBody(env, batch);
    const signature = signBody(d.secret, body);

    const headers: Record<string, string> = {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'x-clawmind-signature': `sha256=${signature}`,
      'x-clawmind-drain-id': d.id,
      'x-clawmind-sequence': String(env.sequence),
      'x-clawmind-event-count': String(batch.length),
    };
    if (d.kind === 'splunk-hec') {
      headers['authorization'] = `Splunk ${d.secret}`;
    } else if (d.kind === 'datadog') {
      headers['dd-api-key'] = d.secret;
    }

    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetchImpl(d.url, {
        method: 'POST',
        headers,
        body,
        // Short timeout: a healthy SIEM accepts a batch in well under
        // 10s. AbortSignal.timeout is in Node 20+.
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) {
        error = `http_${res.status}`;
      }
    } catch (err: unknown) {
      error = (err as Error).message || 'fetch_failed';
    }

    d.lastDeliveryAt = now();
    if (!error) {
      d.lastCursor = env.cursorAfter;
      d.lastError = null;
      d.consecutiveFailures = 0;
      d.delivered += batch.length;
      delivered++;
    } else {
      d.lastError = error;
      d.consecutiveFailures++;
      failed++;
      // After many consecutive failures, we declare this batch dead so
      // the cursor advances and we do not block fresh audit traffic on
      // a permanently broken receiver. 6 failures over capped backoff
      // is roughly an hour.
      if (d.consecutiveFailures >= 6) {
        s.dead.unshift({
          id: `dl_${randomBytes(6).toString('hex')}`,
          drainId: d.id,
          ts: now(),
          count: batch.length,
          status,
          error,
          cursor: env.cursorAfter,
        });
        if (s.dead.length > maxDead) s.dead.length = maxDead;
        d.lastCursor = env.cursorAfter;
        d.dropped += batch.length;
        d.consecutiveFailures = 0;
        d.lastError = `dead_lettered_after_repeated_failures:${error}`;
      }
    }
  }
  await writeAtomic(opts.dataDir, s);
  return { attempted, delivered, failed, skipped };
}
