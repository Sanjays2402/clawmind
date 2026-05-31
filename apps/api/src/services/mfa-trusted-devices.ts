import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Trusted devices let a user skip TOTP step-up on a recognised browser for
// a bounded window (default 14 days). Each trust is:
//   * scoped to a single user (cookie carries userId.rawToken)
//   * stored as sha256(rawToken) only, so a leaked file does not equal a
//     usable cookie (mirrors how recovery codes are stored in mfa.ts)
//   * revocable individually or in bulk
//   * audit-logged on mint and revoke
//   * automatically purged on MFA disable
// API-key callers are not affected: this only runs on session callers
// gated by requireMfa, which already short-circuits API keys.

export const TRUSTED_DEVICE_COOKIE = 'cm_mfa_td';
export const DEFAULT_TRUST_DAYS = 14;
export const MAX_TRUST_DAYS = 30;
export const MAX_DEVICES_PER_USER = 20;

export interface TrustedDeviceRecord {
  id: string;
  hash: string; // sha256(rawToken), hex
  label: string;
  ip: string;
  userAgent: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface TrustedDeviceFile {
  version: 1;
  userId: string;
  devices: TrustedDeviceRecord[];
}

function fileFor(dir: string, userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  return join(dir, 'mfa', 'trusted', `${safe}.json`);
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, 'utf8');
  await rename(tmp, path);
}

export async function loadDevices(dir: string, userId: string): Promise<TrustedDeviceRecord[]> {
  try {
    const buf = await readFile(fileFor(dir, userId), 'utf8');
    const parsed = JSON.parse(buf) as TrustedDeviceFile;
    if (!parsed?.devices || parsed.version !== 1) return [];
    return parsed.devices;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveDevices(dir: string, userId: string, devices: TrustedDeviceRecord[]): Promise<void> {
  if (devices.length === 0) {
    try {
      await unlink(fileFor(dir, userId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return;
  }
  const file: TrustedDeviceFile = { version: 1, userId, devices };
  await atomicWrite(fileFor(dir, userId), JSON.stringify(file, null, 2));
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function constantTimeEqHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function newId(): string {
  return `td_${randomBytes(8).toString('hex')}`;
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url');
}

function clampDays(days: number | undefined): number {
  const d = Number.isFinite(days as number) ? Math.floor(days as number) : DEFAULT_TRUST_DAYS;
  if (d < 1) return 1;
  if (d > MAX_TRUST_DAYS) return MAX_TRUST_DAYS;
  return d;
}

export function publicView(d: TrustedDeviceRecord) {
  return {
    id: d.id,
    label: d.label,
    ip: d.ip,
    userAgent: d.userAgent,
    createdAt: d.createdAt,
    lastSeenAt: d.lastSeenAt,
    expiresAt: d.expiresAt,
  };
}

// Mint a new trusted-device token, append the record, and return the cookie
// value the caller must set on the response. We purge expired entries and
// cap the per-user device count so a long-running session cannot grow the
// file without bound.
export async function mintDevice(
  dir: string,
  userId: string,
  opts: {
    label?: string;
    ip: string;
    userAgent: string;
    trustDays?: number;
  },
): Promise<{ id: string; cookieValue: string; record: TrustedDeviceRecord }> {
  const now = Date.now();
  const days = clampDays(opts.trustDays);
  const raw = newRawToken();
  const id = newId();
  const record: TrustedDeviceRecord = {
    id,
    hash: hashToken(raw),
    label: (opts.label ?? '').trim().slice(0, 80) || deriveLabel(opts.userAgent),
    ip: opts.ip || '',
    userAgent: (opts.userAgent || '').slice(0, 240),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + days * 86400_000,
  };
  const existing = (await loadDevices(dir, userId)).filter((d) => d.expiresAt > now);
  existing.push(record);
  // Cap: keep newest MAX_DEVICES_PER_USER.
  const trimmed = existing.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_DEVICES_PER_USER);
  await saveDevices(dir, userId, trimmed);
  return { id, cookieValue: `${userId}.${raw}`, record };
}

// Validate an incoming cookie. Returns the matched device (and updates its
// lastSeenAt) or null. Expired records are pruned as a side effect so the
// disk file stays bounded.
export async function verifyCookie(
  dir: string,
  cookieValue: string | undefined,
  opts: { ip?: string } = {},
): Promise<{ userId: string; device: TrustedDeviceRecord } | null> {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const userId = cookieValue.slice(0, dot);
  const raw = cookieValue.slice(dot + 1);
  if (!userId || !raw) return null;
  const incomingHash = hashToken(raw);
  const now = Date.now();
  const devices = await loadDevices(dir, userId);
  let matched: TrustedDeviceRecord | null = null;
  const kept: TrustedDeviceRecord[] = [];
  for (const d of devices) {
    if (d.expiresAt <= now) continue; // prune
    if (!matched && constantTimeEqHex(d.hash, incomingHash)) {
      matched = { ...d, lastSeenAt: now, ip: opts.ip || d.ip };
      kept.push(matched);
    } else {
      kept.push(d);
    }
  }
  if (kept.length !== devices.length || matched) {
    await saveDevices(dir, userId, kept);
  }
  if (!matched) return null;
  return { userId, device: matched };
}

export async function revokeDevice(
  dir: string,
  userId: string,
  deviceId: string,
): Promise<TrustedDeviceRecord | null> {
  const devices = await loadDevices(dir, userId);
  const idx = devices.findIndex((d) => d.id === deviceId);
  if (idx < 0) return null;
  const [removed] = devices.splice(idx, 1);
  if (!removed) return null;
  await saveDevices(dir, userId, devices);
  return removed;
}

export async function revokeAll(dir: string, userId: string): Promise<number> {
  const devices = await loadDevices(dir, userId);
  await saveDevices(dir, userId, []);
  return devices.length;
}

export async function listDevices(dir: string, userId: string) {
  const now = Date.now();
  const devices = (await loadDevices(dir, userId)).filter((d) => d.expiresAt > now);
  return devices.sort((a, b) => b.lastSeenAt - a.lastSeenAt).map(publicView);
}

function deriveLabel(ua: string): string {
  if (!ua) return 'Unknown device';
  const lower = ua.toLowerCase();
  let os = 'Unknown OS';
  if (lower.includes('mac os x') || lower.includes('macos')) os = 'macOS';
  else if (lower.includes('windows')) os = 'Windows';
  else if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ios')) os = 'iOS';
  else if (lower.includes('linux')) os = 'Linux';
  let browser = 'Browser';
  if (lower.includes('edg/')) browser = 'Edge';
  else if (lower.includes('chrome/')) browser = 'Chrome';
  else if (lower.includes('firefox/')) browser = 'Firefox';
  else if (lower.includes('safari/')) browser = 'Safari';
  return `${browser} on ${os}`;
}
