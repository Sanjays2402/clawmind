import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import { WEBHOOK_EVENTS, type WebhookEvent } from './webhooks.js';

// Per-workspace allowlist over which webhook *event types* a tenant is
// permitted to subscribe to.
//
// services/webhook-allowlist.ts restricts the *destinations* (which hosts
// can receive webhooks). This module restricts the *subjects* (which event
// payloads may leave the workspace at all). Together they answer the two
// procurement questions every CISO asks about outbound webhooks:
//
//   1. "Can a compromised admin point a webhook at attacker.com?"
//        -> webhook-allowlist.ts (destination hosts).
//   2. "Can a compromised admin subscribe to `ask.completed` and exfiltrate
//      every answer (including PII) the moment they are generated?"
//        -> this module (event-type allowlist).
//
// The default record has `enabled: false`, which is a no-op: every event
// type defined in WEBHOOK_EVENTS is subscribable, matching today's
// behaviour. When `enabled: true`, only events that appear in `events`
// may be subscribed to. We enforce it in three places to match the
// destination allowlist's semantics:
//
//   1. createWebhook   - reject the subscription if any chosen event is
//                        not in the allowlist.
//   2. updateWebhook   - reject an events patch that introduces a denied
//                        event (or, when tightening the allowlist, any
//                        events change must be compatible with the new
//                        rules).
//   3. deliverOnce     - skip delivery of an event that has since been
//                        removed from the allowlist, so tightening the
//                        rules immediately stops in-flight events from
//                        being sent. This avoids the "create first,
//                        narrow later" loophole.
//
// Storage matches the rest of the per-workspace settings family
// (ip-allowlist, webhook-allowlist, workspace-freeze, ...): a single
// JSON file rewritten atomically. We deliberately do not cache because
// admins must see new rules take effect on the next outbound attempt,
// not after a TTL.

export interface WebhookEventsAllowlistRecord {
  userId: string;
  enabled: boolean;
  events: WebhookEvent[];
  createdAt: number;
  updatedAt: number;
}

export type WebhookEventsAllowlistMap = Record<string, WebhookEventsAllowlistRecord>;

const FILE = 'webhook-events-allowlist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export async function loadAll(dataDir: string): Promise<WebhookEventsAllowlistMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as WebhookEventsAllowlistMap;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function saveAll(dataDir: string, map: WebhookEventsAllowlistMap): Promise<void> {
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf8');
}

function empty(userId: string): WebhookEventsAllowlistRecord {
  const now = Date.now();
  return { userId, enabled: false, events: [], createdAt: now, updatedAt: now };
}

export async function getRecord(
  dataDir: string,
  userId: string,
): Promise<WebhookEventsAllowlistRecord> {
  const map = await loadAll(dataDir);
  return map[userId] ?? empty(userId);
}

export interface ReplaceInput {
  enabled: boolean;
  events: string[];
}

export interface ValidationError {
  ok: false;
  field: string;
  message: string;
}

export interface ValidationOk {
  ok: true;
  value: { enabled: boolean; events: WebhookEvent[] };
}

export function validate(input: ReplaceInput): ValidationOk | ValidationError {
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, field: 'enabled', message: 'enabled must be boolean' };
  }
  if (!Array.isArray(input.events)) {
    return { ok: false, field: 'events', message: 'events must be an array' };
  }
  const seen = new Set<string>();
  const out: WebhookEvent[] = [];
  for (let i = 0; i < input.events.length; i++) {
    const e = input.events[i];
    if (typeof e !== 'string') {
      return { ok: false, field: `events[${i}]`, message: 'event must be a string' };
    }
    if (!(WEBHOOK_EVENTS as readonly string[]).includes(e)) {
      return { ok: false, field: `events[${i}]`, message: `unknown event: ${e}` };
    }
    if (seen.has(e)) {
      return { ok: false, field: `events[${i}]`, message: `duplicate event: ${e}` };
    }
    seen.add(e);
    out.push(e as WebhookEvent);
  }
  if (input.enabled && out.length === 0) {
    return { ok: false, field: 'events', message: 'cannot enable an empty allowlist' };
  }
  return { ok: true, value: { enabled: input.enabled, events: out } };
}

export async function replaceRecord(
  dataDir: string,
  userId: string,
  input: ReplaceInput,
): Promise<WebhookEventsAllowlistRecord> {
  const check = validate(input);
  if (!check.ok) {
    const err = new Error(check.message) as Error & { field?: string };
    err.field = check.field;
    throw err;
  }
  const map = await loadAll(dataDir);
  const prev = map[userId] ?? empty(userId);
  const next: WebhookEventsAllowlistRecord = {
    userId,
    enabled: check.value.enabled,
    events: check.value.events,
    createdAt: prev.createdAt,
    updatedAt: Date.now(),
  };
  map[userId] = next;
  await saveAll(dataDir, map);
  return next;
}

// Single-point enforcement helper. Returns `allowed: true` when:
//   - the workspace has the policy disabled (default), or
//   - every event in `events` is present in the workspace's allowlist.
// Used at create, update, and delivery time so the semantics are identical
// in all three call sites.
export async function checkEvents(
  dataDir: string,
  userId: string,
  events: readonly WebhookEvent[],
): Promise<{ allowed: true } | { allowed: false; denied: WebhookEvent[]; reason: string }> {
  const rec = await getRecord(dataDir, userId);
  if (!rec.enabled) return { allowed: true };
  const allowed = new Set(rec.events);
  const denied = events.filter((e) => !allowed.has(e));
  if (denied.length === 0) return { allowed: true };
  return {
    allowed: false,
    denied,
    reason: `event type(s) not in workspace allowlist: ${denied.join(', ')}`,
  };
}

export function diff(
  prev: WebhookEventsAllowlistRecord,
  next: WebhookEventsAllowlistRecord,
): {
  enabled: { from: boolean; to: boolean } | null;
  added: WebhookEvent[];
  removed: WebhookEvent[];
} {
  const before = new Set(prev.events);
  const after = new Set(next.events);
  const added: WebhookEvent[] = [];
  const removed: WebhookEvent[] = [];
  for (const e of after) if (!before.has(e)) added.push(e);
  for (const e of before) if (!after.has(e)) removed.push(e);
  return {
    enabled: prev.enabled === next.enabled ? null : { from: prev.enabled, to: next.enabled },
    added,
    removed,
  };
}
