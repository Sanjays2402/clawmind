import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { DEFAULT_FREE_LIMIT } from './usage.js';

// Workspace-level monthly request quota.
//
// Enterprise procurement reviewers require predictable, owner-configurable
// spend caps. The per-user free-tier ceiling baked into usage.ts is fine
// for individual signup but useless once a workspace has billed seats:
// the buyer needs ONE knob that says "this workspace cannot burn more
// than N billable units this month, no matter how many members or API
// keys it has". This service is that knob.
//
// Storage: a single JSON file under the data dir. Tiny, hand-auditable,
// no migration. Updates are audit-logged at the route layer so SOC2
// reviewers can prove who raised or lowered the cap and when.
//
// Semantics:
//   - monthlyLimit === null    => unlimited (enterprise / on-prem default)
//   - monthlyLimit  >  0        => hard cap, enforced pre-call on ask /
//                                  search / batch and surfaced to the
//                                  in-app usage meter as the displayed
//                                  ceiling.
//   - perUserMonthlyLimit  ===  null => no extra per-member cap.
//   - perUserMonthlyLimit  >  0       => additionally enforced per caller
//                                  so a single rogue key cannot eat the
//                                  whole workspace's headroom.

export interface WorkspaceQuotaPolicy {
  // Workspace-wide monthly ceiling in billable units (1 unit = 1 ask /
  // search / batch row). null means uncapped.
  monthlyLimit: number | null;
  // Optional secondary per-member ceiling. null means no extra cap.
  perUserMonthlyLimit: number | null;
  // Bookkeeping for the admin UI / audit chain.
  updatedAt: number;
  updatedBy: string | null;
}

export const QUOTA_LIMITS = Object.freeze({
  // Reject obviously-broken inputs at the validation boundary. Upper
  // bound is generous enough that no realistic enterprise budget hits
  // it accidentally but low enough that a fat-finger of "1e12" is
  // rejected instead of silently disabling the cap.
  minLimit: 1,
  maxLimit: 100_000_000,
});

export class WorkspaceQuotaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceQuotaValidationError';
  }
}

function file(dataDir: string): string {
  return join(dataDir, 'workspace-quota.json');
}

function defaults(): WorkspaceQuotaPolicy {
  // Default to the historical per-user free-tier number so existing
  // installs see no behaviour change on first deploy. Owners explicitly
  // opt into "unlimited" by saving { monthlyLimit: null }.
  return {
    monthlyLimit: DEFAULT_FREE_LIMIT,
    perUserMonthlyLimit: null,
    updatedAt: 0,
    updatedBy: null,
  };
}

export async function getPolicy(dataDir: string): Promise<WorkspaceQuotaPolicy> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorkspaceQuotaPolicy>;
    return {
      monthlyLimit:
        parsed.monthlyLimit === null
          ? null
          : typeof parsed.monthlyLimit === 'number'
            ? parsed.monthlyLimit
            : DEFAULT_FREE_LIMIT,
      perUserMonthlyLimit:
        parsed.perUserMonthlyLimit === null
          ? null
          : typeof parsed.perUserMonthlyLimit === 'number'
            ? parsed.perUserMonthlyLimit
            : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw err;
  }
}

export interface QuotaPatch {
  monthlyLimit?: number | null;
  perUserMonthlyLimit?: number | null;
}

function validateOne(name: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value)) {
    throw new WorkspaceQuotaValidationError(`${name} must be an integer or null`);
  }
  if (value < QUOTA_LIMITS.minLimit || value > QUOTA_LIMITS.maxLimit) {
    throw new WorkspaceQuotaValidationError(
      `${name} must be between ${QUOTA_LIMITS.minLimit} and ${QUOTA_LIMITS.maxLimit}, or null for unlimited`,
    );
  }
}

export function validatePatch(patch: QuotaPatch): void {
  validateOne('monthlyLimit', patch.monthlyLimit);
  validateOne('perUserMonthlyLimit', patch.perUserMonthlyLimit);
}

export async function updatePolicy(
  dataDir: string,
  actorUserId: string,
  patch: QuotaPatch,
  now: number = Date.now(),
): Promise<WorkspaceQuotaPolicy> {
  validatePatch(patch);
  const current = await getPolicy(dataDir);
  const next: WorkspaceQuotaPolicy = {
    monthlyLimit: 'monthlyLimit' in patch ? patch.monthlyLimit ?? null : current.monthlyLimit,
    perUserMonthlyLimit:
      'perUserMonthlyLimit' in patch
        ? patch.perUserMonthlyLimit ?? null
        : current.perUserMonthlyLimit,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(next, null, 2) + '\n');
  return next;
}

/**
 * The effective workspace ceiling to enforce against the workspace-wide
 * meter. `Infinity` means unlimited; callers must compare with
 * Number.isFinite before sending a number to the wire.
 */
export function effectiveWorkspaceLimit(p: WorkspaceQuotaPolicy): number {
  return p.monthlyLimit === null ? Number.POSITIVE_INFINITY : p.monthlyLimit;
}

/**
 * The effective per-member ceiling. Returns Infinity if not configured.
 */
export function effectiveUserLimit(p: WorkspaceQuotaPolicy): number {
  return p.perUserMonthlyLimit === null
    ? Number.POSITIVE_INFINITY
    : p.perUserMonthlyLimit;
}
