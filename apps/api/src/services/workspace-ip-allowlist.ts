import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { normaliseRule, parseRule, ipInRule, MAX_RULES, MAX_LABEL, type IpRule } from './ip-allowlist.js';

// Workspace-wide IP allowlist.
//
// Distinct from the per-user IP allowlist (each member opts in to lock down
// their own session) and from the per-API-key allowlist (a key carries its
// own CIDR set). This one is owner-controlled, applies to EVERY
// authenticated request in the workspace, and is what an enterprise security
// team typically requires before signing: "no one can hit the API from
// outside our corporate egress range, period".
//
// Storage matches the per-workspace settings family (single JSON document,
// atomic rewrite). The file is the only source of truth; every request
// reads it once and matching is O(rules) with rules bounded to MAX_RULES.
//
// Safety: the routes/ip-allowlist-workspace endpoints themselves are NEVER
// gated by the enforcement plugin. An owner whose corporate VPN goes down
// must always be able to remove a rule from a browser that has fallen out
// of the allowlist; otherwise a typo would permanently lock the entire
// workspace out.

export interface WorkspaceIpAllowlistRecord {
  enabled: boolean;
  rules: IpRule[];
  updatedAt: number;
  createdAt: number;
  updatedBy: string | null;
}

const FILE = 'workspace-ip-allowlist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

function empty(): WorkspaceIpAllowlistRecord {
  const now = Date.now();
  return { enabled: false, rules: [], createdAt: now, updatedAt: now, updatedBy: null };
}

export async function getRecord(dataDir: string): Promise<WorkspaceIpAllowlistRecord> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const rec = parsed as Partial<WorkspaceIpAllowlistRecord>;
      return {
        enabled: Boolean(rec.enabled),
        rules: Array.isArray(rec.rules) ? (rec.rules as IpRule[]) : [],
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
  rules: Array<{ cidr: string; label?: string }>;
}

export interface ValidationError { ok: false; field: string; message: string }
export interface ValidationOk { ok: true; value: { enabled: boolean; rules: IpRule[] } }

export function validate(input: ReplaceInput, now: number = Date.now()): ValidationOk | ValidationError {
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, field: 'enabled', message: 'enabled must be boolean' };
  }
  if (!Array.isArray(input.rules)) {
    return { ok: false, field: 'rules', message: 'rules must be an array' };
  }
  if (input.rules.length > MAX_RULES) {
    return { ok: false, field: 'rules', message: `at most ${MAX_RULES} rules` };
  }
  if (input.enabled && input.rules.length === 0) {
    return { ok: false, field: 'rules', message: 'cannot enable an empty allowlist' };
  }
  const seen = new Set<string>();
  const out: IpRule[] = [];
  for (let i = 0; i < input.rules.length; i++) {
    const r = input.rules[i];
    if (!r || typeof r.cidr !== 'string') {
      return { ok: false, field: `rules[${i}].cidr`, message: 'cidr is required' };
    }
    const norm = normaliseRule(r.cidr);
    if (!norm) return { ok: false, field: `rules[${i}].cidr`, message: 'invalid cidr or ip' };
    if (seen.has(norm)) {
      return { ok: false, field: `rules[${i}].cidr`, message: `duplicate rule: ${norm}` };
    }
    seen.add(norm);
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL) : '';
    out.push({ cidr: norm, label, createdAt: now });
  }
  return { ok: true, value: { enabled: input.enabled, rules: out } };
}

export async function replaceRecord(
  dataDir: string,
  actorId: string,
  input: ReplaceInput,
): Promise<WorkspaceIpAllowlistRecord> {
  const v = validate(input);
  if (!v.ok) throw new Error(`${v.field}: ${v.message}`);
  const prev = await getRecord(dataDir);
  const next: WorkspaceIpAllowlistRecord = {
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

export function ipAllowedByWorkspace(ip: string, rec: WorkspaceIpAllowlistRecord): boolean {
  if (!rec.enabled) return true; // disabled = allow all (caller decides)
  if (rec.rules.length === 0) return false;
  for (const r of rec.rules) {
    const parsed = parseRule(r.cidr);
    if (parsed && ipInRule(ip, parsed)) return true;
  }
  return false;
}

export function diff(
  prev: WorkspaceIpAllowlistRecord,
  next: WorkspaceIpAllowlistRecord,
): { added: string[]; removed: string[]; toggled: boolean } {
  const a = new Set(prev.rules.map((r) => r.cidr));
  const b = new Set(next.rules.map((r) => r.cidr));
  const added: string[] = [];
  const removed: string[] = [];
  for (const c of b) if (!a.has(c)) added.push(c);
  for (const c of a) if (!b.has(c)) removed.push(c);
  return { added, removed, toggled: prev.enabled !== next.enabled };
}
