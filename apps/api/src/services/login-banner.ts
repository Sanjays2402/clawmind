import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

// Pre-authentication system-use notification banner (NIST SP 800-53 AC-8).
//
// FedRAMP, FISMA, FFIEC, and many regulated-finance procurement teams
// require a "system use notification" presented before access is
// granted, and a record that the user acknowledged it. Without one,
// US government and large bank customers cannot sign. ClawMind already
// covers contractual TOS/DPA/AUP acceptance (services/policies.ts);
// this control is distinct and operationally narrower:
//
//   * The banner is short, written by the OWNER, and presented at the
//     login screen BEFORE credentials are entered (public read).
//   * After successful sign-in the user must acknowledge the banner
//     once per session before any mutating request is accepted. The
//     ack is bound to the session id and the body hash, so a banner
//     change forces a fresh ack on the next request.
//   * Acks are kept in a bounded ledger with ip, userAgent, sessionId
//     hash, ts, and bodyHash so an auditor can prove what a specific
//     user saw and clicked on a given date.
//
// On-disk layout: <dataDir>/login-banner.json. Atomic rewrite via
// tmp+rename matching the rest of the data layer. Body is bounded so
// a malicious owner cannot wedge the file with multi-MB payloads.

export const MAX_TITLE = 200;
export const MAX_BODY = 16 * 1024; // 16KB - banners are short by spec
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const MAX_ACKS = 50_000;
const ACK_PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const FILE = 'login-banner.json';

export interface LoginBanner {
  enabled: boolean;
  title: string;
  body: string;
  severity: Severity;
  requireAck: boolean;
  bodyHash: string | null;
  publishedBy: string | null;
  publishedAt: number | null;
  updatedAt: number;
}

export interface BannerAck {
  userId: string;
  sessionIdHash: string; // sha256(sessionId) so the raw sid never lands on disk
  bodyHash: string;
  ackedAt: number;
  ip: string | null;
  userAgent: string | null;
}

export interface BannerFile {
  version: 1;
  banner: LoginBanner;
  acks: BannerAck[];
}

export class LoginBannerValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'LoginBannerValidationError';
  }
}

function emptyBanner(now: number): LoginBanner {
  return {
    enabled: false,
    title: '',
    body: '',
    severity: 'info',
    requireAck: false,
    bodyHash: null,
    publishedBy: null,
    publishedAt: null,
    updatedAt: now,
  };
}

function emptyFile(now: number): BannerFile {
  return { version: 1, banner: emptyBanner(now), acks: [] };
}

function file(dataDir: string): string {
  return join(dataDir, FILE);
}

async function loadFile(dataDir: string): Promise<BannerFile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as BannerFile;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.banner !== 'object' ||
      !Array.isArray(parsed.acks)
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

async function saveFile(dataDir: string, data: BannerFile): Promise<void> {
  const p = file(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, p);
}

export function hashBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

export function hashSession(sessionId: string): string {
  return createHash('sha256').update(sessionId, 'utf8').digest('hex');
}

function clipString(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') {
    throw new LoginBannerValidationError(field, `${field} must be a string`);
  }
  const trimmed = field === 'body' ? value : value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new LoginBannerValidationError(field, `${field} must not be empty`);
  }
  if (trimmed.length > max) {
    throw new LoginBannerValidationError(field, `${field} must be <= ${max} characters`);
  }
  return trimmed;
}

function clipOptional(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new LoginBannerValidationError(field, `${field} must be a string or null`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// In-process cache for the gate's hot path. The gate fires on every
// mutating session request, so we cache the banner snapshot for a
// small window. Invalidated on every mutation in this module.
let cached: { banner: LoginBanner; expiresAt: number } | null = null;
const CACHE_TTL_MS = 1000;

export function invalidateLoginBannerCache(): void {
  cached = null;
}

export async function getBanner(dataDir: string): Promise<LoginBanner> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.banner;
  const f = await loadFile(dataDir);
  cached = { banner: f.banner, expiresAt: now + CACHE_TTL_MS };
  return f.banner;
}

export interface PublishInput {
  enabled: boolean;
  title: string;
  body: string;
  severity: Severity;
  requireAck: boolean;
}

export async function publishBanner(
  dataDir: string,
  actorUserId: string,
  input: PublishInput,
): Promise<LoginBanner> {
  if (typeof input.enabled !== 'boolean') {
    throw new LoginBannerValidationError('enabled', 'enabled must be a boolean');
  }
  if (typeof input.requireAck !== 'boolean') {
    throw new LoginBannerValidationError('requireAck', 'requireAck must be a boolean');
  }
  if (!SEVERITIES.includes(input.severity)) {
    throw new LoginBannerValidationError(
      'severity',
      `severity must be one of ${SEVERITIES.join(', ')}`,
    );
  }
  const title = clipString(input.title, 'title', MAX_TITLE);
  const body = clipString(input.body, 'body', MAX_BODY);
  const all = await loadFile(dataDir);
  const now = Date.now();
  const next: LoginBanner = {
    enabled: input.enabled,
    title,
    body,
    severity: input.severity,
    requireAck: input.requireAck,
    bodyHash: hashBody(body),
    publishedBy: actorUserId,
    publishedAt: now,
    updatedAt: now,
  };
  await saveFile(dataDir, { version: 1, banner: next, acks: all.acks });
  invalidateLoginBannerCache();
  return next;
}

export async function disableBanner(
  dataDir: string,
  actorUserId: string,
): Promise<LoginBanner> {
  const all = await loadFile(dataDir);
  const now = Date.now();
  const next: LoginBanner = {
    ...all.banner,
    enabled: false,
    requireAck: false,
    publishedBy: actorUserId,
    publishedAt: all.banner.publishedAt ?? null,
    updatedAt: now,
  };
  await saveFile(dataDir, { version: 1, banner: next, acks: all.acks });
  invalidateLoginBannerCache();
  return next;
}

export interface AckInput {
  userId: string;
  sessionId: string;
  bodyHash: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type AckResult =
  | { kind: 'ok'; ack: BannerAck }
  | { kind: 'no-banner' }
  | { kind: 'hash-mismatch'; currentBodyHash: string };

export async function recordAck(
  dataDir: string,
  input: AckInput,
): Promise<AckResult> {
  const userId = clipString(input.userId, 'userId', 200);
  const sessionId = clipString(input.sessionId, 'sessionId', 256);
  const bodyHash = clipString(input.bodyHash, 'bodyHash', 128);
  const ip = clipOptional(input.ip ?? null, 'ip', 64);
  const userAgent = clipOptional(input.userAgent ?? null, 'userAgent', 512);
  const all = await loadFile(dataDir);
  if (!all.banner.enabled || !all.banner.bodyHash) {
    return { kind: 'no-banner' };
  }
  if (all.banner.bodyHash !== bodyHash) {
    return { kind: 'hash-mismatch', currentBodyHash: all.banner.bodyHash };
  }
  const sidHash = hashSession(sessionId);
  const now = Date.now();
  const ack: BannerAck = {
    userId,
    sessionIdHash: sidHash,
    bodyHash,
    ackedAt: now,
    ip,
    userAgent,
  };
  // De-duplicate (sessionIdHash, bodyHash): one ack per session per banner.
  const others = all.acks.filter(
    (a) => !(a.sessionIdHash === sidHash && a.bodyHash === bodyHash),
  );
  // Prune very old acks while we're rewriting the file.
  const cutoff = now - ACK_PRUNE_AGE_MS;
  const pruned = others.filter((a) => a.ackedAt >= cutoff);
  const next = [...pruned, ack];
  const capped = next.length > MAX_ACKS ? next.slice(next.length - MAX_ACKS) : next;
  await saveFile(dataDir, { version: 1, banner: all.banner, acks: capped });
  invalidateLoginBannerCache();
  return { kind: 'ok', ack };
}

export async function hasSessionAcked(
  dataDir: string,
  sessionId: string,
  bodyHash: string,
): Promise<boolean> {
  const all = await loadFile(dataDir);
  const sidHash = hashSession(sessionId);
  return all.acks.some(
    (a) => a.sessionIdHash === sidHash && a.bodyHash === bodyHash,
  );
}

export async function listAcks(dataDir: string): Promise<BannerAck[]> {
  const all = await loadFile(dataDir);
  return [...all.acks].sort((a, b) => b.ackedAt - a.ackedAt);
}

// Paths that remain reachable when an enforcing banner is pending.
const ALLOWLIST_EXACT = new Set<string>([
  '/v1/login-banner',
  '/v1/login-banner/ack',
  '/v1/auth/logout',
]);
const ALLOWLIST_PREFIXES: readonly string[] = [
  '/v1/auth/',
  '/v1/mfa/',
  '/v1/sessions/',
];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isLoginBannerAllowedPath(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const path = url.split('?')[0] ?? url;
  if (ALLOWLIST_EXACT.has(path)) return true;
  for (const prefix of ALLOWLIST_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}
