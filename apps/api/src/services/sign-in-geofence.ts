import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Sign-in geofencing policy. Workspace owners declare which ISO 3166-1
// alpha-2 country codes may complete a sign-in (GitHub OAuth or OIDC).
// The country is taken from a trusted upstream header (e.g. Cloudflare's
// `cf-ipcountry`, AWS CloudFront's `cloudfront-viewer-country`, or any
// reverse proxy that resolves geo). If the policy is enabled but no
// header is provided, we fail closed when `requireCountry=true` so a
// misconfigured proxy cannot silently bypass the control.
//
// Mode semantics:
//   - 'allow': the request country MUST be in `countries`. Anything else
//     is blocked.
//   - 'block': the request country MUST NOT be in `countries`. Anything
//     else is permitted.
//
// We keep this deliberately small: a single JSON document, atomic
// rewrite, evaluated only at sign-in (not on every request) so a
// session that was minted from an allowed country is not retroactively
// killed when a member travels. Pair with session-policy for TTL.
//
// The settings route never gates itself on this policy, mirroring the
// IP allowlist pattern, so an owner whose corporate egress moves to a
// new country is not locked out of the very switch that would let them
// back in.

export const ISO_COUNTRY_RE = /^[A-Z]{2}$/;
export const MAX_COUNTRIES = 250;
export const ALLOWED_HEADERS = [
  'cf-ipcountry',
  'cloudfront-viewer-country',
  'x-vercel-ip-country',
  'x-country',
  'x-geo-country',
] as const;

export type GeofenceMode = 'allow' | 'block';

export interface GeofenceRecord {
  enabled: boolean;
  mode: GeofenceMode;
  countries: string[];
  /**
   * When true, a sign-in with no resolvable country header is treated as
   * a violation (fail-closed). When false, unknown country falls through
   * and the sign-in is permitted. Defaults to true on enable.
   */
  requireCountry: boolean;
  /** Optional override of the headers we trust; empty means use defaults. */
  trustedHeaders: string[];
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
}

const FILE = 'sign-in-geofence.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export function emptyRecord(): GeofenceRecord {
  const now = Date.now();
  return {
    enabled: false,
    mode: 'allow',
    countries: [],
    requireCountry: true,
    trustedHeaders: [],
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  };
}

export async function getRecord(dataDir: string): Promise<GeofenceRecord> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyRecord();
    const rec = parsed as Partial<GeofenceRecord>;
    return {
      enabled: Boolean(rec.enabled),
      mode: rec.mode === 'block' ? 'block' : 'allow',
      countries: Array.isArray(rec.countries)
        ? rec.countries.filter((c): c is string => typeof c === 'string' && ISO_COUNTRY_RE.test(c))
        : [],
      requireCountry: rec.requireCountry !== false,
      trustedHeaders: Array.isArray(rec.trustedHeaders)
        ? rec.trustedHeaders.filter((h): h is string => typeof h === 'string').map((h) => h.toLowerCase())
        : [],
      createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
      updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
      updatedBy: typeof rec.updatedBy === 'string' ? rec.updatedBy : null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyRecord();
    throw err;
  }
}

export interface ReplaceInput {
  enabled: boolean;
  mode?: GeofenceMode;
  countries?: string[];
  requireCountry?: boolean;
  trustedHeaders?: string[];
}

export interface ValidationError { ok: false; field: string; message: string }
export interface ValidationOk { ok: true; value: Required<Omit<ReplaceInput, 'enabled'>> & { enabled: boolean } }

export function validate(input: ReplaceInput): ValidationOk | ValidationError {
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, field: 'enabled', message: 'enabled must be boolean' };
  }
  const mode: GeofenceMode = input.mode === 'block' ? 'block' : 'allow';
  const raw = Array.isArray(input.countries) ? input.countries : [];
  if (raw.length > MAX_COUNTRIES) {
    return { ok: false, field: 'countries', message: `at most ${MAX_COUNTRIES} entries` };
  }
  const seen = new Set<string>();
  const countries: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (typeof c !== 'string') {
      return { ok: false, field: `countries[${i}]`, message: 'must be a string' };
    }
    const up = c.trim().toUpperCase();
    if (!ISO_COUNTRY_RE.test(up)) {
      return { ok: false, field: `countries[${i}]`, message: 'must be an ISO 3166-1 alpha-2 code' };
    }
    if (seen.has(up)) {
      return { ok: false, field: `countries[${i}]`, message: `duplicate: ${up}` };
    }
    seen.add(up);
    countries.push(up);
  }
  if (input.enabled && mode === 'allow' && countries.length === 0) {
    return { ok: false, field: 'countries', message: 'allow-mode cannot be enabled with an empty list' };
  }
  const trustedHeaders: string[] = [];
  const headers = Array.isArray(input.trustedHeaders) ? input.trustedHeaders : [];
  const seenH = new Set<string>();
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (typeof h !== 'string') {
      return { ok: false, field: `trustedHeaders[${i}]`, message: 'must be a string' };
    }
    const low = h.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(low)) {
      return { ok: false, field: `trustedHeaders[${i}]`, message: 'invalid header name' };
    }
    if (seenH.has(low)) continue;
    seenH.add(low);
    trustedHeaders.push(low);
  }
  return {
    ok: true,
    value: {
      enabled: input.enabled,
      mode,
      countries,
      requireCountry: input.requireCountry !== false,
      trustedHeaders,
    },
  };
}

export async function replaceRecord(
  dataDir: string,
  actorId: string,
  input: ReplaceInput,
): Promise<GeofenceRecord> {
  const v = validate(input);
  if (!v.ok) {
    const err = new Error(v.message) as Error & { field?: string };
    err.field = v.field;
    throw err;
  }
  const prev = await getRecord(dataDir);
  const next: GeofenceRecord = {
    enabled: v.value.enabled,
    mode: v.value.mode,
    countries: v.value.countries,
    requireCountry: v.value.requireCountry,
    trustedHeaders: v.value.trustedHeaders,
    createdAt: prev.createdAt,
    updatedAt: Date.now(),
    updatedBy: actorId,
  };
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 2));
  await (await import('node:fs/promises')).rename(tmp, path);
  return next;
}

export interface GeoCheckResult {
  allowed: boolean;
  /** Resolved country code or null when no trusted header was present. */
  country: string | null;
  /** Header name that yielded the country, when applicable. */
  source: string | null;
  /** Reason for a block, present only when allowed=false. */
  reason: 'disabled-pass' | 'allow-mode' | 'block-mode' | 'unknown-country' | null;
}

export function resolveCountry(
  headers: Record<string, string | string[] | undefined>,
  trusted: string[],
): { country: string | null; source: string | null } {
  const list = trusted.length ? trusted : (ALLOWED_HEADERS as readonly string[]);
  for (const name of list) {
    const raw = headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') continue;
    const up = value.trim().toUpperCase();
    if (ISO_COUNTRY_RE.test(up)) return { country: up, source: name };
  }
  return { country: null, source: null };
}

/**
 * Pure policy decision used by both the auth callbacks and the test
 * suite. Returns `allowed=true` with `reason=null` when the workspace
 * has no geofence active so the caller can pass through.
 */
export function evaluate(
  record: GeofenceRecord,
  headers: Record<string, string | string[] | undefined>,
): GeoCheckResult {
  if (!record.enabled) {
    return { allowed: true, country: null, source: null, reason: 'disabled-pass' };
  }
  const { country, source } = resolveCountry(headers, record.trustedHeaders);
  if (country === null) {
    if (record.requireCountry) {
      return { allowed: false, country: null, source: null, reason: 'unknown-country' };
    }
    return { allowed: true, country: null, source: null, reason: null };
  }
  if (record.mode === 'allow') {
    return {
      allowed: record.countries.includes(country),
      country,
      source,
      reason: record.countries.includes(country) ? null : 'allow-mode',
    };
  }
  // block mode
  return {
    allowed: !record.countries.includes(country),
    country,
    source,
    reason: record.countries.includes(country) ? 'block-mode' : null,
  };
}

export interface GeofenceDiff {
  toggled: boolean;
  modeChanged: boolean;
  added: string[];
  removed: string[];
  requireCountryChanged: boolean;
}

export function diff(prev: GeofenceRecord, next: GeofenceRecord): GeofenceDiff {
  const prevSet = new Set(prev.countries);
  const nextSet = new Set(next.countries);
  return {
    toggled: prev.enabled !== next.enabled,
    modeChanged: prev.mode !== next.mode,
    added: [...nextSet].filter((c) => !prevSet.has(c)).sort(),
    removed: [...prevSet].filter((c) => !nextSet.has(c)).sort(),
    requireCountryChanged: prev.requireCountry !== next.requireCountry,
  };
}
