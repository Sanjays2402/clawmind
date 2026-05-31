import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { normaliseOrigin } from './api-keys.js';

// Workspace-wide browser Origin allowlist for CORS.
//
// The static CLAWMIND_API_CORS_ORIGIN env var sets a baseline (typically the
// vendor-hosted dashboard). Enterprise customers who embed ClawMind in their
// own portal at, say, app.acme.com need to add that origin themselves rather
// than open a support ticket to flip an env var. This service is the
// owner-controlled source of truth for those additional origins.
//
// Distinct from the per-API-key origin allowlist: that one restricts which
// page may USE a given key. This one restricts which browsers the API will
// even talk to (CORS preflight), regardless of which key the page presents.
//
// Storage matches the workspace-ip-allowlist family: single JSON document,
// atomic rewrite, validated on the way in. The management routes themselves
// are unaffected by the allowlist (the dashboard origin is permitted via the
// static env var) so an owner cannot lock themselves out by saving an empty
// list.

export const MAX_ORIGIN_RULES = 64;
export const MAX_LABEL = 64;

export interface OriginRule {
  origin: string;
  label: string;
  createdAt: number;
}

export interface WorkspaceOriginAllowlistRecord {
  enabled: boolean;
  rules: OriginRule[];
  updatedAt: number;
  createdAt: number;
  updatedBy: string | null;
}

const FILE = 'workspace-origin-allowlist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(): WorkspaceOriginAllowlistRecord {
  const now = Date.now();
  return { enabled: false, rules: [], createdAt: now, updatedAt: now, updatedBy: null };
}

export async function getRecord(dataDir: string): Promise<WorkspaceOriginAllowlistRecord> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Partial<WorkspaceOriginAllowlistRecord>;
      return {
        enabled: Boolean(rec.enabled),
        rules: Array.isArray(rec.rules) ? (rec.rules as OriginRule[]) : [],
        createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
        updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
        updatedBy: typeof rec.updatedBy === 'string' ? rec.updatedBy : null,
      };
    }
    return empty();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw err;
  }
}

export interface ReplaceInput {
  enabled: boolean;
  rules: Array<{ origin: string; label?: string }>;
}

export interface ValidationError { ok: false; field: string; message: string }
export interface ValidationOk { ok: true; value: { enabled: boolean; rules: OriginRule[] } }

export function validate(input: ReplaceInput, now: number = Date.now()): ValidationOk | ValidationError {
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, field: 'enabled', message: 'enabled must be boolean' };
  }
  if (!Array.isArray(input.rules)) {
    return { ok: false, field: 'rules', message: 'rules must be an array' };
  }
  if (input.rules.length > MAX_ORIGIN_RULES) {
    return { ok: false, field: 'rules', message: `at most ${MAX_ORIGIN_RULES} rules` };
  }
  if (input.enabled && input.rules.length === 0) {
    return { ok: false, field: 'rules', message: 'cannot enable an empty allowlist' };
  }
  const seen = new Set<string>();
  const out: OriginRule[] = [];
  for (let i = 0; i < input.rules.length; i++) {
    const r = input.rules[i];
    if (!r || typeof r.origin !== 'string') {
      return { ok: false, field: `rules[${i}].origin`, message: 'origin is required' };
    }
    const norm = normaliseOrigin(r.origin);
    if (!norm) {
      return {
        ok: false,
        field: `rules[${i}].origin`,
        message: 'invalid origin (expected http(s)://host[:port], no path)',
      };
    }
    if (seen.has(norm)) {
      return { ok: false, field: `rules[${i}].origin`, message: `duplicate origin: ${norm}` };
    }
    seen.add(norm);
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL) : '';
    out.push({ origin: norm, label, createdAt: now });
  }
  return { ok: true, value: { enabled: input.enabled, rules: out } };
}

export async function replaceRecord(
  dataDir: string,
  actorId: string,
  input: ReplaceInput,
): Promise<WorkspaceOriginAllowlistRecord> {
  const v = validate(input);
  if (!v.ok) {
    const e = new Error(`${v.field}: ${v.message}`) as Error & { field?: string };
    e.field = v.field;
    throw e;
  }
  const prev = await getRecord(dataDir);
  const next: WorkspaceOriginAllowlistRecord = {
    enabled: v.value.enabled,
    rules: v.value.rules,
    createdAt: prev.createdAt,
    updatedAt: Date.now(),
    updatedBy: actorId,
  };
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/**
 * Test whether a browser Origin header value is permitted by the workspace
 * allowlist. Server-to-server requests (no Origin header) are always
 * accepted because CORS only matters to browsers; the static baseline
 * supplied to @fastify/cors covers the vendor dashboard so it does not
 * need to be repeated here.
 *
 * Returns true when:
 *   - the allowlist is disabled (the static baseline alone is in effect)
 *   - the origin matches one of the configured rules exactly
 */
export function originAllowedByWorkspace(
  origin: string | null | undefined,
  rec: WorkspaceOriginAllowlistRecord,
): boolean {
  if (!rec.enabled) return false; // not handled here when disabled
  if (!origin) return false;
  const norm = normaliseOrigin(origin);
  if (!norm) return false;
  for (const r of rec.rules) if (r.origin === norm) return true;
  return false;
}

export function diff(
  prev: WorkspaceOriginAllowlistRecord,
  next: WorkspaceOriginAllowlistRecord,
): { added: string[]; removed: string[]; toggled: boolean } {
  const a = new Set(prev.rules.map((r) => r.origin));
  const b = new Set(next.rules.map((r) => r.origin));
  const added: string[] = [];
  const removed: string[] = [];
  for (const o of b) if (!a.has(o)) added.push(o);
  for (const o of a) if (!b.has(o)) removed.push(o);
  return { added, removed, toggled: prev.enabled !== next.enabled };
}
