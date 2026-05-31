import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { isIP } from 'node:net';

// Per-user IP allowlist. When enabled, only requests from a listed IPv4 /
// IPv6 address or CIDR block are allowed to reach the API for that user
// (covers both session cookie and Bearer API key auth). When disabled, the
// list is ignored and the user is accessible from anywhere, preserving the
// current behaviour for everyone who has not opted in.
//
// Persisted at <dataDir>/ip-allowlist.json as a single JSON map keyed by
// userId, in the same atomic-rewrite style as profiles / onboarding /
// notification-prefs. The file is the only source of truth: there is no
// in-memory cache, because every request reads it once and matchers are
// O(rules) where rules is bounded to MAX_RULES.
//
// Procurement / security-team angle: an enterprise buyer typically demands
// that the dashboard and the API can be locked down to the corporate egress
// IP range before they will sign. This module is the storage + matching
// engine; the Fastify plugin in plugins/ip-allowlist.ts is the enforcement
// point.

export const MAX_RULES = 64;
export const MAX_LABEL = 80;

export interface IpRule {
  // Either a bare IP ("203.0.113.7", "2001:db8::1") or a CIDR
  // ("203.0.113.0/24", "2001:db8::/32"). Always stored normalised:
  // lower-case, no surrounding whitespace, no leading zeros in v4 octets.
  cidr: string;
  label: string;
  createdAt: number;
}

export interface IpAllowlistRecord {
  userId: string;
  enabled: boolean;
  rules: IpRule[];
  updatedAt: number;
  createdAt: number;
}

export type IpAllowlistMap = Record<string, IpAllowlistRecord>;

const FILE = 'ip-allowlist.json';

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

export async function loadAll(dataDir: string): Promise<IpAllowlistMap> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as IpAllowlistMap;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

async function saveAll(dataDir: string, map: IpAllowlistMap): Promise<void> {
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(map, null, 2), 'utf8');
}

function empty(userId: string): IpAllowlistRecord {
  const now = Date.now();
  return { userId, enabled: false, rules: [], createdAt: now, updatedAt: now };
}

export async function getRecord(
  dataDir: string,
  userId: string,
): Promise<IpAllowlistRecord> {
  const map = await loadAll(dataDir);
  return map[userId] ?? empty(userId);
}

// --- Parsing & normalisation -------------------------------------------------

export interface ParsedRule {
  family: 4 | 6;
  bits: bigint; // network address, masked
  prefix: number; // number of leading 1-bits in the mask
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v < 0 || v > 255) return null;
    if (p.length > 1 && p.startsWith('0')) return null; // no leading zeros
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // node:net.isIP already validated structure; expand "::" then parse.
  let head = ip;
  let tail = '';
  const dbl = ip.indexOf('::');
  if (dbl >= 0) {
    head = ip.slice(0, dbl);
    tail = ip.slice(dbl + 2);
  }
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

export function parseRule(raw: string): ParsedRule | null {
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const slash = s.indexOf('/');
  const ip = slash >= 0 ? s.slice(0, slash) : s;
  const prefixStr = slash >= 0 ? s.slice(slash + 1) : null;
  const family = isIP(ip);
  if (family !== 4 && family !== 6) return null;
  const max = family === 4 ? 32 : 128;
  let prefix = max;
  if (prefixStr !== null) {
    if (!/^\d{1,3}$/.test(prefixStr)) return null;
    prefix = Number(prefixStr);
    if (prefix < 0 || prefix > max) return null;
  }
  const bits = family === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
  if (bits === null) return null;
  // Mask to network boundary so 10.0.0.5/24 stores as 10.0.0.0/24.
  const shift = BigInt(max - prefix);
  const masked = prefix === 0 ? 0n : (bits >> shift) << shift;
  return { family, bits: masked, prefix };
}

export function normaliseRule(raw: string): string | null {
  const p = parseRule(raw);
  if (!p) return null;
  if (p.family === 4) {
    const b = p.bits;
    const a = [
      Number((b >> 24n) & 0xffn),
      Number((b >> 16n) & 0xffn),
      Number((b >> 8n) & 0xffn),
      Number(b & 0xffn),
    ].join('.');
    return p.prefix === 32 ? a : `${a}/${p.prefix}`;
  }
  // Compact v6: emit 8 groups, then collapse the longest run of zero groups.
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((p.bits >> BigInt(i * 16)) & 0xffffn).toString(16));
  }
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === '0') {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  let ip: string;
  if (bestLen >= 2) {
    const left = groups.slice(0, bestStart).join(':');
    const right = groups.slice(bestStart + bestLen).join(':');
    ip = `${left}::${right}`;
  } else {
    ip = groups.join(':');
  }
  return p.prefix === 128 ? ip : `${ip}/${p.prefix}`;
}

// --- Matching ----------------------------------------------------------------

export function ipInRule(ip: string, rule: ParsedRule): boolean {
  const family = isIP(ip);
  if (family !== rule.family) return false;
  const bits = family === 4 ? ipv4ToBigInt(ip) : ipv6ToBigInt(ip);
  if (bits === null) return false;
  const max = family === 4 ? 32 : 128;
  if (rule.prefix === 0) return true;
  const shift = BigInt(max - rule.prefix);
  return (bits >> shift) === (rule.bits >> shift);
}

export function ipAllowed(
  ip: string,
  rules: readonly { cidr: string }[],
): boolean {
  if (rules.length === 0) return false;
  for (const r of rules) {
    const parsed = parseRule(r.cidr);
    if (parsed && ipInRule(ip, parsed)) return true;
  }
  return false;
}

// --- Mutations ---------------------------------------------------------------

export interface ReplaceInput {
  enabled: boolean;
  rules: Array<{ cidr: string; label?: string }>;
}

export interface ValidationError {
  ok: false;
  field: string;
  message: string;
}

export interface ValidationOk {
  ok: true;
  value: { enabled: boolean; rules: IpRule[] };
}

export function validate(
  input: ReplaceInput,
  now: number = Date.now(),
): ValidationOk | ValidationError {
  if (typeof input.enabled !== 'boolean') {
    return { ok: false, field: 'enabled', message: 'enabled must be boolean' };
  }
  if (!Array.isArray(input.rules)) {
    return { ok: false, field: 'rules', message: 'rules must be an array' };
  }
  if (input.rules.length > MAX_RULES) {
    return { ok: false, field: 'rules', message: `at most ${MAX_RULES} rules` };
  }
  const seen = new Set<string>();
  const out: IpRule[] = [];
  for (let i = 0; i < input.rules.length; i++) {
    const r = input.rules[i];
    if (!r || typeof r.cidr !== 'string') {
      return { ok: false, field: `rules[${i}].cidr`, message: 'cidr is required' };
    }
    const norm = normaliseRule(r.cidr);
    if (!norm) {
      return { ok: false, field: `rules[${i}].cidr`, message: `invalid IP or CIDR: ${r.cidr}` };
    }
    if (seen.has(norm)) {
      return { ok: false, field: `rules[${i}].cidr`, message: `duplicate rule: ${norm}` };
    }
    seen.add(norm);
    const label = (r.label ?? '').toString().trim();
    if (label.length > MAX_LABEL) {
      return { ok: false, field: `rules[${i}].label`, message: `label too long (max ${MAX_LABEL})` };
    }
    out.push({ cidr: norm, label, createdAt: now });
  }
  if (input.enabled && out.length === 0) {
    return { ok: false, field: 'rules', message: 'cannot enable an empty allowlist' };
  }
  return { ok: true, value: { enabled: input.enabled, rules: out } };
}

export async function replaceRecord(
  dataDir: string,
  userId: string,
  input: ReplaceInput,
): Promise<IpAllowlistRecord> {
  const check = validate(input);
  if (!check.ok) {
    const err = new Error(check.message) as Error & { field?: string };
    err.field = check.field;
    throw err;
  }
  const map = await loadAll(dataDir);
  const prev = map[userId] ?? empty(userId);
  // Preserve the original createdAt timestamp for each rule when the same
  // CIDR is resubmitted, so the audit story shows "first added at" not
  // "last edited at".
  const carry = new Map(prev.rules.map((r) => [r.cidr, r.createdAt]));
  const merged: IpRule[] = check.value.rules.map((r) => ({
    ...r,
    createdAt: carry.get(r.cidr) ?? r.createdAt,
  }));
  const next: IpAllowlistRecord = {
    userId,
    enabled: check.value.enabled,
    rules: merged,
    createdAt: prev.createdAt,
    updatedAt: Date.now(),
  };
  map[userId] = next;
  await saveAll(dataDir, map);
  return next;
}

// Diff helper for audit log meta.
export function diff(
  prev: IpAllowlistRecord,
  next: IpAllowlistRecord,
): { enabled: { from: boolean; to: boolean } | null; added: string[]; removed: string[] } {
  const before = new Set(prev.rules.map((r) => r.cidr));
  const after = new Set(next.rules.map((r) => r.cidr));
  const added: string[] = [];
  const removed: string[] = [];
  for (const c of after) if (!before.has(c)) added.push(c);
  for (const c of before) if (!after.has(c)) removed.push(c);
  return {
    enabled: prev.enabled === next.enabled ? null : { from: prev.enabled, to: next.enabled },
    added,
    removed,
  };
}
