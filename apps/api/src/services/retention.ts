import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pruneHistory } from './history.js';
import { listConversations, deleteConversation } from './conversations.js';

// Per-user data retention policy. Lets a customer cap how long ClawMind
// keeps their personal records before auto-erasing them. Required for
// GDPR/CCPA data minimisation reviews and for buyers whose security team
// will not approve "indefinite retention by default".
//
// Three knobs, all optional and independent:
//   historyDays        max age (days) of /v1/history entries
//   conversationDays   max age (days) of /v1/conversations (uses updatedAt)
//   auditDays          requested retention hint for the immutable audit log
//                      (the log itself is append-only and hash-chained;
//                      this value is surfaced for compliance reporting and
//                      future hard-delete tooling, never silently honoured)
//
// `null` on any field means "keep forever". The sweep is invoked from a
// scheduled job and on-demand via POST /v1/retention/apply. Dry-run mode
// reports counts without touching disk so the customer can preview.

export interface RetentionPolicy {
  userId: string;
  historyDays: number | null;
  conversationDays: number | null;
  auditDays: number | null;
  updatedAt: number;
  lastSweepAt: number | null;
}

export interface RetentionPatch {
  historyDays?: number | null;
  conversationDays?: number | null;
  auditDays?: number | null;
}

export const RETENTION_LIMITS = Object.freeze({
  minDays: 1,
  maxDays: 3650, // 10 years
});

const FILE_NAME = 'retention.json';

function file(dataDir: string): string {
  return join(dataDir, FILE_NAME);
}

function defaults(userId: string, now: number): RetentionPolicy {
  return {
    userId,
    historyDays: null,
    conversationDays: null,
    auditDays: null,
    updatedAt: now,
    lastSweepAt: null,
  };
}

async function loadAll(dataDir: string): Promise<RetentionPolicy[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RetentionPolicy[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveAll(dataDir: string, all: RetentionPolicy[]): Promise<void> {
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(all, null, 2), 'utf8');
}

export async function getPolicy(dataDir: string, userId: string): Promise<RetentionPolicy> {
  const all = await loadAll(dataDir);
  return all.find((p) => p.userId === userId) ?? defaults(userId, Date.now());
}

export async function listPolicies(dataDir: string): Promise<RetentionPolicy[]> {
  return loadAll(dataDir);
}

export class RetentionValidationError extends Error {
  constructor(public field: keyof RetentionPatch, message: string) {
    super(message);
    this.name = 'RetentionValidationError';
  }
}

export function validatePatch(patch: RetentionPatch): void {
  const fields: Array<keyof RetentionPatch> = ['historyDays', 'conversationDays', 'auditDays'];
  for (const f of fields) {
    const v = patch[f];
    if (v === undefined || v === null) continue;
    if (!Number.isInteger(v)) {
      throw new RetentionValidationError(f, `${f} must be an integer number of days or null`);
    }
    if (v < RETENTION_LIMITS.minDays || v > RETENTION_LIMITS.maxDays) {
      throw new RetentionValidationError(
        f,
        `${f} must be between ${RETENTION_LIMITS.minDays} and ${RETENTION_LIMITS.maxDays} days`,
      );
    }
  }
}

export async function updatePolicy(
  dataDir: string,
  userId: string,
  patch: RetentionPatch,
): Promise<RetentionPolicy> {
  validatePatch(patch);
  const now = Date.now();
  const all = await loadAll(dataDir);
  const idx = all.findIndex((p) => p.userId === userId);
  const base: RetentionPolicy = idx >= 0 ? all[idx]! : defaults(userId, now);
  const next: RetentionPolicy = {
    ...base,
    ...(patch.historyDays !== undefined ? { historyDays: patch.historyDays } : {}),
    ...(patch.conversationDays !== undefined ? { conversationDays: patch.conversationDays } : {}),
    ...(patch.auditDays !== undefined ? { auditDays: patch.auditDays } : {}),
    updatedAt: now,
  };
  if (idx >= 0) all[idx] = next; else all.push(next);
  await saveAll(dataDir, all);
  return next;
}

export interface SweepReport {
  userId: string;
  dryRun: boolean;
  history: { removed: number; kept: number };
  conversations: { removed: number; kept: number; removedIds: string[] };
  auditDays: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Apply the user's retention policy. Removes records older than the policy
 * for history and conversations. The audit log is reported but never
 * silently erased: hash-chained logs need an explicit operator action to
 * truncate, which preserves their evidentiary value for SOC2 audits.
 */
export async function applyPolicy(
  dataDir: string,
  userId: string,
  opts: { dryRun?: boolean; now?: number } = {},
): Promise<SweepReport> {
  const now = opts.now ?? Date.now();
  const dryRun = !!opts.dryRun;
  const policy = await getPolicy(dataDir, userId);

  const report: SweepReport = {
    userId,
    dryRun,
    history: { removed: 0, kept: 0 },
    conversations: { removed: 0, kept: 0, removedIds: [] },
    auditDays: policy.auditDays,
  };

  // History: cheap reuse of pruneHistory's atomic rewrite.
  if (policy.historyDays !== null) {
    const before = now - policy.historyDays * DAY_MS;
    if (dryRun) {
      const { readFile } = await import('node:fs/promises');
      try {
        const raw = await readFile(join(dataDir, 'history.jsonl'), 'utf8');
        const mine = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { userId?: string; ts?: number })
          .filter((i) => i.userId === userId && typeof i.ts === 'number');
        const kept = mine.filter((i) => (i.ts ?? 0) >= before).length;
        report.history = { removed: mine.length - kept, kept };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    } else {
      const res = await pruneHistory(dataDir, userId, { before });
      report.history = { removed: res.removed, kept: res.kept };
    }
  }

  // Conversations: stale if updatedAt is older than the policy.
  if (policy.conversationDays !== null) {
    const before = now - policy.conversationDays * DAY_MS;
    const convs = await listConversations(dataDir, userId, { archived: undefined });
    const stale = convs.filter((c) => (c.updatedAt ?? c.createdAt ?? 0) < before);
    report.conversations.removedIds = stale.map((c) => c.id);
    report.conversations.kept = convs.length - stale.length;
    report.conversations.removed = stale.length;
    if (!dryRun) {
      for (const c of stale) {
        await deleteConversation(dataDir, userId, c.id);
      }
    }
  }

  if (!dryRun && (report.history.removed > 0 || report.conversations.removed > 0)) {
    const all = await loadAll(dataDir);
    const idx = all.findIndex((p) => p.userId === userId);
    if (idx >= 0) {
      all[idx] = { ...(all[idx] as RetentionPolicy), lastSweepAt: now };
      await saveAll(dataDir, all);
    } else {
      all.push({ ...defaults(userId, now), lastSweepAt: now });
      await saveAll(dataDir, all);
    }
  }

  return report;
}
