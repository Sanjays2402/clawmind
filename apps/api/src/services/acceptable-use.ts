import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export const MAX_TITLE = 200;
export const MAX_BODY = 64 * 1024;
export const MAX_VERSION = 64;
export const MAX_IP = 64;
export const MAX_USER_AGENT = 512;
export const MAX_ACCEPTANCES = 50_000;

const FILE = 'acceptable-use.json';

export interface Acceptance {
  userId: string;
  version: string;
  bodyHash: string;
  acceptedAt: number;
  ip: string | null;
  userAgent: string | null;
}

export interface AcceptableUsePolicy {
  version: string;
  title: string;
  body: string;
  requireAcceptance: boolean;
  publishedBy: string | null;
  publishedAt: number | null;
  bodyHash: string | null;
}

export interface AcceptableUseFile {
  version: 1;
  policy: AcceptableUsePolicy;
  acceptances: Acceptance[];
  updatedAt: number;
}

export class AcceptableUseValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'AcceptableUseValidationError';
  }
}

function emptyPolicy(): AcceptableUsePolicy {
  return {
    version: '',
    title: '',
    body: '',
    requireAcceptance: false,
    publishedBy: null,
    publishedAt: null,
    bodyHash: null,
  };
}

function emptyFile(now: number): AcceptableUseFile {
  return { version: 1, policy: emptyPolicy(), acceptances: [], updatedAt: now };
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

async function loadFile(dataDir: string): Promise<AcceptableUseFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as AcceptableUseFile;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.policy !== 'object' ||
      !Array.isArray(parsed.acceptances)
    ) {
      return emptyFile(Date.now());
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyFile(Date.now());
    }
    throw err;
  }
}

async function saveFile(dataDir: string, data: AcceptableUseFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, p);
}

export function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

function clipString(
  value: unknown,
  field: string,
  max: number,
  opts: { allowEmpty?: boolean } = {},
): string {
  if (typeof value !== 'string') {
    throw new AcceptableUseValidationError(field, `${field} must be a string`);
  }
  const trimmed = field === 'body' ? value : value.trim();
  if (!opts.allowEmpty && trimmed.length === 0) {
    throw new AcceptableUseValidationError(field, `${field} must not be empty`);
  }
  if (trimmed.length > max) {
    throw new AcceptableUseValidationError(field, `${field} must be <= ${max} characters`);
  }
  return trimmed;
}

function clipOptionalString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new AcceptableUseValidationError(field, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

let cached: { snapshot: AcceptableUsePolicy; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateAcceptableUseCache(): void {
  cached = null;
}

export async function getPolicy(dataDir: string): Promise<AcceptableUsePolicy> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.snapshot;
  const f = await loadFile(dataDir);
  cached = { snapshot: f.policy, expiresAt: now + CACHE_TTL_MS };
  return f.policy;
}

export interface PublishInput {
  version: string;
  title: string;
  body: string;
  requireAcceptance: boolean;
}

export async function publishPolicy(
  dataDir: string,
  actorUserId: string,
  input: PublishInput,
): Promise<AcceptableUsePolicy> {
  const version = clipString(input.version, 'version', MAX_VERSION);
  const title = clipString(input.title, 'title', MAX_TITLE);
  const body = clipString(input.body, 'body', MAX_BODY);
  if (typeof input.requireAcceptance !== 'boolean') {
    throw new AcceptableUseValidationError(
      'requireAcceptance',
      'requireAcceptance must be a boolean',
    );
  }
  const all = await loadFile(dataDir);
  const now = Date.now();
  const next: AcceptableUsePolicy = {
    version,
    title,
    body,
    requireAcceptance: input.requireAcceptance,
    publishedBy: actorUserId,
    publishedAt: now,
    bodyHash: hashBody(body),
  };
  await saveFile(dataDir, {
    version: 1,
    policy: next,
    acceptances: all.acceptances,
    updatedAt: now,
  });
  invalidateAcceptableUseCache();
  return next;
}

export interface AcceptInput {
  userId: string;
  version: string;
  bodyHash: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type AcceptResult =
  | { kind: 'ok'; acceptance: Acceptance }
  | { kind: 'version-mismatch'; currentVersion: string }
  | { kind: 'hash-mismatch'; currentBodyHash: string }
  | { kind: 'no-policy' };

export async function recordAcceptance(
  dataDir: string,
  input: AcceptInput,
): Promise<AcceptResult> {
  const userId = clipString(input.userId, 'userId', 200);
  const version = clipString(input.version, 'version', MAX_VERSION);
  const bodyHash = clipString(input.bodyHash, 'bodyHash', 128);
  const ip = clipOptionalString(input.ip ?? null, 'ip', MAX_IP);
  const userAgent = clipOptionalString(input.userAgent ?? null, 'userAgent', MAX_USER_AGENT);
  const all = await loadFile(dataDir);
  if (!all.policy.version || !all.policy.bodyHash) return { kind: 'no-policy' };
  if (all.policy.version !== version)
    return { kind: 'version-mismatch', currentVersion: all.policy.version };
  if (all.policy.bodyHash !== bodyHash)
    return { kind: 'hash-mismatch', currentBodyHash: all.policy.bodyHash };
  const now = Date.now();
  const acceptance: Acceptance = { userId, version, bodyHash, acceptedAt: now, ip, userAgent };
  const others = all.acceptances.filter(
    (a) => !(a.userId === userId && a.version === version),
  );
  const next = [...others, acceptance];
  const capped =
    next.length > MAX_ACCEPTANCES ? next.slice(next.length - MAX_ACCEPTANCES) : next;
  await saveFile(dataDir, {
    version: 1,
    policy: all.policy,
    acceptances: capped,
    updatedAt: now,
  });
  invalidateAcceptableUseCache();
  return { kind: 'ok', acceptance };
}

export async function hasUserAcceptedCurrent(
  dataDir: string,
  userId: string,
): Promise<boolean> {
  const all = await loadFile(dataDir);
  if (!all.policy.version) return true;
  return all.acceptances.some(
    (a) => a.userId === userId && a.version === all.policy.version,
  );
}

export async function listAcceptances(dataDir: string): Promise<Acceptance[]> {
  const all = await loadFile(dataDir);
  return [...all.acceptances].sort((a, b) => b.acceptedAt - a.acceptedAt);
}

const ACCEPT_ALLOWLIST_EXACT = new Set<string>([
  '/v1/acceptable-use',
  '/v1/acceptable-use/accept',
  '/v1/auth/logout',
  '/v1/sessions/logout',
]);

const ACCEPT_ALLOWLIST_PREFIXES: readonly string[] = [
  '/v1/auth/',
  '/v1/mfa/',
  '/v1/sessions/',
  '/v1/me/data/export',
];

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isAcceptableUseAllowedPath(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const path = url.split('?')[0] ?? url;
  if (ACCEPT_ALLOWLIST_EXACT.has(path)) return true;
  for (const prefix of ACCEPT_ALLOWLIST_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}
