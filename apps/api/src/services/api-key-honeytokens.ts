// API key honeytokens (canary keys).
//
// A honeytoken is an API key that is intentionally never handed to a real
// caller. It is planted in a place an attacker is likely to find: a
// committed config file, a CI variable, a wiki page, a wrapped device
// image. The instant any process actually presents it on the wire, the
// auth layer:
//
//   * rejects the request with a 401 so the attacker sees the same
//     response as for any unknown key (no signal that they tripped a
//     trap);
//   * records a forensic incident (timestamp, source IP, user agent,
//     route, label) on the workspace incident log;
//   * writes an audit event so any SIEM drain or webhook subscriber
//     picks it up in real time.
//
// Honeytokens never grant access to anything. They are stored alongside
// normal API keys (so brute-force, IP allowlist, rotation checks all run
// against them naturally) but flagged isCanary=true. The keys route
// surfaces issue/list/revoke separately from real keys so a tired admin
// cannot accidentally hand a canary to a developer and burn the trap.
//
// Storage shape (data/honeytoken-incidents.json):
//   {
//     "schema": "clawmind.honeytoken.v1",
//     "incidents": [HoneytokenIncident, ...] // newest first, capped
//   }

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

export const HONEYTOKEN_SCHEMA = 'clawmind.honeytoken.v1' as const;

/** Hard cap so a flood of attacker probes cannot grow the file unbounded. */
export const HONEYTOKEN_INCIDENT_CAP = 500;

export interface HoneytokenIncident {
  id: string;
  /** API key id (not the secret) that was tripped. */
  keyId: string;
  /** Human label for the trap, copied from the key for offline analysis. */
  keyLabel: string;
  /** Optional planter note: "embedded in legacy mobile build". */
  note: string | null;
  /** Source IP that presented the secret. */
  ip: string | null;
  /** User-Agent header verbatim (truncated to 256 chars). */
  userAgent: string | null;
  /** Route the secret was presented against. */
  route: string | null;
  /** HTTP method (best-effort). */
  method: string | null;
  /** Request id, so it can be cross-referenced with the structured log. */
  requestId: string | null;
  /** Wall-clock time of the trip. */
  tippedAt: number;
}

export interface HoneytokenStore {
  schema: typeof HONEYTOKEN_SCHEMA;
  incidents: HoneytokenIncident[];
}

const EMPTY: HoneytokenStore = { schema: HONEYTOKEN_SCHEMA, incidents: [] };

function file(dataDir: string): string {
  return join(dataDir, 'honeytoken-incidents.json');
}

export async function loadIncidents(dataDir: string): Promise<HoneytokenStore> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<HoneytokenStore>;
    if (parsed && Array.isArray(parsed.incidents)) {
      return {
        schema: HONEYTOKEN_SCHEMA,
        incidents: parsed.incidents.slice(0, HONEYTOKEN_INCIDENT_CAP),
      };
    }
    return { ...EMPTY };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

async function saveIncidents(dataDir: string, store: HoneytokenStore): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(store, null, 2));
}

export interface RecordIncidentInput {
  keyId: string;
  keyLabel: string;
  note?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  route?: string | null;
  method?: string | null;
  requestId?: string | null;
  now?: number;
}

/** Append an incident, ring-buffered to HONEYTOKEN_INCIDENT_CAP. Newest first. */
export async function recordIncident(
  dataDir: string,
  input: RecordIncidentInput,
): Promise<HoneytokenIncident> {
  const incident: HoneytokenIncident = {
    id: nanoid(10),
    keyId: input.keyId,
    keyLabel: input.keyLabel,
    note: input.note ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ? input.userAgent.slice(0, 256) : null,
    route: input.route ?? null,
    method: input.method ?? null,
    requestId: input.requestId ?? null,
    tippedAt: input.now ?? Date.now(),
  };
  const store = await loadIncidents(dataDir);
  const next: HoneytokenStore = {
    schema: HONEYTOKEN_SCHEMA,
    incidents: [incident, ...store.incidents].slice(0, HONEYTOKEN_INCIDENT_CAP),
  };
  await saveIncidents(dataDir, next);
  return incident;
}

/** List incidents, newest first, optionally filtered by key id. */
export async function listIncidents(
  dataDir: string,
  opts: { keyId?: string; limit?: number } = {},
): Promise<HoneytokenIncident[]> {
  const store = await loadIncidents(dataDir);
  let items = store.incidents;
  if (opts.keyId) items = items.filter((x) => x.keyId === opts.keyId);
  if (opts.limit && opts.limit > 0) items = items.slice(0, opts.limit);
  return items;
}

/** Drop all incidents, returning the count removed. Used by owner-only clear. */
export async function clearIncidents(dataDir: string): Promise<number> {
  const store = await loadIncidents(dataDir);
  const removed = store.incidents.length;
  if (removed === 0) return 0;
  await saveIncidents(dataDir, { schema: HONEYTOKEN_SCHEMA, incidents: [] });
  return removed;
}
