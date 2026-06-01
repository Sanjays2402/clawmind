import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace-wide data classification labels.
//
// Every cited source path can carry exactly one sensitivity label drawn
// from a fixed four-level scale: public, internal, confidential,
// restricted. The order matters: it is the hierarchy that enforcement
// reads off of. An unlabelled path is treated as "internal" by default,
// which keeps existing content from being instantly downgraded to
// public-shareable when an owner enables the policy.
//
// The policy itself is a single knob, allowPublicShareUpTo, that caps
// how sensitive a cited source can be before POST /v1/share is rejected.
// Setting it to "public" means only paths explicitly labelled "public"
// can leave the workspace via a /s/<id> link. Setting it to "restricted"
// is a no-op (the default).
//
// Persisted at <dataDir>/classification.json with the same atomic
// tmp+rename pattern used by every other workspace policy file in this
// repo. Reads are cached for 1s on the share hot path.

const FILE = 'classification.json';
const DEFAULT_WORKSPACE = 'default';

export const LABELS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type Label = (typeof LABELS)[number];

// Numeric rank. Higher = more sensitive. Used purely for ordering the
// allowPublicShareUpTo comparison; not persisted.
const RANK: Record<Label, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

export const DEFAULT_UNLABELLED: Label = 'internal';

export function isLabel(s: unknown): s is Label {
  return typeof s === 'string' && (LABELS as readonly string[]).includes(s);
}

export interface ClassificationPolicy {
  workspaceId: string;
  // The most sensitive label that may appear in any cited source for a
  // public share to be minted. Defaults to "restricted" (everything is
  // shareable, policy effectively off).
  allowPublicShareUpTo: Label;
  // Default label applied to a path that has no explicit label. Owners
  // can flip this to "confidential" so new documents are quarantined
  // from share-by-default until classified.
  defaultLabel: Label;
  updatedAt: number;
  updatedBy: string | null;
}

interface ClassificationFile {
  version: 1;
  policies: ClassificationPolicy[];
  // path -> label. Single label per path. Removed when label is null.
  labels: Record<string, Label>;
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function emptyPolicy(workspaceId: string, now: number): ClassificationPolicy {
  return {
    workspaceId,
    allowPublicShareUpTo: 'restricted',
    defaultLabel: DEFAULT_UNLABELLED,
    updatedAt: now,
    updatedBy: null,
  };
}

function normalizePolicy(
  p: Partial<ClassificationPolicy> & { workspaceId: string },
  now: number,
): ClassificationPolicy {
  return {
    workspaceId: p.workspaceId,
    allowPublicShareUpTo: isLabel(p.allowPublicShareUpTo)
      ? p.allowPublicShareUpTo
      : 'restricted',
    defaultLabel: isLabel(p.defaultLabel) ? p.defaultLabel : DEFAULT_UNLABELLED,
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
    updatedBy: typeof p.updatedBy === 'string' ? p.updatedBy : null,
  };
}

async function loadAll(dataDir: string): Promise<ClassificationFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ClassificationFile>;
    if (!parsed || parsed.version !== 1) {
      return { version: 1, policies: [], labels: {} };
    }
    return {
      version: 1,
      policies: Array.isArray(parsed.policies) ? (parsed.policies as ClassificationPolicy[]) : [],
      labels: parsed.labels && typeof parsed.labels === 'object'
        ? (parsed.labels as Record<string, Label>)
        : {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, policies: [], labels: {} };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: ClassificationFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class ClassificationValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ClassificationValidationError';
  }
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ClassificationPolicy> {
  const all = await loadAll(dataDir);
  const found = all.policies.find((p) => p.workspaceId === workspaceId);
  return found ? normalizePolicy(found, Date.now()) : emptyPolicy(workspaceId, Date.now());
}

export interface UpdateInput {
  allowPublicShareUpTo?: Label;
  defaultLabel?: Label;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ClassificationPolicy> {
  const current = await getPolicy(dataDir, workspaceId);
  if (input.allowPublicShareUpTo !== undefined && !isLabel(input.allowPublicShareUpTo)) {
    throw new ClassificationValidationError(
      'allowPublicShareUpTo',
      `allowPublicShareUpTo must be one of ${LABELS.join(', ')}`,
    );
  }
  if (input.defaultLabel !== undefined && !isLabel(input.defaultLabel)) {
    throw new ClassificationValidationError(
      'defaultLabel',
      `defaultLabel must be one of ${LABELS.join(', ')}`,
    );
  }
  const next: ClassificationPolicy = {
    workspaceId,
    allowPublicShareUpTo: input.allowPublicShareUpTo ?? current.allowPublicShareUpTo,
    defaultLabel: input.defaultLabel ?? current.defaultLabel,
    updatedAt: Date.now(),
    updatedBy: actorUserId,
  };
  const all = await loadAll(dataDir);
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  all.policies = [...others, next];
  await saveAll(dataDir, all);
  invalidateCache();
  return next;
}

// --- Per-path labels ---------------------------------------------------------

function normalizePath(p: string): string {
  return p.trim();
}

export async function getLabel(
  dataDir: string,
  path: string,
): Promise<Label | null> {
  const all = await loadAll(dataDir);
  const v = all.labels[normalizePath(path)];
  return isLabel(v) ? v : null;
}

export async function setLabel(
  dataDir: string,
  actorUserId: string,
  path: string,
  label: Label | null,
): Promise<{ path: string; label: Label | null }> {
  const cleaned = normalizePath(path);
  if (!cleaned) {
    throw new ClassificationValidationError('path', 'path is required');
  }
  if (label !== null && !isLabel(label)) {
    throw new ClassificationValidationError(
      'label',
      `label must be null or one of ${LABELS.join(', ')}`,
    );
  }
  const all = await loadAll(dataDir);
  if (label === null) {
    delete all.labels[cleaned];
  } else {
    all.labels[cleaned] = label;
  }
  await saveAll(dataDir, all);
  invalidateLabels();
  return { path: cleaned, label };
}

export async function listLabels(
  dataDir: string,
): Promise<Array<{ path: string; label: Label }>> {
  const all = await loadAll(dataDir);
  return Object.entries(all.labels)
    .filter(([, v]) => isLabel(v))
    .map(([path, label]) => ({ path, label }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// --- Caching -----------------------------------------------------------------

let policyCache: { policy: ClassificationPolicy; expiresAt: number } | null = null;
let labelCache: { labels: Record<string, Label>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  policyCache = null;
}
export function invalidateLabels(): void {
  labelCache = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ClassificationPolicy> {
  const now = Date.now();
  if (policyCache && policyCache.policy.workspaceId === workspaceId && policyCache.expiresAt > now) {
    return policyCache.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  policyCache = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

async function getLabelMapCached(dataDir: string): Promise<Record<string, Label>> {
  const now = Date.now();
  if (labelCache && labelCache.expiresAt > now) return labelCache.labels;
  const all = await loadAll(dataDir);
  labelCache = { labels: all.labels, expiresAt: now + CACHE_TTL_MS };
  return all.labels;
}

// --- Enforcement -------------------------------------------------------------

export type ClassificationDenialReason = 'label-exceeds-cap';

export interface ClassificationDecision {
  ok: boolean;
  reason?: ClassificationDenialReason;
  message?: string;
  // The label and path that tripped the policy. Useful for both the
  // 403 body and the audit record so an operator can see exactly which
  // source blocked the share.
  blockedPath?: string;
  blockedLabel?: Label;
}

// Walk every cited source path, look up its effective label (explicit
// or workspace default), and refuse if any one of them exceeds the
// configured cap. Returns the first violation rather than all of them
// because the route only needs a single reason to 403.
export async function evaluateShare(
  dataDir: string,
  policy: ClassificationPolicy,
  sourcePaths: readonly string[],
): Promise<ClassificationDecision> {
  // "restricted" cap is the universal allow.
  if (policy.allowPublicShareUpTo === 'restricted') return { ok: true };
  const cap = RANK[policy.allowPublicShareUpTo];
  if (sourcePaths.length === 0) return { ok: true };
  const labels = await getLabelMapCached(dataDir);
  for (const raw of sourcePaths) {
    const path = normalizePath(raw);
    if (!path) continue;
    const effective: Label = labels[path] ?? policy.defaultLabel;
    if (RANK[effective] > cap) {
      return {
        ok: false,
        reason: 'label-exceeds-cap',
        message: `source "${path}" is labelled ${effective}; workspace allows sharing up to ${policy.allowPublicShareUpTo}`,
        blockedPath: path,
        blockedLabel: effective,
      };
    }
  }
  return { ok: true };
}

export function rankOf(label: Label): number {
  return RANK[label];
}
