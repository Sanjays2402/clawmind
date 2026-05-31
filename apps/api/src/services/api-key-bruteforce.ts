// API-key bearer-token brute-force throttle.
//
// Background. The /v1 surface accepts a Bearer API key on every request.
// `verifySecret` is constant-time against a known set of hashes, but a
// determined attacker can still mount an online dictionary attack from a
// single IP at full network speed. Enterprise procurement reviewers ask
// the same question every time: "what happens if someone brute-forces a
// key from a fixed IP?". This module answers it.
//
// Behaviour.
//   * Per-source-IP counter of consecutive failed Bearer verifications.
//   * `MAX_FAILS` failures inside `WINDOW_MS` triggers a `LOCKOUT_MS`
//     block. Further Bearer requests from that IP return 429 with
//     `X-RateLimit-Reset` and `Retry-After` headers before `verifySecret`
//     is even called, so the attacker cannot keep probing.
//   * A successful verify from the IP resets its counter immediately.
//   * Owners can list and clear active locks via /v1/api-key-bruteforce.
//   * Each lock and unlock writes an audit entry so security can prove
//     the control fired.
//
// State.
//   * In-process Map for the hot path. Single-node deploys are the only
//     supported topology today; a Redis backend can swap in here without
//     touching call sites.
//   * Append-only JSONL log at <dataDir>/api-key-bruteforce.log records
//     every failure and every lockout decision, so an investigator can
//     reconstruct an attack timeline after the fact.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_MAX_FAILS = 6;
const DEFAULT_WINDOW_MS = 5 * 60_000;       // 5 minutes
const DEFAULT_LOCKOUT_MS = 15 * 60_000;     // 15 minutes
const LOG_FILE = 'api-key-bruteforce.log';

export interface BruteForceConfig {
  /** Failures inside the window that trip the lockout. */
  maxFails: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
  /** How long the lock stays active after it trips. */
  lockoutMs: number;
}

export const DEFAULT_CONFIG: BruteForceConfig = {
  maxFails: DEFAULT_MAX_FAILS,
  windowMs: DEFAULT_WINDOW_MS,
  lockoutMs: DEFAULT_LOCKOUT_MS,
};

interface IpState {
  /** Unix-ms timestamps of recent failures, oldest first. */
  failures: number[];
  /** Lock active until this Unix-ms timestamp, or 0 if not locked. */
  lockedUntil: number;
  /** Total failures observed since process start. Informational. */
  totalFails: number;
  /** Total times this IP has been put into lockout. Informational. */
  totalLocks: number;
  /** Last failure reason. */
  lastReason: string | null;
}

const state = new Map<string, IpState>();
let currentConfig: BruteForceConfig = { ...DEFAULT_CONFIG };

export function configure(partial: Partial<BruteForceConfig>): void {
  currentConfig = { ...currentConfig, ...partial };
}

export function getConfig(): BruteForceConfig {
  return { ...currentConfig };
}

function getOrInit(ip: string): IpState {
  let s = state.get(ip);
  if (!s) {
    s = { failures: [], lockedUntil: 0, totalFails: 0, totalLocks: 0, lastReason: null };
    state.set(ip, s);
  }
  return s;
}

function pruneWindow(s: IpState, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  while (s.failures.length > 0 && s.failures[0]! < cutoff) s.failures.shift();
}

export interface LockStatus {
  locked: boolean;
  /** Failures observed inside the current sliding window. */
  recent: number;
  /** Unix-ms timestamp when the lock (if any) expires. */
  lockedUntil: number;
  /** Configured max failures before lockout. */
  maxFails: number;
  /** Configured window in ms. */
  windowMs: number;
}

/**
 * Inspect the current lock status for an IP. Cheap, allocation-free on
 * the unlocked path. Called by the auth preHandler before verifySecret.
 */
export function status(ip: string, now: number = Date.now()): LockStatus {
  const s = state.get(ip);
  if (!s) {
    return {
      locked: false,
      recent: 0,
      lockedUntil: 0,
      maxFails: currentConfig.maxFails,
      windowMs: currentConfig.windowMs,
    };
  }
  if (s.lockedUntil > 0 && s.lockedUntil <= now) {
    // Lock expired naturally; clear it but keep the failure history so the
    // next failure does not immediately re-lock at count=1.
    s.lockedUntil = 0;
    s.failures = [];
  }
  pruneWindow(s, now, currentConfig.windowMs);
  return {
    locked: s.lockedUntil > now,
    recent: s.failures.length,
    lockedUntil: s.lockedUntil,
    maxFails: currentConfig.maxFails,
    windowMs: currentConfig.windowMs,
  };
}

export interface RecordFailureResult {
  /** True if this failure pushed the IP into lockout. */
  lockedNow: boolean;
  status: LockStatus;
}

/**
 * Record one failed Bearer verification from `ip` with the given reason.
 * Returns the updated status so the caller can decide whether to emit an
 * audit entry for a fresh lockout event.
 */
export async function recordFailure(
  dataDir: string,
  ip: string,
  reason: string,
  now: number = Date.now(),
): Promise<RecordFailureResult> {
  const s = getOrInit(ip);
  pruneWindow(s, now, currentConfig.windowMs);
  s.failures.push(now);
  s.totalFails += 1;
  s.lastReason = reason;
  let lockedNow = false;
  if (s.lockedUntil <= now && s.failures.length >= currentConfig.maxFails) {
    s.lockedUntil = now + currentConfig.lockoutMs;
    s.totalLocks += 1;
    lockedNow = true;
  }
  await appendLog(dataDir, {
    ts: now,
    event: lockedNow ? 'lock' : 'fail',
    ip,
    reason,
    recent: s.failures.length,
    lockedUntil: s.lockedUntil,
  });
  return {
    lockedNow,
    status: {
      locked: s.lockedUntil > now,
      recent: s.failures.length,
      lockedUntil: s.lockedUntil,
      maxFails: currentConfig.maxFails,
      windowMs: currentConfig.windowMs,
    },
  };
}

/**
 * Reset the failure counter for `ip`. Called on a successful Bearer
 * verification so that intermittent typos by a legitimate user do not
 * accumulate over hours and surprise-lock them.
 */
export function recordSuccess(ip: string): void {
  const s = state.get(ip);
  if (!s) return;
  if (s.lockedUntil > Date.now()) return; // a locked IP must stay locked
  s.failures = [];
}

/**
 * Manually clear a lock. Owners use this from the admin UI when they
 * recognise a legitimate IP and want to restore access immediately.
 * Returns true if the IP had any tracked state.
 */
export async function unlock(dataDir: string, ip: string, actor: string): Promise<boolean> {
  const s = state.get(ip);
  if (!s) return false;
  const wasLocked = s.lockedUntil > Date.now();
  s.failures = [];
  s.lockedUntil = 0;
  await appendLog(dataDir, {
    ts: Date.now(),
    event: 'unlock',
    ip,
    reason: `manual by ${actor}`,
    recent: 0,
    lockedUntil: 0,
    wasLocked,
  });
  return true;
}

export interface IpSnapshot {
  ip: string;
  locked: boolean;
  recent: number;
  lockedUntil: number;
  totalFails: number;
  totalLocks: number;
  lastReason: string | null;
}

/**
 * List every IP the throttle has observed. Sorted with locked IPs first,
 * then most recent failure count. Used by the admin UI.
 */
export function list(now: number = Date.now()): IpSnapshot[] {
  const out: IpSnapshot[] = [];
  for (const [ip, s] of state) {
    if (s.lockedUntil > 0 && s.lockedUntil <= now) {
      s.lockedUntil = 0;
      s.failures = [];
    }
    pruneWindow(s, now, currentConfig.windowMs);
    out.push({
      ip,
      locked: s.lockedUntil > now,
      recent: s.failures.length,
      lockedUntil: s.lockedUntil,
      totalFails: s.totalFails,
      totalLocks: s.totalLocks,
      lastReason: s.lastReason,
    });
  }
  out.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    if (b.recent !== a.recent) return b.recent - a.recent;
    return b.totalFails - a.totalFails;
  });
  return out;
}

interface LogEntry {
  ts: number;
  event: 'fail' | 'lock' | 'unlock';
  ip: string;
  reason: string;
  recent: number;
  lockedUntil: number;
  wasLocked?: boolean;
}

async function appendLog(dataDir: string, entry: LogEntry): Promise<void> {
  const file = join(dataDir, LOG_FILE);
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Logging must never break the auth path.
  }
}

/**
 * Read the most recent N log entries for the admin UI. Best-effort: a
 * missing or partially written log returns an empty array rather than
 * throwing.
 */
export async function tail(dataDir: string, limit = 100): Promise<LogEntry[]> {
  const file = join(dataDir, LOG_FILE);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const slice = lines.slice(Math.max(0, lines.length - limit));
  const out: LogEntry[] = [];
  for (const line of slice) {
    try {
      out.push(JSON.parse(line) as LogEntry);
    } catch {
      // Skip a corrupt line rather than fail the whole admin call.
    }
  }
  return out.reverse();
}

/** Test helper: wipe every tracked IP. */
export function _resetAll(): void {
  state.clear();
  currentConfig = { ...DEFAULT_CONFIG };
}
