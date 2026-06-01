import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import { normaliseRule, ipAllowed as ipAllowedByRules } from './ip-allowlist.js';

// API keys for programmatic clients (CLI, scripts, the watcher daemon).
//
// On creation we generate a 256-bit random secret, prefix it with `cm_` so it
// is obvious in logs, and store only its sha256 in keys.json. The plaintext
// secret is shown exactly once. Lookup is constant-time on the digest.
//
// Each key carries a role ('owner' or 'reader'), a label for humans, the user
// it was issued to, and an optional expiry. We track lastUsedAt so dormant
// keys can be reaped.

export const KEY_PREFIX = 'cm_';
export type KeyRole = 'owner' | 'reader';

// Scopes restrict an API key to a subset of resources. The format is a small
// 'resource:action' grammar (e.g. 'search:read', 'ingest:write'), with the
// special wildcard '*' meaning "every scope" so an unscoped key keeps the
// pre-scope behaviour. Scopes compose with the role: a 'reader' key with
// scope ['ingest:write'] still cannot mutate because role gates the verb,
// while an 'owner' key with scope ['search:read'] is restricted to read-only
// search even though its role would otherwise allow more.
export const WILDCARD_SCOPE = '*';
export const SCOPE_RE = /^[a-z][a-z0-9-]*:(read|write|admin)$/;

export function isValidScope(scope: string): boolean {
  return scope === WILDCARD_SCOPE || SCOPE_RE.test(scope);
}

/**
 * Return true if the granted scope list satisfies the requested scope.
 * Empty/missing granted means unscoped (legacy keys) and satisfies
 * everything. Otherwise a key matches when its list contains '*' or the
 * exact requested scope.
 */
export function hasScope(granted: string[] | undefined | null, requested: string): boolean {
  if (!granted || granted.length === 0) return true;
  if (granted.includes(WILDCARD_SCOPE)) return true;
  return granted.includes(requested);
}

export interface ApiKeyRecord {
  id: string;
  userId: string;
  label: string;
  role: KeyRole;
  hash: string;            // sha256 hex of the plaintext secret
  scopes?: string[];       // optional allowlist; undefined/empty == unrestricted
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  // Rotation support. When a key is rotated we issue a new secret but keep
  // the previous hash valid for a short grace window so clients can swap the
  // credential without an outage. Cleared once the grace expires.
  rotatedAt?: number | null;
  previousHash?: string | null;
  previousHashExpiresAt?: number | null;
  // Optional per-key rate limit. When set, the auth layer enforces a token
  // bucket of `max` requests per `windowMs` milliseconds keyed on this key
  // id. Returns 429 with standard X-RateLimit-* headers. When undefined the
  // global limiter from server.ts applies unchanged.
  rateLimit?: { max: number; windowMs: number } | null;
  // Optional per-key IP allowlist. When set, the auth layer rejects any
  // request whose source IP does not match one of these IPv4/IPv6 rules.
  // Each entry is a single address or CIDR block (e.g. '203.0.113.7' or
  // '10.0.0.0/8'). When undefined or empty, the workspace-level allowlist
  // (if any) still applies but the key adds no further restriction. This
  // lets a customer bind a CI key to their build runners or a backend key
  // to a known egress range, even if the workspace itself permits any IP.
  allowedIps?: string[] | null;
  // Optional per-key Origin allowlist. When set, the auth layer rejects any
  // request whose browser-supplied Origin header is not present in the list
  // (case-insensitive scheme+host[:port], no trailing slash, no path). When
  // undefined or empty there is no restriction; this is the right default
  // because most server-to-server API keys do not send an Origin header at
  // all. Use this on keys that are deliberately embedded in a browser bundle
  // so a stolen credential cannot be replayed from a third-party page.
  allowedOrigins?: string[] | null;
  // Honeytoken (canary) flag. A canary key is intentionally never handed
  // to a real caller. When verifySecret hits a record with isCanary=true
  // the auth layer rejects the request as if the key were unknown AND
  // records a forensic incident. canaryNote is an operator memo about
  // where the secret was planted (e.g. "committed to legacy repo").
  isCanary?: boolean;
  canaryNote?: string | null;
  // Optional per-key time-of-day access window. When set, the auth layer
  // rejects any request whose wall-clock time (in the configured IANA
  // tz) does not fall inside at least one of the listed windows. This
  // lets a customer constrain a CI key to business hours so a stolen
  // credential cannot be used overnight or on weekends. When undefined
  // or empty there is no time restriction.
  //
  // Each window is { days: 0..6 (Sun..Sat), startMin: 0..1440,
  // endMin: 0..1440 }. endMin must be strictly greater than startMin
  // (overnight windows are expressed as two adjacent windows so the
  // model stays trivially auditable). Max 14 windows per key.
  allowedHours?: AllowedHoursPolicy | null;
  // Optional per-key HTTP method allowlist. When set, the auth layer
  // rejects any request whose HTTP method (uppercased) is not in the
  // list. Distinct from scopes: scopes gate resources, this gates verbs.
  // Lets a customer declare "this key is read-only at the wire level"
  // (e.g. ['GET','HEAD']) so a stolen credential cannot mutate even if
  // the resource scope would otherwise allow it. Undefined or empty
  // means unrestricted (default). Max 8 distinct methods per key.
  allowedMethods?: string[] | null;
  // Optional activation timestamp. When set to a future epoch-ms value
  // the auth layer rejects this key with reason 'not_yet_active' until
  // wall-clock time reaches notBefore. This is the symmetric pair of
  // expiresAt: change-management can mint a credential ahead of a
  // scheduled go-live (vendor cutover, planned maintenance) and the
  // key will refuse to transact until the chosen moment. Once active
  // the field is ignored by the hot path. Null or undefined means the
  // key is active immediately at issuance (the existing default).
  notBefore?: number | null;
  // Anchor used by the api-key-expiry policy to emit at most one
  // `api-key.expiry_warned` audit entry per key per warning crossing.
  // Set to expiresAt at the moment of warning so a subsequent extension
  // of the TTL (rotation) naturally clears the dedupe and a future
  // warning fires again.
  lastExpiryWarnedForExpiresAt?: number | null;
}

export const MAX_KEY_HOURS_WINDOWS = 14;
export const MAX_KEY_TZ_LENGTH = 64;

export interface AllowedHoursWindow {
  /** Weekdays this window applies to. 0 = Sunday, 6 = Saturday. */
  days: number[];
  /** Inclusive start, minutes since midnight in tz. */
  startMin: number;
  /** Exclusive end, minutes since midnight in tz. Must be > startMin. */
  endMin: number;
}

export interface AllowedHoursPolicy {
  /** IANA timezone name, e.g. 'America/Los_Angeles' or 'UTC'. */
  tz: string;
  windows: AllowedHoursWindow[];
}

export interface AllowedHoursValidation {
  ok: boolean;
  policy?: AllowedHoursPolicy;
  message?: string;
  index?: number;
}

function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > MAX_KEY_TZ_LENGTH) return false;
  try {
    // Throws RangeError on unknown zones.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and normalise an allowed-hours policy. Sorts and dedupes the
 * `days` array of each window and returns canonical form so saved
 * records compare cleanly.
 */
export function normaliseAllowedHours(raw: unknown): AllowedHoursValidation {
  if (raw == null) return { ok: true };
  if (typeof raw !== 'object') return { ok: false, message: 'policy must be an object' };
  const r = raw as { tz?: unknown; windows?: unknown };
  if (!isValidTimezone(String(r.tz ?? ''))) {
    return { ok: false, message: 'invalid timezone' };
  }
  if (!Array.isArray(r.windows)) {
    return { ok: false, message: 'windows must be an array' };
  }
  if (r.windows.length === 0) {
    return { ok: false, message: 'at least one window is required' };
  }
  if (r.windows.length > MAX_KEY_HOURS_WINDOWS) {
    return { ok: false, message: `too many windows (max ${MAX_KEY_HOURS_WINDOWS})` };
  }
  const out: AllowedHoursWindow[] = [];
  for (let i = 0; i < r.windows.length; i++) {
    const w = r.windows[i] as { days?: unknown; startMin?: unknown; endMin?: unknown };
    if (!w || typeof w !== 'object') {
      return { ok: false, index: i, message: 'window must be an object' };
    }
    if (!Array.isArray(w.days) || w.days.length === 0) {
      return { ok: false, index: i, message: 'days must be a non-empty array' };
    }
    const days: number[] = [];
    const seen = new Set<number>();
    for (const d of w.days) {
      if (!Number.isInteger(d) || (d as number) < 0 || (d as number) > 6) {
        return { ok: false, index: i, message: 'days entries must be integers 0..6' };
      }
      const n = d as number;
      if (seen.has(n)) continue;
      seen.add(n);
      days.push(n);
    }
    days.sort((a, b) => a - b);
    if (!Number.isInteger(w.startMin) || (w.startMin as number) < 0 || (w.startMin as number) > 1440) {
      return { ok: false, index: i, message: 'startMin must be 0..1440' };
    }
    if (!Number.isInteger(w.endMin) || (w.endMin as number) < 0 || (w.endMin as number) > 1440) {
      return { ok: false, index: i, message: 'endMin must be 0..1440' };
    }
    if ((w.endMin as number) <= (w.startMin as number)) {
      return { ok: false, index: i, message: 'endMin must be greater than startMin (split overnight windows)' };
    }
    out.push({ days, startMin: w.startMin as number, endMin: w.endMin as number });
  }
  return { ok: true, policy: { tz: String(r.tz), windows: out } };
}

// Cached formatter per tz so a hot auth path does not allocate.
const HOURS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function hoursFormatter(tz: string): Intl.DateTimeFormat {
  let f = HOURS_FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    HOURS_FORMATTERS.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Return true when the wall-clock time `at` in the policy's tz falls
 * inside any of the configured windows. An undefined or empty policy
 * means unrestricted.
 */
export function withinAllowedHours(
  policy: AllowedHoursPolicy | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!policy || !policy.windows || policy.windows.length === 0) return true;
  let parts;
  try {
    parts = hoursFormatter(policy.tz).formatToParts(at);
  } catch {
    // Unknown tz at evaluation time: fail closed so a corrupted record
    // does not silently widen access.
    return false;
  }
  let weekday = -1;
  let hour = -1;
  let minute = -1;
  for (const p of parts) {
    if (p.type === 'weekday') {
      const idx = WEEKDAY_INDEX[p.value];
      if (idx != null) weekday = idx;
    } else if (p.type === 'hour') {
      // Intl returns '24' for midnight in some locales; normalise to 0.
      const h = Number(p.value);
      hour = h === 24 ? 0 : h;
    } else if (p.type === 'minute') {
      minute = Number(p.value);
    }
  }
  if (weekday < 0 || hour < 0 || minute < 0) return false;
  const minOfDay = hour * 60 + minute;
  for (const w of policy.windows) {
    if (!w.days.includes(weekday)) continue;
    if (minOfDay >= w.startMin && minOfDay < w.endMin) return true;
  }
  return false;
}

/**
 * Update or clear the per-key allowed-hours policy. Returns the updated
 * record or null if the key is not owned by the user, revoked, or
 * expired. Pass null to remove a previously configured policy.
 */
export async function setKeyAllowedHours(
  dataDir: string,
  userId: string,
  id: string,
  policy: AllowedHoursPolicy | null,
  now: number = Date.now(),
): Promise<ApiKeyRecord | null> {
  if (policy != null) {
    const v = normaliseAllowedHours(policy);
    if (!v.ok) throw new Error(v.message ?? 'invalid allowed-hours policy');
    policy = v.policy!;
  }
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = { ...cur, allowedHours: policy };
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

export const MAX_KEY_IP_RULES = 64;
export const MAX_KEY_ORIGIN_RULES = 32;
export const MAX_ORIGIN_LENGTH = 253 + 16; // hostname + scheme + port headroom

export interface OriginAllowlistValidation {
  ok: boolean;
  /** Normalised list when ok is true. Each entry is lower-cased scheme+host[:port]. */
  rules?: string[];
  /** Human-readable reason when ok is false. */
  message?: string;
  /** Index of the offending entry when ok is false. */
  index?: number;
}

/**
 * Normalise a single origin string into the canonical form used for
 * comparison. Returns null when the input is not a parseable http/https
 * origin. The wildcard '*' is intentionally not supported: it would defeat
 * the purpose of restricting a browser-embedded key.
 */
export function normaliseOrigin(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_ORIGIN_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  // Reject anything that carries path/query/fragment so callers do not get
  // a false sense of locking down a particular page.
  if (url.pathname && url.pathname !== '/' && url.pathname !== '') return null;
  if (url.search || url.hash || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const defaultPort = url.protocol === 'http:' ? '80' : '443';
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
  return `${url.protocol}//${host}${port}`;
}

export function normaliseKeyOriginRules(
  input: readonly string[] | null | undefined,
): OriginAllowlistValidation {
  if (!input) return { ok: true, rules: [] };
  if (input.length > MAX_KEY_ORIGIN_RULES) {
    return { ok: false, message: `too many rules (max ${MAX_KEY_ORIGIN_RULES})` };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, index: i, message: 'origin must be a non-empty string' };
    }
    const norm = normaliseOrigin(raw);
    if (!norm) {
      return { ok: false, index: i, message: `invalid origin: ${raw} (expected http(s)://host[:port])` };
    }
    if (seen.has(norm)) {
      return { ok: false, index: i, message: `duplicate origin: ${norm}` };
    }
    seen.add(norm);
    out.push(norm);
  }
  return { ok: true, rules: out };
}

/**
 * Return true when the request's Origin header is permitted by the per-key
 * allowlist. Requests with no Origin header are accepted when an allowlist
 * is configured because a missing Origin means the request did not come
 * from a browser at all (the only place an Origin header is mandatory).
 * Server-to-server callers therefore keep working unchanged, while a stolen
 * key replayed from a malicious page is rejected because the browser will
 * stamp an unfamiliar Origin on the request.
 */
export function originAllowedByKey(
  origin: string | undefined | null,
  rules: readonly string[] | null | undefined,
): boolean {
  if (!rules || rules.length === 0) return true; // unrestricted
  if (!origin) return true; // no Origin header => not a browser fetch
  const norm = normaliseOrigin(origin);
  if (!norm) return false; // malformed Origin against a configured list
  return rules.some((r) => r === norm);
}

/**
 * Update or clear the per-key Origin allowlist. Returns the updated record
 * or null if the key is not owned by the user, revoked, or expired. Pass
 * null or an empty array to remove an existing restriction.
 */
export async function setKeyAllowedOrigins(
  dataDir: string,
  userId: string,
  id: string,
  allowedOrigins: readonly string[] | null,
  now: number = Date.now(),
): Promise<ApiKeyRecord | null> {
  const v = normaliseKeyOriginRules(allowedOrigins);
  if (!v.ok) throw new Error(v.message ?? 'invalid origin rules');
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = {
    ...cur,
    allowedOrigins: v.rules && v.rules.length > 0 ? v.rules : null,
  };
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

export interface IpAllowlistValidation {
  ok: boolean;
  /** Normalised list when ok is true. */
  rules?: string[];
  /** Human-readable reason when ok is false. */
  message?: string;
  /** Index of the offending entry when ok is false. */
  index?: number;
}

export function normaliseKeyIpRules(input: readonly string[] | null | undefined): IpAllowlistValidation {
  if (!input) return { ok: true, rules: [] };
  if (input.length > MAX_KEY_IP_RULES) {
    return { ok: false, message: `too many rules (max ${MAX_KEY_IP_RULES})` };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, index: i, message: 'rule must be a non-empty string' };
    }
    const norm = normaliseRule(raw);
    if (!norm) return { ok: false, index: i, message: `invalid IP or CIDR: ${raw}` };
    if (seen.has(norm)) return { ok: false, index: i, message: `duplicate rule: ${norm}` };
    seen.add(norm);
    out.push(norm);
  }
  return { ok: true, rules: out };
}

/** Return true when the source IP is permitted by the per-key allowlist. */
export function ipAllowedByKey(ip: string | undefined | null, rules: readonly string[] | null | undefined): boolean {
  if (!rules || rules.length === 0) return true; // unrestricted
  if (!ip) return false; // restrictive list but no source IP
  return ipAllowedByRules(ip, rules.map((cidr) => ({ cidr })));
}

export const MAX_KEY_METHOD_RULES = 8;
export const VALID_HTTP_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof VALID_HTTP_METHODS)[number];

export interface MethodAllowlistValidation {
  ok: boolean;
  /** Normalised, uppercased, deduped, sorted list when ok is true. */
  methods?: string[];
  message?: string;
  index?: number;
}

/**
 * Normalise a per-key HTTP method allowlist. Methods are upper-cased,
 * deduped, sorted, and validated against a fixed list of safe verbs.
 * An empty input is treated as "unrestricted" and returns ok with an
 * empty array; callers that want to clear an existing restriction can
 * pass null or [] interchangeably.
 */
export function normaliseKeyMethodRules(
  input: readonly string[] | null | undefined,
): MethodAllowlistValidation {
  if (!input) return { ok: true, methods: [] };
  if (input.length > MAX_KEY_METHOD_RULES) {
    return { ok: false, message: `too many methods (max ${MAX_KEY_METHOD_RULES})` };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== 'string' || !raw.trim()) {
      return { ok: false, index: i, message: 'method must be a non-empty string' };
    }
    const norm = raw.trim().toUpperCase();
    if (!(VALID_HTTP_METHODS as readonly string[]).includes(norm)) {
      return {
        ok: false,
        index: i,
        message: `invalid method: ${raw} (allowed: ${VALID_HTTP_METHODS.join(', ')})`,
      };
    }
    if (seen.has(norm)) {
      return { ok: false, index: i, message: `duplicate method: ${norm}` };
    }
    seen.add(norm);
    out.push(norm);
  }
  out.sort();
  return { ok: true, methods: out };
}

/**
 * Return true when the request's HTTP method is permitted by the per-key
 * allowlist. Unrestricted (null/empty) accepts everything. Case-insensitive.
 * A configured allowlist with a missing method fails closed.
 */
export function methodAllowedByKey(
  method: string | undefined | null,
  rules: readonly string[] | null | undefined,
): boolean {
  if (!rules || rules.length === 0) return true; // unrestricted
  if (!method) return false; // restrictive list but no method
  return rules.includes(method.toUpperCase());
}

/**
 * Update or clear the per-key HTTP method allowlist. Returns the updated
 * record or null if the key is not owned by the user, revoked, or
 * expired. Pass null or an empty array to remove the restriction.
 */
export async function setKeyAllowedMethods(
  dataDir: string,
  userId: string,
  id: string,
  allowedMethods: readonly string[] | null,
  now: number = Date.now(),
): Promise<ApiKeyRecord | null> {
  const v = normaliseKeyMethodRules(allowedMethods);
  if (!v.ok) throw new Error(v.message ?? 'invalid method rules');
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = {
    ...cur,
    allowedMethods: v.methods && v.methods.length > 0 ? v.methods : null,
  };
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

/**
 * Update or clear the per-key IP allowlist. Returns the updated record or
 * null if the key is not owned by the user, revoked, or expired. Pass null
 * or an empty array to remove an existing restriction.
 */
export async function setKeyAllowedIps(
  dataDir: string,
  userId: string,
  id: string,
  allowedIps: readonly string[] | null,
  now: number = Date.now(),
): Promise<ApiKeyRecord | null> {
  const v = normaliseKeyIpRules(allowedIps);
  if (!v.ok) throw new Error(v.message ?? 'invalid ip rules');
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = { ...cur, allowedIps: v.rules && v.rules.length > 0 ? v.rules : null };
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

export const MIN_RATE_WINDOW_MS = 1_000;
export const MAX_RATE_WINDOW_MS = 24 * 60 * 60_000;
export const MIN_RATE_MAX = 1;
export const MAX_RATE_MAX = 1_000_000;

export function isValidRateLimit(r: { max: number; windowMs: number }): boolean {
  return (
    Number.isInteger(r.max) && r.max >= MIN_RATE_MAX && r.max <= MAX_RATE_MAX &&
    Number.isInteger(r.windowMs) && r.windowMs >= MIN_RATE_WINDOW_MS && r.windowMs <= MAX_RATE_WINDOW_MS
  );
}

/**
 * Update or clear the per-key rate limit. Returns the updated record or
 * null if the key is not owned by the user, revoked, or expired. Pass
 * `limit: null` to remove a previously configured limit.
 */
export async function setKeyRateLimit(
  dataDir: string,
  userId: string,
  id: string,
  limit: { max: number; windowMs: number } | null,
  now: number = Date.now(),
): Promise<ApiKeyRecord | null> {
  if (limit && !isValidRateLimit(limit)) throw new Error('invalid rate limit');
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = { ...cur, rateLimit: limit };
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

// Default grace period after rotation during which the old secret still
// verifies. Long enough for a CI run or deploy to catch up, short enough
// that a leaked old secret stops working quickly.
export const DEFAULT_ROTATION_GRACE_MS = 10 * 60_000;

function file(dataDir: string) { return join(dataDir, 'api-keys.json'); }

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

export async function loadKeys(dataDir: string): Promise<ApiKeyRecord[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    return JSON.parse(raw) as ApiKeyRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveKeys(dataDir: string, keys: ApiKeyRecord[]): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(keys, null, 2));
}

export interface IssueInput {
  userId: string;
  label: string;
  role?: KeyRole;
  scopes?: string[];
  ttlMs?: number | null;
  // Optional activation moment. Absolute epoch ms. When set and > now,
  // the key is persisted but refuses to authenticate until the time
  // arrives. Validated to be at most one year in the future and, when
  // combined with ttlMs, strictly less than the resulting expiresAt.
  notBefore?: number | null;
  now?: number;
}

/** Maximum window we will accept for a future activation. One year, same
 *  bound the issue route already applies to ttlMs so the two surfaces
 *  cannot drift. */
export const MAX_NOT_BEFORE_AHEAD_MS = 365 * 24 * 60 * 60_000;

export interface NotBeforeValidation {
  ok: boolean;
  value?: number | null;
  message?: string;
}

/** Reject negative, NaN, or absurdly distant activation timestamps. A
 *  null or undefined input clears the field. A value <= now is accepted
 *  but coerced to null (already-active keys have no scheduled activation
 *  to display). */
export function normaliseNotBefore(
  raw: number | null | undefined,
  now: number = Date.now(),
): NotBeforeValidation {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, message: 'notBefore must be a finite epoch-ms number' };
  }
  const v = Math.trunc(raw);
  if (v <= now) return { ok: true, value: null };
  if (v - now > MAX_NOT_BEFORE_AHEAD_MS) {
    return { ok: false, message: 'notBefore cannot be more than 365 days in the future' };
  }
  return { ok: true, value: v };
}

export interface IssuedKey {
  record: ApiKeyRecord;
  secret: string;          // plaintext, prefix included; only returned here
}

export async function issueKey(dataDir: string, input: IssueInput): Promise<IssuedKey> {
  const now = input.now ?? Date.now();
  const secret = KEY_PREFIX + randomBytes(32).toString('hex');
  let scopes: string[] | undefined;
  if (input.scopes && input.scopes.length > 0) {
    for (const s of input.scopes) {
      if (!isValidScope(s)) throw new Error(`invalid scope: ${s}`);
    }
    // Dedupe and sort so saved records compare cleanly.
    scopes = [...new Set(input.scopes)].sort();
  }
  const nb = normaliseNotBefore(input.notBefore ?? null, now);
  if (!nb.ok) throw new Error(nb.message ?? 'invalid notBefore');
  const notBefore = nb.value ?? null;
  const expiresAt = input.ttlMs ? now + input.ttlMs : null;
  // Refuse a window where the key would expire before it activates. The
  // store would silently accept it but the credential could never be
  // used, which is a footgun the issuance API should fail fast on.
  if (notBefore !== null && expiresAt !== null && notBefore >= expiresAt) {
    throw new Error('notBefore must be strictly before expiresAt');
  }
  const record: ApiKeyRecord = {
    id: nanoid(10),
    userId: input.userId,
    label: input.label,
    role: input.role ?? 'owner',
    hash: hashSecret(secret),
    scopes,
    createdAt: now,
    expiresAt,
    lastUsedAt: null,
    revokedAt: null,
    notBefore,
  };
  const all = await loadKeys(dataDir);
  all.push(record);
  await saveKeys(dataDir, all);
  return { record, secret };
}

export async function listKeys(dataDir: string, userId: string): Promise<ApiKeyRecord[]> {
  const all = await loadKeys(dataDir);
  // Hide canary keys from the normal list so an operator cannot
  // accidentally treat a trap as a real credential. They are surfaced
  // separately by listCanaryKeys.
  return all.filter((k) => k.userId === userId && k.isCanary !== true);
}

// Internal: revoke every active key matching the predicate. Used by the
// offboarding sweep so the members route can terminate a removed user's
// credentials without exporting the raw saveKeys writer.
export async function revokeKeysWhere(
  dataDir: string,
  pred: (k: ApiKeyRecord) => boolean,
): Promise<{ ids: string[] }> {
  const all = await loadKeys(dataDir);
  const now = Date.now();
  const ids: string[] = [];
  let changed = false;
  const next = all.map((k) => {
    if (k.revokedAt || !pred(k)) return k;
    ids.push(k.id);
    changed = true;
    return { ...k, revokedAt: now };
  });
  if (changed) await saveKeys(dataDir, next);
  return { ids };
}

export async function revokeKey(dataDir: string, userId: string, id: string): Promise<boolean> {
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return false;
  const k = all[idx]!;
  if (k.revokedAt) return true;
  all[idx] = { ...k, revokedAt: Date.now() };
  await saveKeys(dataDir, all);
  return true;
}

export interface VerifyResult {
  ok: true;
  record: ApiKeyRecord;
}
export interface VerifyFail {
  ok: false;
  reason: 'malformed' | 'unknown' | 'revoked' | 'expired';
}
export type VerifyOutcome = VerifyResult | VerifyFail;

export async function verifySecret(
  dataDir: string,
  presented: string | undefined | null,
  now: number = Date.now(),
): Promise<VerifyOutcome> {
  if (!presented || !presented.startsWith(KEY_PREFIX) || presented.length < KEY_PREFIX.length + 32) {
    return { ok: false, reason: 'malformed' };
  }
  const digest = hashSecret(presented);
  const all = await loadKeys(dataDir);
  // Match current hash first, then the previous hash if it is still within
  // its post-rotation grace window. Anything past the grace window is treated
  // as unknown so callers see a clean 401 instead of a stale-key surprise.
  let match = all.find((k) => constantTimeEqualHex(k.hash, digest));
  if (!match) {
    match = all.find(
      (k) =>
        k.previousHash != null &&
        k.previousHashExpiresAt != null &&
        k.previousHashExpiresAt > now &&
        constantTimeEqualHex(k.previousHash, digest),
    );
  }
  if (!match) return { ok: false, reason: 'unknown' };
  if (match.revokedAt) return { ok: false, reason: 'revoked' };
  if (match.expiresAt && now > match.expiresAt) return { ok: false, reason: 'expired' };
  // Fire-and-forget lastUsedAt bump.
  match.lastUsedAt = now;
  void saveKeys(dataDir, all).catch(() => undefined);
  return { ok: true, record: match };
}

export interface RotateInput {
  graceMs?: number;
  now?: number;
}

export interface RotatedKey {
  record: ApiKeyRecord;
  secret: string;          // plaintext, prefix included; only returned here
  previousExpiresAt: number | null;
}

/**
 * Rotate an existing key in place. Generates a new secret, demotes the
 * current hash to `previousHash` for a short grace window so callers can
 * swap the credential without downtime, and returns the new plaintext. The
 * key id, label, role, scopes, and expiry are preserved so consumers can
 * keep their bookkeeping pointing at the same record.
 *
 * Returns null when the key is not owned by the user, was revoked, or has
 * expired. Routes translate that into a 404 or 409 as appropriate.
 */
export async function rotateKey(
  dataDir: string,
  userId: string,
  id: string,
  input: RotateInput = {},
): Promise<RotatedKey | null> {
  const now = input.now ?? Date.now();
  const graceMs = input.graceMs ?? DEFAULT_ROTATION_GRACE_MS;
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const current = all[idx]!;
  if (current.revokedAt) return null;
  if (current.expiresAt && now > current.expiresAt) return null;
  const secret = KEY_PREFIX + randomBytes(32).toString('hex');
  const previousExpiresAt = graceMs > 0 ? now + graceMs : null;
  const rotated: ApiKeyRecord = {
    ...current,
    hash: hashSecret(secret),
    rotatedAt: now,
    previousHash: graceMs > 0 ? current.hash : null,
    previousHashExpiresAt: previousExpiresAt,
  };
  all[idx] = rotated;
  await saveKeys(dataDir, all);
  return { record: rotated, secret, previousExpiresAt };
}

/** Strip the secret out of a record for safe API responses. */
export function redact(rec: ApiKeyRecord) {
  return {
    id: rec.id,
    userId: rec.userId,
    label: rec.label,
    role: rec.role,
    scopes: rec.scopes ?? null,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    lastUsedAt: rec.lastUsedAt,
    revokedAt: rec.revokedAt,
    rotatedAt: rec.rotatedAt ?? null,
    // Surface only whether a grace window is active and when it ends. Never
    // surface the previous hash itself.
    previousHashExpiresAt:
      rec.previousHash && rec.previousHashExpiresAt && rec.previousHashExpiresAt > Date.now()
        ? rec.previousHashExpiresAt
        : null,
    rateLimit: rec.rateLimit ?? null,
    allowedIps: rec.allowedIps ?? null,
    allowedOrigins: rec.allowedOrigins ?? null,
    allowedHours: rec.allowedHours ?? null,
    allowedMethods: rec.allowedMethods ?? null,
    isCanary: rec.isCanary === true,
    canaryNote: rec.canaryNote ?? null,
    // Surface the activation timestamp and a derived 'active' flag so the
    // dashboard can render a clear pending/active badge without recomputing
    // the rule on the client.
    notBefore: rec.notBefore ?? null,
    active: rec.notBefore == null || rec.notBefore <= Date.now(),
  };
}

/** Update or clear the activation timestamp on an existing key. Returns
 *  null when the key is not owned by the user, was revoked, or has
 *  expired. Returns the updated record otherwise. The audit entry is the
 *  caller's responsibility (the route writes it so the actor and request
 *  context are captured). */
export async function setKeyNotBefore(
  dataDir: string,
  userId: string,
  id: string,
  notBefore: number | null,
  nowArg?: number,
): Promise<ApiKeyRecord | null> {
  const now = nowArg ?? Date.now();
  const v = normaliseNotBefore(notBefore, now);
  if (!v.ok) throw new Error(v.message ?? 'invalid notBefore');
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id && k.userId === userId);
  if (idx < 0) return null;
  const cur = all[idx]!;
  if (cur.revokedAt) return null;
  if (cur.expiresAt && now > cur.expiresAt) return null;
  const next: ApiKeyRecord = { ...cur, notBefore: v.value ?? null };
  const nb = next.notBefore ?? null;
  if (nb !== null && next.expiresAt !== null && nb >= next.expiresAt) {
    throw new Error('notBefore must be strictly before expiresAt');
  }
  all[idx] = next;
  await saveKeys(dataDir, all);
  return next;
}

export interface IssueCanaryInput {
  userId: string;
  label: string;
  note?: string | null;
  now?: number;
}

/**
 * Mint a honeytoken (canary) key. Identical wire format to a real key so
 * an attacker who finds it cannot distinguish it by shape, but flagged
 * isCanary=true in storage so the auth layer never grants access and
 * records an incident on first use.
 */
export async function issueCanaryKey(
  dataDir: string,
  input: IssueCanaryInput,
): Promise<IssuedKey> {
  const now = input.now ?? Date.now();
  const secret = KEY_PREFIX + randomBytes(32).toString('hex');
  const record: ApiKeyRecord = {
    id: nanoid(10),
    userId: input.userId,
    label: input.label,
    role: 'reader',
    hash: hashSecret(secret),
    scopes: [],
    createdAt: now,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    isCanary: true,
    canaryNote: input.note ?? null,
  };
  const all = await loadKeys(dataDir);
  all.push(record);
  await saveKeys(dataDir, all);
  return { record, secret };
}

/** List all canary keys for a user, regardless of revocation state. */
export async function listCanaryKeys(
  dataDir: string,
  userId: string,
): Promise<ApiKeyRecord[]> {
  const all = await loadKeys(dataDir);
  return all.filter((k) => k.userId === userId && k.isCanary === true);
}

/** Look up a key record without filtering by owner. Internal use only. */
export async function findKeyById(
  dataDir: string,
  id: string,
): Promise<ApiKeyRecord | null> {
  const all = await loadKeys(dataDir);
  return all.find((k) => k.id === id) ?? null;
}

/**
 * Stamp the expiry-warning anchor on a key. Used by the auth layer to
 * dedupe `api-key.expiry_warned` audit entries: the first request that
 * crosses into the warning window writes one entry, subsequent requests
 * find a matching anchor and stay silent until the TTL changes.
 *
 * Returns true when the file was written (anchor changed), false when
 * the anchor already matched. Callers should only audit when this
 * returns true.
 */
export async function touchExpiryWarning(
  dataDir: string,
  id: string,
  expiresAt: number,
): Promise<boolean> {
  const all = await loadKeys(dataDir);
  const idx = all.findIndex((k) => k.id === id);
  if (idx === -1) return false;
  const cur = all[idx]!;
  if (cur.lastExpiryWarnedForExpiresAt === expiresAt) return false;
  all[idx] = { ...cur, lastExpiryWarnedForExpiresAt: expiresAt };
  await saveKeys(dataDir, all);
  return true;
}

