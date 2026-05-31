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

export interface WorkspaceUsageSummary {
  period: string;
  used: number;
  limit: number;          // may be Infinity when uncapped
  remaining: number;      // may be Infinity when uncapped
  resetsAt: number;
  byKind: Record<UsageKind, number>;
  members: number;        // distinct member ids that consumed at least one unit this period
}

/**
 * Workspace-wide usage rollup for the current calendar month. Used by
 * the workspace quota gate (see workspace-quota.ts) and by the admin
 * spend dashboard.
 */
export async function getWorkspaceUsage(
  dataDir: string,
  now: number = Date.now(),
  limit: number = Number.POSITIVE_INFINITY,
): Promise<WorkspaceUsageSummary> {
  const period = periodOf(now);
  const events = await readAll(dataDir);
  let used = 0;
  const byKind: Record<UsageKind, number> = { ask: 0, search: 0 };
  const seen = new Set<string>();
  for (const ev of events) {
    if (periodOf(ev.ts) !== period) continue;
    used += ev.units;
    if (ev.kind in byKind) byKind[ev.kind] += ev.units;
    seen.add(ev.userId);
  }
  const remaining = Number.isFinite(limit) ? Math.max(0, limit - used) : Number.POSITIVE_INFINITY;
  return {
    period,
    used,
    limit,
    remaining,
    resetsAt: nextResetMs(now),
    byKind,
    members: seen.size,
  };
}

export interface EnforceResult {
  allowed: boolean;
  summary: UsageSummary;
  // When the workspace-wide ceiling is the blocker we surface a separate
  // shape so callers can return the right error to the user. null when
  // the workspace check passed (or was unlimited).
  workspace?: WorkspaceUsageSummary | null;
  // 'user' = per-member cap, 'workspace' = workspace ceiling, null = ok
  blocker?: 'user' | 'workspace' | null;
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

/**
 * Workspace + per-user quota gate. Loads the owner-configured workspace
 * policy and the per-user free-tier ceiling, then reports which (if
 * either) would be blown by recording `units`. Both checks run so the
 * caller can surface the more specific failure (e.g. "workspace cap
 * hit" vs "your seat cap hit").
 */
export async function enforceWorkspaceAndUserQuota(
  dataDir: string,
  userId: string,
  units: number,
  workspaceLimit: number,
  userLimit: number,
  now: number = Date.now(),
): Promise<EnforceResult> {
  const userSummary = await getUsage(dataDir, userId, now, Number.isFinite(userLimit) ? userLimit : DEFAULT_FREE_LIMIT);
  // Override the displayed limit so the response reflects the effective
  // ceiling the workspace owner configured, not the historical 500.
  if (Number.isFinite(userLimit)) {
    userSummary.limit = userLimit;
    userSummary.remaining = Math.max(0, userLimit - userSummary.used);
  }
  const wsSummary = await getWorkspaceUsage(dataDir, now, workspaceLimit);
  const userOk = !Number.isFinite(userLimit) || userSummary.used + units <= userLimit;
  const wsOk = !Number.isFinite(workspaceLimit) || wsSummary.used + units <= workspaceLimit;
  let blocker: 'user' | 'workspace' | null = null;
  if (!wsOk) blocker = 'workspace';
  else if (!userOk) blocker = 'user';
  return {
    allowed: userOk && wsOk,
    summary: userSummary,
    workspace: wsSummary,
    blocker,
  };
}

/** Test helper: nuke the log. Never call from production code paths. */
export async function _resetForTest(dataDir: string): Promise<void> {
  await writeFile(file(dataDir), '');
}
