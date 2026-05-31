import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Per-user usage tracking and monthly free-tier quota.
//
// Events are appended as JSONL to `usage.log` so writes stay O(1) and the
// file is grep-friendly during incident review. The per-month rollup is
// recomputed on demand from the tail of the log, then cached in memory for
// the current process. We deliberately keep this dependency-free so the
// service can run in any storage tier the rest of ClawMind already uses.
//
// A "unit" is one billable operation. /v1/ask counts as 1 unit, /v1/search
// counts as 1 unit. This matches what a customer sees on their meter and is
// what enforce() compares against the monthly free-tier limit.

export type UsageKind = 'ask' | 'search';

export interface UsageEvent {
  ts: number;
  userId: string;
  kind: UsageKind;
  units: number;
}

export interface UsageSummary {
  userId: string;
  period: string;          // YYYY-MM
  used: number;
  limit: number;
  remaining: number;
  resetsAt: number;        // unix ms, first of next month UTC
  byKind: Record<UsageKind, number>;
  plan: 'free';
}

export const DEFAULT_FREE_LIMIT = 500;

function file(dataDir: string) {
  return join(dataDir, 'usage.log');
}

export function periodOf(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function nextResetMs(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

export async function recordUsage(
  dataDir: string,
  userId: string,
  kind: UsageKind,
  units = 1,
  now: number = Date.now(),
): Promise<UsageEvent> {
  const ev: UsageEvent = { ts: now, userId, kind, units };
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await appendFile(f, JSON.stringify(ev) + '\n');
  return ev;
}

async function readAll(dataDir: string): Promise<UsageEvent[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const out: UsageEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as UsageEvent;
        if (ev && typeof ev.ts === 'number' && typeof ev.userId === 'string') out.push(ev);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function getUsage(
  dataDir: string,
  userId: string,
  now: number = Date.now(),
  limit: number = DEFAULT_FREE_LIMIT,
): Promise<UsageSummary> {
  const period = periodOf(now);
  const events = await readAll(dataDir);
  let used = 0;
  const byKind: Record<UsageKind, number> = { ask: 0, search: 0 };
  for (const ev of events) {
    if (ev.userId !== userId) continue;
    if (periodOf(ev.ts) !== period) continue;
    used += ev.units;
    if (ev.kind in byKind) byKind[ev.kind] += ev.units;
  }
  return {
    userId,
    period,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: nextResetMs(now),
    byKind,
    plan: 'free',
  };
}

export interface EnforceResult {
  allowed: boolean;
  summary: UsageSummary;
}

/**
 * Check the user has at least `units` of headroom this month. Does NOT
 * record the event; call recordUsage after the operation succeeds so a
 * failed request does not eat a user's quota.
 */
export async function enforceQuota(
  dataDir: string,
  userId: string,
  units = 1,
  now: number = Date.now(),
  limit: number = DEFAULT_FREE_LIMIT,
): Promise<EnforceResult> {
  const summary = await getUsage(dataDir, userId, now, limit);
  return { allowed: summary.remaining >= units, summary };
}

/** Test helper: nuke the log. Never call from production code paths. */
export async function _resetForTest(dataDir: string): Promise<void> {
  await writeFile(file(dataDir), '');
}
