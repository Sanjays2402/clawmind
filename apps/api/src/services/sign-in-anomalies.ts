// Sign-in anomaly detection (impossible travel).
//
// Procurement reviewers reading SOC2 / ISO 27001 controls expect "the
// product detects suspicious sign-ins from geographically implausible
// locations". This module is that detector.
//
// How it works:
//   1. Every successful sign-in already carries a country code (resolved
//      from the same trusted upstream headers that the geofence uses,
//      e.g. cf-ipcountry). On each success we compare against the most
//      recent successful sign-in for that same actor.
//   2. If both sign-ins resolved to a country, we look up the country
//      centroid (small embedded table; no external GeoIP database
//      required) and compute the great-circle distance with the
//      haversine formula. Implied speed = distance / elapsed minutes.
//   3. If implied speed exceeds IMPOSSIBLE_SPEED_KMH (default 900 km/h,
//      faster than any commercial airliner including transfers) we
//      record an anomaly.
//
// The anomaly is FLAGGED, not blocking. Blocking on a single best-effort
// signal would lock users out during legitimate VPN switches; the right
// posture is: surface to the user + admin, audit, and let the workspace
// security team triage. A separate workspace policy can choose to react
// (force MFA re-challenge, revoke sessions) using these records.
//
// On-disk layout: <dataDir>/sign-in-anomalies.json, atomic rewrite,
// capped ring. Matches the sign-in-log shape so an ops engineer doesn't
// have to learn a new format.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

// Trusted upstream headers that may carry a 2-letter ISO 3166 country
// code. Kept in sync with sign-in-geofence.ts by intent; duplicated here
// so this module has no cross-dependency on the geofence config.
export const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'cloudfront-viewer-country',
  'x-vercel-ip-country',
  'x-country',
  'x-geo-country',
] as const;

const ISO_COUNTRY_RE = /^[A-Z]{2}$/;

export const MAX_RECORDS = 2000;
export const IMPOSSIBLE_SPEED_KMH = 900;
// Below this elapsed time we never flag: two sign-ins in the same
// minute from different countries is almost always a misconfigured
// reverse proxy spraying different country headers, not a real human
// impossibility.
export const MIN_GAP_MS = 60_000;

// Approximate population-weighted centroids for every ISO 3166-1 alpha-2
// country we care to resolve. Coordinates are in decimal degrees,
// latitude then longitude. The list is intentionally finite: an unknown
// code falls through and no anomaly is recorded, which is the safe
// default. Source: public-domain capital coordinates rounded to one
// decimal.
const COUNTRY_CENTROIDS: Record<string, readonly [number, number]> = {
  AE: [24.5, 54.4], AR: [-34.6, -58.4], AT: [48.2, 16.4], AU: [-35.3, 149.1],
  BE: [50.8, 4.4], BG: [42.7, 23.3], BR: [-15.8, -47.9], CA: [45.4, -75.7],
  CH: [46.9, 7.5], CL: [-33.5, -70.7], CN: [39.9, 116.4], CO: [4.7, -74.1],
  CZ: [50.1, 14.4], DE: [52.5, 13.4], DK: [55.7, 12.6], EE: [59.4, 24.8],
  EG: [30.0, 31.2], ES: [40.4, -3.7], FI: [60.2, 24.9], FR: [48.9, 2.3],
  GB: [51.5, -0.1], GR: [38.0, 23.7], HK: [22.3, 114.2], HU: [47.5, 19.0],
  ID: [-6.2, 106.8], IE: [53.3, -6.3], IL: [31.8, 35.2], IN: [28.6, 77.2],
  IS: [64.1, -21.9], IT: [41.9, 12.5], JP: [35.7, 139.7], KE: [-1.3, 36.8],
  KR: [37.6, 127.0], LT: [54.7, 25.3], LU: [49.6, 6.1], LV: [56.9, 24.1],
  MA: [34.0, -6.8], MX: [19.4, -99.1], MY: [3.1, 101.7], NG: [9.1, 7.5],
  NL: [52.4, 4.9], NO: [59.9, 10.7], NZ: [-41.3, 174.8], PE: [-12.0, -77.0],
  PH: [14.6, 120.9], PK: [33.7, 73.1], PL: [52.2, 21.0], PT: [38.7, -9.1],
  RO: [44.4, 26.1], RS: [44.8, 20.5], RU: [55.8, 37.6], SA: [24.7, 46.7],
  SE: [59.3, 18.1], SG: [1.3, 103.8], SK: [48.2, 17.1], TH: [13.8, 100.5],
  TR: [39.9, 32.9], TW: [25.0, 121.5], UA: [50.4, 30.5], US: [38.9, -77.0],
  VN: [21.0, 105.8], ZA: [-25.7, 28.2],
};

export interface SignInAnomalyRecord {
  id: string;
  actor: string;
  /** The just-completed sign-in that tripped the detector. */
  current: { ip: string; country: string; at: number; method: string };
  /** The previous successful sign-in we compared against. */
  previous: { ip: string; country: string; at: number; method: string };
  /** Great-circle distance in kilometers (rounded). */
  distanceKm: number;
  /** Elapsed minutes between the two sign-ins. */
  elapsedMinutes: number;
  /** Implied travel speed in km/h (rounded). */
  speedKmh: number;
  /** Threshold the speed exceeded at detection time. */
  thresholdKmh: number;
  /** Set when an admin or the actor acknowledges the alert. */
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  createdAt: number;
}

interface AnomalyFile {
  version: 1;
  records: SignInAnomalyRecord[];
  // Per-actor "last successful sign-in" we use as the comparison anchor.
  // Keeping this here, atomic with the records list, avoids a second
  // file and means a single fs.readFile is enough to make a decision.
  lastSeen: Record<string, { ip: string; country: string; at: number; method: string }>;
}

function filePath(dataDir: string): string {
  return join(dataDir, 'sign-in-anomalies.json');
}

async function readFile_(dataDir: string): Promise<AnomalyFile> {
  try {
    const raw = await readFile(filePath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as AnomalyFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return { version: 1, records: [], lastSeen: {} };
    }
    if (!parsed.lastSeen || typeof parsed.lastSeen !== 'object') parsed.lastSeen = {};
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, records: [], lastSeen: {} };
    }
    throw err;
  }
}

async function writeFile_(dataDir: string, file: AnomalyFile): Promise<void> {
  const p = filePath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

/** Resolve a country code from upstream proxy headers, or null. */
export function resolveCountry(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers[name];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (!v) continue;
    const up = String(v).trim().toUpperCase();
    if (ISO_COUNTRY_RE.test(up)) return up;
  }
  return null;
}

/** Great-circle distance in kilometers. Exported for tests. */
export function haversineKm(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const R = 6371; // mean Earth radius in km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface DetectInput {
  actor: string;
  ip: string;
  country: string | null;
  at: number;
  method: string;
}

export type DetectOutcome =
  | { kind: 'recorded'; record: SignInAnomalyRecord }
  | { kind: 'ok'; reason: 'first-seen' | 'same-country' | 'unknown-centroid' | 'unknown-country' | 'within-gap' | 'under-threshold' };

/**
 * Run the impossible-travel check for a freshly completed successful
 * sign-in. Always updates the per-actor "lastSeen" anchor so the next
 * call has something to compare against, even when the current call
 * could not produce a decision (unknown country, missing centroid).
 *
 * Returns a structured outcome instead of throwing so the caller can
 * decide whether to surface an extra audit row.
 */
export async function detectAndRecord(
  dataDir: string,
  input: DetectInput,
): Promise<DetectOutcome> {
  const file = await readFile_(dataDir);
  const prev = file.lastSeen[input.actor];

  // Always advance the anchor to the freshest successful sign-in. We
  // store country='' when unknown so we can still detect future
  // anomalies once geo headers come online without re-flagging the
  // gap retroactively.
  const nextAnchor = {
    ip: input.ip,
    country: input.country ?? '',
    at: input.at,
    method: input.method,
  };

  let outcome: DetectOutcome;

  if (!prev) {
    outcome = { kind: 'ok', reason: 'first-seen' };
  } else if (!input.country) {
    outcome = { kind: 'ok', reason: 'unknown-country' };
  } else if (!prev.country) {
    outcome = { kind: 'ok', reason: 'unknown-country' };
  } else if (prev.country === input.country) {
    outcome = { kind: 'ok', reason: 'same-country' };
  } else {
    const elapsedMs = input.at - prev.at;
    if (elapsedMs < MIN_GAP_MS) {
      outcome = { kind: 'ok', reason: 'within-gap' };
    } else {
      const a = COUNTRY_CENTROIDS[prev.country];
      const b = COUNTRY_CENTROIDS[input.country];
      if (!a || !b) {
        outcome = { kind: 'ok', reason: 'unknown-centroid' };
      } else {
        const distanceKm = haversineKm(a, b);
        const elapsedMinutes = elapsedMs / 60_000;
        const speedKmh = (distanceKm / elapsedMinutes) * 60;
        if (speedKmh <= IMPOSSIBLE_SPEED_KMH) {
          outcome = { kind: 'ok', reason: 'under-threshold' };
        } else {
          const rec: SignInAnomalyRecord = {
            id: randomUUID(),
            actor: input.actor,
            current: { ip: input.ip, country: input.country, at: input.at, method: input.method },
            previous: { ip: prev.ip, country: prev.country, at: prev.at, method: prev.method },
            distanceKm: Math.round(distanceKm),
            elapsedMinutes: Math.round(elapsedMinutes * 10) / 10,
            speedKmh: Math.round(speedKmh),
            thresholdKmh: IMPOSSIBLE_SPEED_KMH,
            acknowledgedAt: null,
            acknowledgedBy: null,
            createdAt: input.at,
          };
          file.records.push(rec);
          if (file.records.length > MAX_RECORDS) {
            file.records.splice(0, file.records.length - MAX_RECORDS);
          }
          outcome = { kind: 'recorded', record: rec };
        }
      }
    }
  }

  file.lastSeen[input.actor] = nextAnchor;
  await writeFile_(dataDir, file);
  return outcome;
}

export interface ListFilters {
  acknowledged?: boolean;
  sinceMs?: number;
  limit?: number;
  cursor?: string;
}

export interface ListResult {
  records: SignInAnomalyRecord[];
  nextCursor: string | null;
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function decodeCursor(c: string | undefined): number {
  if (!c) return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(c, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function paginate(rows: SignInAnomalyRecord[], cursor: string | undefined, limit: number): ListResult {
  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  const cutoff = decodeCursor(cursor);
  const filtered = sorted.filter((r) => r.createdAt < cutoff);
  const page = filtered.slice(0, limit);
  const nextCursor = filtered.length > limit ? String(page[page.length - 1]!.createdAt) : null;
  return { records: page, nextCursor, total: rows.length };
}

function applyFilters(rows: SignInAnomalyRecord[], f: ListFilters): SignInAnomalyRecord[] {
  let out = rows;
  if (typeof f.acknowledged === 'boolean') {
    out = out.filter((r) => (r.acknowledgedAt != null) === f.acknowledged);
  }
  if (f.sinceMs) out = out.filter((r) => r.createdAt >= f.sinceMs!);
  return out;
}

export async function listForUser(
  dataDir: string,
  userId: string,
  filters: ListFilters = {},
): Promise<ListResult> {
  const file = await readFile_(dataDir);
  // Cross-tenant safety: a user only ever sees anomalies where they are
  // the actor. The admin /all surface is the only place that can list
  // anomalies for other actors.
  const mine = file.records.filter((r) => r.actor === userId);
  const filtered = applyFilters(mine, filters);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  return paginate(filtered, filters.cursor, limit);
}

export async function listAll(
  dataDir: string,
  filters: ListFilters & { actor?: string; q?: string } = {},
): Promise<ListResult> {
  const file = await readFile_(dataDir);
  let rows = file.records;
  if (filters.actor) rows = rows.filter((r) => r.actor === filters.actor);
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((r) =>
      r.actor.toLowerCase().includes(q) ||
      r.current.ip.toLowerCase().includes(q) ||
      r.previous.ip.toLowerCase().includes(q) ||
      r.current.country.toLowerCase().includes(q) ||
      r.previous.country.toLowerCase().includes(q),
    );
  }
  const filtered = applyFilters(rows, filters);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  return paginate(filtered, filters.cursor, limit);
}

export interface AckArgs {
  id: string;
  actor: string;        // who is acknowledging (audit trail)
  scope: 'self' | 'admin';
  userId: string;       // the calling user, for ownership check in 'self' scope
}

export async function acknowledge(dataDir: string, args: AckArgs): Promise<SignInAnomalyRecord | null> {
  const file = await readFile_(dataDir);
  const idx = file.records.findIndex((r) => r.id === args.id);
  if (idx === -1) return null;
  const rec = file.records[idx]!;
  // 'self' scope: the caller must be the anomaly's actor. Without this
  // a regular user could acknowledge another user's anomaly via /self
  // and remove it from the admin queue.
  if (args.scope === 'self' && rec.actor !== args.userId) return null;
  if (rec.acknowledgedAt != null) return rec;
  rec.acknowledgedAt = Date.now();
  rec.acknowledgedBy = args.actor;
  await writeFile_(dataDir, file);
  return rec;
}

export async function countOpen(dataDir: string, userId?: string): Promise<number> {
  const file = await readFile_(dataDir);
  return file.records.filter(
    (r) => r.acknowledgedAt == null && (!userId || r.actor === userId),
  ).length;
}

/** Reset on disk. Intended for tests. */
export async function _resetForTests(dataDir: string): Promise<void> {
  await writeFile_(dataDir, { version: 1, records: [], lastSeen: {} });
}

/** Exported for tests so the centroid table can be exercised directly. */
export const _COUNTRY_CENTROIDS = COUNTRY_CENTROIDS;
