import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// Workspace data residency policy.
//
// Every enterprise procurement questionnaire from an EU, UK, or Canadian
// buyer asks the same question: "Where does my data live, and can my
// workspace owner refuse to be served from any other region?" This file
// is the workspace-side switch that answers it without code changes
// per deployment.
//
// How it composes with the runtime:
//
//   * The server announces a single canonical region for this process
//     via CLAWMIND_REGION (read at startup, surfaced on every response
//     as `x-clawmind-region`). One process serves one region; multi
//     region tenants run multiple processes, each pinned.
//   * The workspace policy declares which regions an authenticated
//     mutating request is allowed to land in. An empty allow-list means
//     "no restriction" (back-compat default).
//   * The plugin enforces the policy on writes and surfaces 451 with a
//     structured payload so a customer SDK can route the retry to a
//     compliant region without parsing free text.
//
// Persisted at <dataDir>/data-residency.json, atomic tmp+rename, same
// layout convention as session-policy, mfa-policy, workspace-freeze.

const FILE = 'data-residency.json';
const DEFAULT_WORKSPACE = 'default';

// Canonical region tokens. Keep this list closed so a typo cannot
// silently widen the allowlist (e.g. "EU " with a trailing space would
// match nothing the plugin can compare against). New regions are
// additive code changes audited the same way any other compliance
// surface is audited.
export const KNOWN_REGIONS = Object.freeze([
  'us', // United States
  'eu', // European Union (any member state)
  'uk', // United Kingdom
  'ca', // Canada
  'au', // Australia
  'ap', // Asia-Pacific (catch-all for jurisdictions without a dedicated bucket)
  'other',
] as const);

export type Region = (typeof KNOWN_REGIONS)[number];

export interface ResidencyPolicy {
  workspaceId: string;
  // Empty array = no restriction. Otherwise, the server's current
  // region must be in this list for any mutation to proceed.
  allowedRegions: Region[];
  // Free-text data-controller hint surfaced on the admin page and in
  // the GET response so a customer DPA / DPIA can quote a stable value
  // without having to scrape the UI.
  controller: string;
  updatedAt: number;
  updatedBy: string | null;
}

interface ResidencyFile {
  version: 1;
  policies: ResidencyPolicy[];
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function emptyPolicy(workspaceId: string, now: number): ResidencyPolicy {
  return {
    workspaceId,
    allowedRegions: [],
    controller: '',
    updatedAt: now,
    updatedBy: null,
  };
}

async function loadAll(dataDir: string): Promise<ResidencyFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as ResidencyFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.policies)) {
      return { version: 1, policies: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, policies: [] };
    }
    throw err;
  }
}

async function saveAll(dataDir: string, all: ResidencyFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2), 'utf8');
  await rename(tmp, p);
}

export class ResidencyValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ResidencyValidationError';
  }
}

export function isKnownRegion(value: string): value is Region {
  return (KNOWN_REGIONS as readonly string[]).includes(value);
}

// Resolve the canonical region this process is pinned to. Reads at call
// time so tests can override CLAWMIND_REGION between cases without
// reloading the env module. Unknown / empty values fall back to 'us' so
// a misconfigured deployment behaves like the documented default rather
// than silently disabling the check.
export function currentServerRegion(): Region {
  const raw = (process.env.CLAWMIND_REGION ?? '').trim().toLowerCase();
  if (raw && isKnownRegion(raw)) return raw;
  return 'us';
}

export async function getPolicy(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ResidencyPolicy> {
  const all = await loadAll(dataDir);
  return (
    all.policies.find((p) => p.workspaceId === workspaceId)
    ?? emptyPolicy(workspaceId, Date.now())
  );
}

export interface UpdateInput {
  allowedRegions?: string[];
  controller?: string;
}

export async function setPolicy(
  dataDir: string,
  actorUserId: string,
  input: UpdateInput,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ResidencyPolicy> {
  const allowedRegions = normRegions(input.allowedRegions);
  const controller = normController(input.controller);
  const all = await loadAll(dataDir);
  const next: ResidencyPolicy = {
    workspaceId,
    allowedRegions,
    controller,
    updatedAt: Date.now(),
    updatedBy: actorUserId,
  };
  const others = all.policies.filter((p) => p.workspaceId !== workspaceId);
  await saveAll(dataDir, { version: 1, policies: [...others, next] });
  invalidateCache();
  return next;
}

function normRegions(value: unknown): Region[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ResidencyValidationError('allowedRegions', 'allowedRegions must be an array');
  }
  const seen = new Set<Region>();
  for (const raw of value) {
    if (typeof raw !== 'string') {
      throw new ResidencyValidationError('allowedRegions', 'allowedRegions entries must be strings');
    }
    const norm = raw.trim().toLowerCase();
    if (!isKnownRegion(norm)) {
      throw new ResidencyValidationError(
        'allowedRegions',
        `unknown region "${raw}". Known regions: ${KNOWN_REGIONS.join(', ')}`,
      );
    }
    seen.add(norm);
  }
  // Stable, KNOWN_REGIONS order so the on-disk file does not flap when
  // the operator submits the same set in a different order.
  return KNOWN_REGIONS.filter((r) => seen.has(r));
}

function normController(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new ResidencyValidationError('controller', 'controller must be a string');
  }
  const trimmed = value.trim();
  if (trimmed.length > 200) {
    throw new ResidencyValidationError('controller', 'controller must be 200 characters or fewer');
  }
  return trimmed;
}

// 1s TTL cache matches workspace-freeze / session-policy. The plugin
// preHandler runs on every mutating request, so disk reads need to be
// amortised but a policy flip in one tab must show up in another within
// a second.
let cached: { policy: ResidencyPolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateCache(): void {
  cached = null;
}

export async function getPolicyCached(
  dataDir: string,
  workspaceId: string = DEFAULT_WORKSPACE,
): Promise<ResidencyPolicy> {
  const now = Date.now();
  if (cached && cached.policy.workspaceId === workspaceId && cached.expiresAt > now) {
    return cached.policy;
  }
  const policy = await getPolicy(dataDir, workspaceId);
  cached = { policy, expiresAt: now + CACHE_TTL_MS };
  return policy;
}

export type EvalResult =
  | { ok: true }
  | { ok: false; reason: 'region-not-allowed'; serverRegion: Region; allowedRegions: Region[] };

// Pure evaluator. The plugin passes the workspace policy and the
// resolved server region; this returns whether a mutation may proceed.
// Empty allow-list returns ok so workspaces who have not opted in keep
// the legacy behaviour. Reads are never evaluated here; the plugin
// scopes itself to mutating methods.
export function evaluate(policy: ResidencyPolicy, serverRegion: Region): EvalResult {
  if (policy.allowedRegions.length === 0) return { ok: true };
  if (policy.allowedRegions.includes(serverRegion)) return { ok: true };
  return {
    ok: false,
    reason: 'region-not-allowed',
    serverRegion,
    allowedRegions: [...policy.allowedRegions],
  };
}
