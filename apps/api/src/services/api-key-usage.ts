import { appendFile, mkdir, readFile, stat, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-API-key request usage log. Each successful authenticated request made
// with a Bearer key appends a single line to data/api-key-usage/<keyId>.jsonl.
// Keeping it append-only and per-key means the hot path is a single sequential
// write and there is no shared file to lock contend on. A small in-process
// soft cap keeps the log from growing without bound on busy keys; when the
// file crosses MAX_BYTES we keep the most recent TRIM_KEEP entries.
//
// The log answers a real product question: "is this API key actually in
// use, and what is it doing?" which is the question a customer asks before
// rotating or revoking a credential.

export interface UsageEvent {
  ts: number;          // ms epoch
  route: string;       // routerPath (template) e.g. /v1/ask
  method: string;      // GET, POST, ...
  status: number;      // HTTP status code
  ms: number;          // request duration in ms (0 if unavailable)
  // Forensic context. Captured on the request that produced the event so a
  // workspace owner can answer "which IP made this call?" and "which
  // client library is using this key?" without grepping the audit chain.
  // Optional because the field was introduced after launch and old log
  // lines do not have it; UI must tolerate undefined.
  ip?: string;         // client IP as Fastify resolved it (respects trust proxy)
  ua?: string;         // first 256 chars of the User-Agent header; truncated
}

// Hard cap on the User-Agent we store. A maliciously long header should
// not blow up the per-key log file. 256 is plenty for every real client
// string we have ever seen and keeps a 1000-line log under ~512 KB even
// if every entry uses the full budget.
export const UA_MAX_LEN = 256;

export function normaliseUa(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  return trimmed.length > UA_MAX_LEN ? trimmed.slice(0, UA_MAX_LEN) : trimmed;
}

export interface UsageTotals {
  total: number;
  last24h: number;
  last7d: number;
  lastStatusOk: number;     // 2xx count in window
  lastStatusErr: number;    // non-2xx count in window
  firstAt: number | null;
  lastAt: number | null;
}

export interface RouteAggregate {
  route: string;
  method: string;
  count: number;
  lastAt: number;
}

export interface IpAggregate {
  ip: string;
  count: number;
  lastAt: number;
}

export interface UsageReport {
  keyId: string;
  totals: UsageTotals;
  recent: UsageEvent[];         // newest first, capped
  byRoute: RouteAggregate[];    // sorted by count desc, capped
  byIp: IpAggregate[];          // sorted by count desc, capped; forensic
  uniqueIps: number;            // total distinct IPs across the whole log
}

const DIR = 'api-key-usage';
const MAX_BYTES = 256 * 1024;        // ~256 KB per key before we trim
const TRIM_KEEP = 1000;              // entries retained after a trim
const DEFAULT_RECENT = 25;
const DEFAULT_ROUTES = 10;
const DEFAULT_IPS = 10;

function fileFor(dataDir: string, keyId: string): string {
  // keyId comes from nanoid and is alphanum, but be defensive.
  const safe = keyId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(dataDir, DIR, `${safe}.jsonl`);
}

/**
 * Append a single usage event for a key. Errors are swallowed; usage logging
 * must never block or fail a real request.
 */
export async function recordUsage(
  dataDir: string,
  keyId: string,
  event: UsageEvent,
): Promise<void> {
  try {
    const f = fileFor(dataDir, keyId);
    await mkdir(dirname(f), { recursive: true });
    await appendFile(f, JSON.stringify(event) + '\n', 'utf8');
    // Opportunistic trim: cheap stat, only rewrite when we cross the cap.
    const st = await stat(f).catch(() => null);
    if (st && st.size > MAX_BYTES) {
      await trim(f);
    }
  } catch {
    // Intentionally ignore.
  }
}

async function trim(file: string): Promise<void> {
  try {
    const raw = await readFile(file, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= TRIM_KEEP) return;
    const kept = lines.slice(lines.length - TRIM_KEEP).join('\n') + '\n';
    const tmp = file + '.tmp';
    await (await import('node:fs/promises')).writeFile(tmp, kept, 'utf8');
    await rename(tmp, file);
  } catch {
    // Ignore; next append will retry the trim check.
  }
}

async function readAll(dataDir: string, keyId: string): Promise<UsageEvent[]> {
  try {
    const raw = await readFile(fileFor(dataDir, keyId), 'utf8');
    const out: UsageEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as UsageEvent;
        if (typeof ev.ts === 'number' && typeof ev.route === 'string') out.push(ev);
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export interface ReportOptions {
  recent?: number;
  routes?: number;
  ips?: number;
  now?: number;
}

export async function getUsageReport(
  dataDir: string,
  keyId: string,
  opts: ReportOptions = {},
): Promise<UsageReport> {
  const events = await readAll(dataDir, keyId);
  const now = opts.now ?? Date.now();
  const recentLimit = Math.max(1, Math.min(200, opts.recent ?? DEFAULT_RECENT));
  const routeLimit = Math.max(1, Math.min(50, opts.routes ?? DEFAULT_ROUTES));

  const day = 24 * 60 * 60_000;
  const week = 7 * day;
  let last24h = 0;
  let last7d = 0;
  let okCount = 0;
  let errCount = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  const routeMap = new Map<string, RouteAggregate>();

  for (const ev of events) {
    if (firstAt === null || ev.ts < firstAt) firstAt = ev.ts;
    if (lastAt === null || ev.ts > lastAt) lastAt = ev.ts;
    if (now - ev.ts <= day) last24h++;
    if (now - ev.ts <= week) {
      last7d++;
      if (ev.status >= 200 && ev.status < 300) okCount++;
      else errCount++;
    }
    const k = `${ev.method} ${ev.route}`;
    const existing = routeMap.get(k);
    if (existing) {
      existing.count++;
      if (ev.ts > existing.lastAt) existing.lastAt = ev.ts;
    } else {
      routeMap.set(k, { route: ev.route, method: ev.method, count: 1, lastAt: ev.ts });
    }
  }

  // Aggregate by source IP for the forensics panel. Events with no IP
  // (older log lines from before forensic capture, or internal calls)
  // are skipped so the panel only shows actionable rows.
  const ipMap = new Map<string, IpAggregate>();
  for (const ev of events) {
    if (!ev.ip) continue;
    const existing = ipMap.get(ev.ip);
    if (existing) {
      existing.count++;
      if (ev.ts > existing.lastAt) existing.lastAt = ev.ts;
    } else {
      ipMap.set(ev.ip, { ip: ev.ip, count: 1, lastAt: ev.ts });
    }
  }
  const ipLimit = Math.max(1, Math.min(50, (opts as { ips?: number }).ips ?? DEFAULT_IPS));
  const byIp = [...ipMap.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, ipLimit);

  const recent = events.slice(-recentLimit).reverse();
  const byRoute = [...routeMap.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .slice(0, routeLimit);

  return {
    keyId,
    totals: {
      total: events.length,
      last24h,
      last7d,
      lastStatusOk: okCount,
      lastStatusErr: errCount,
      firstAt,
      lastAt,
    },
    recent,
    byRoute,
    byIp,
    uniqueIps: ipMap.size,
  };
}

/** Delete the usage log for a key. Called when the key is revoked. */
export async function purgeUsage(dataDir: string, keyId: string): Promise<void> {
  try {
    await unlink(fileFor(dataDir, keyId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Swallow; not critical.
    }
  }
}
