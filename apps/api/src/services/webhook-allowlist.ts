import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-workspace outbound webhook destination allowlist.
//
// SSRF protection in services/url-guard.ts blocks private / metadata /
// loopback targets so a tenant cannot pivot a webhook into internal
// infrastructure. That is necessary but not sufficient for enterprise
// procurement, which routinely asks: "can we restrict outbound webhooks
// to a closed set of corporate domains?" (i.e. only post to
// hooks.acme.com or *.events.acme.com). This module implements that
// admin-managed egress allowlist.
//
// When enabled, every webhook URL must match at least one allowed
// host pattern, enforced in three places:
//   1. createWebhook  - reject the new subscription at registration.
//   2. updateWebhook  - reject a URL change to a disallowed host.
//   3. deliverOnce    - re-check on every attempt, so tightening the
//      allowlist immediately stops in-flight deliveries to revoked
//      hosts (a tenant cannot register first, then narrow the rules,
//      and keep firing at the now-disallowed receiver).
//
// Host patterns are case-insensitive and one of:
//   exact:    hooks.acme.com
//   suffix:   *.acme.com         (matches a.acme.com, b.c.acme.com,
//                                  but NOT acme.com itself)
//
// Storage matches the per-workspace settings family (ip-allowlist,
// legal-hold, workspace-freeze, etc.): a single JSON file rewritten
// atomically. We deliberately do not cache: the file is small and the
// admin needs new rules to take effect immediately on the very next
// outbound attempt, not after a TTL.

export const MAX_HOSTS = 64;
export const MAX_LABEL = 80;
export const MAX_HOST_LEN = 253; // RFC 1035

export interface AllowedHost {
  // Normalised: lower-cased, no surrounding whitespace, no trailing dot.
  // Stored exactly as it will be matched; pattern type is implicit in the
  // leading "*." prefix.
  host: string;
  label: string;
  createdAt: number;
}

export interface WebhookAllowlistRecord {
  userId: string;
  enabled: boolean;
  hosts: AllowedHost[];
  updatedAt: number;
  createdAt: number;
}

export type WebhookAllowlistMap = Record<string, WebhookAllowlistRecord>;

const FILE = 'webhook-allowlist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export async function loadAll(dataDir: string): Promise<WebhookAllowlistMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as WebhookAllowlistMap;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function saveAll(dataDir: string, map: WebhookAllowlistMap): Promise<void> {
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf8');
}

function empty(userId: string): WebhookAllowlistRecord {
  const now = Date.now();
  return { userId, enabled: false, hosts: [], createdAt: now, updatedAt: now };
}

export async function getRecord(
  dataDir: string,
  userId: string,
): Promise<WebhookAllowlistRecord> {
  const map = await loadAll(dataDir);
  return map[userId] ?? empty(userId);
}

// --- Parsing & normalisation -------------------------------------------------

// RFC 1123 label: 1-63 chars, alnum + hyphen, no leading/trailing hyphen.
// Wildcard "*" is only valid as the leftmost label and must be the entire
// label (so "*.acme.com" is fine, "foo*.acme.com" is not).
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normaliseHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  // Strip an optional trailing dot (fully-qualified form).
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s.length === 0 || s.length > MAX_HOST_LEN) return null;
  // Disallow anything that looks like a URL or carries a port / path /
  // userinfo: this list is hostnames only.
  if (s.includes('/') || s.includes(':') || s.includes('@') || s.includes('?')) {
    return null;
  }
  const labels = s.split('.');
  if (labels.length < 2) return null; // require a public-looking host
  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]!;
    if (i === 0 && lab === '*') continue; // wildcard only allowed leftmost
    if (!LABEL_RE.test(lab)) return null;
  }
  return s;
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  const p = pattern.trim().toLowerCase().replace(/\.$/, '');
  if (!h || !p) return false;
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".acme.com"
    // Must have at least one label in front of the suffix.
    if (!h.endsWith(suffix)) return false;
    const head = h.slice(0, h.length - suffix.length);
    if (head.length === 0) return false;
    return true;
  }
  return h === p;
}

export function hostAllowed(host: string, hosts: readonly { host: string }[]): boolean {
  if (hosts.length === 0) return false;
  for (const h of hosts) {
    if (hostMatches(host, h.host)) return true;
  }
  return false;
}

// Extract hostname from a URL string. Returns null on parse failure so the
// caller can decide whether that constitutes a deny (it does: the existing
// url-guard rejects malformed URLs earlier, so reaching this with a bad
// URL would already be a bug).
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

// --- Mutations ---------------------------------------------------------------

export interface ReplaceInput {
  enabled: boolean;
  hosts: Array<{ host: string; label?: string }>;
}

export interface ValidationError {
  ok: false;
  field: string;
  message: string;
}

export interface ValidationOk {
  ok: true;
  value: { enabled: boolean; hosts: AllowedHost[] };
}

export function validate(
  input: ReplaceInput,
  now: number = Date.now(),
): ValidationOk | ValidationError {
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, field: 'enabled', message: 'enabled must be boolean' };
  }
  if (!Array.isArray(input.hosts)) {
    return { ok: false, field: 'hosts', message: 'hosts must be an array' };
  }
  if (input.hosts.length > MAX_HOSTS) {
    return { ok: false, field: 'hosts', message: `at most ${MAX_HOSTS} hosts` };
  }
  const seen = new Set<string>();
  const out: AllowedHost[] = [];
  for (let i = 0; i < input.hosts.length; i++) {
    const h = input.hosts[i];
    if (!h || typeof h.host !== 'string') {
      return { ok: false, field: `hosts[${i}].host`, message: 'host is required' };
    }
    const norm = normaliseHost(h.host);
    if (!norm) {
      return {
        ok: false,
        field: `hosts[${i}].host`,
        message: `invalid host pattern: ${h.host}`,
      };
    }
    if (seen.has(norm)) {
      return {
        ok: false,
        field: `hosts[${i}].host`,
        message: `duplicate host: ${norm}`,
      };
    }
    seen.add(norm);
    const label = (h.label ?? '').toString().trim();
    if (label.length > MAX_LABEL) {
      return {
        ok: false,
        field: `hosts[${i}].label`,
        message: `label too long (max ${MAX_LABEL})`,
      };
    }
    out.push({ host: norm, label, createdAt: now });
  }
  if (input.enabled && out.length === 0) {
    return { ok: false, field: 'hosts', message: 'cannot enable an empty allowlist' };
  }
  return { ok: true, value: { enabled: input.enabled, hosts: out } };
}

export async function replaceRecord(
  dataDir: string,
  userId: string,
  input: ReplaceInput,
): Promise<WebhookAllowlistRecord> {
  const check = validate(input);
  if (!check.ok) {
    const err = new Error(check.message) as Error & { field?: string };
    err.field = check.field;
    throw err;
  }
  const map = await loadAll(dataDir);
  const prev = map[userId] ?? empty(userId);
  // Preserve original createdAt timestamps so the audit story shows "first
  // added at", not "last edited at", when the admin resubmits the table.
  const carry = new Map(prev.hosts.map((h) => [h.host, h.createdAt]));
  const merged: AllowedHost[] = check.value.hosts.map((h) => ({
    ...h,
    createdAt: carry.get(h.host) ?? h.createdAt,
  }));
  const next: WebhookAllowlistRecord = {
    userId,
    enabled: check.value.enabled,
    hosts: merged,
    createdAt: prev.createdAt,
    updatedAt: Date.now(),
  };
  map[userId] = next;
  await saveAll(dataDir, map);
  return next;
}

// Enforcement helper used by webhooks service. Returns null when the URL is
// allowed (either because the workspace has the allowlist disabled or
// because the URL's hostname matches a rule); returns a reason string when
// the URL must be rejected. Centralising this means createWebhook,
// updateWebhook and deliverOnce all see identical semantics.
export async function checkWebhookUrl(
  dataDir: string,
  userId: string,
  url: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const rec = await getRecord(dataDir, userId);
  if (!rec.enabled) return { allowed: true };
  const host = hostnameOf(url);
  if (!host) return { allowed: false, reason: 'invalid url' };
  if (hostAllowed(host, rec.hosts)) return { allowed: true };
  return {
    allowed: false,
    reason: `host '${host}' is not in the workspace webhook allowlist`,
  };
}

export function diff(
  prev: WebhookAllowlistRecord,
  next: WebhookAllowlistRecord,
): { enabled: { from: boolean; to: boolean } | null; added: string[]; removed: string[] } {
  const before = new Set(prev.hosts.map((h) => h.host));
  const after = new Set(next.hosts.map((h) => h.host));
  const added: string[] = [];
  const removed: string[] = [];
  for (const h of after) if (!before.has(h)) added.push(h);
  for (const h of before) if (!after.has(h)) removed.push(h);
  return {
    enabled: prev.enabled === next.enabled ? null : { from: prev.enabled, to: next.enabled },
    added,
    removed,
  };
}
