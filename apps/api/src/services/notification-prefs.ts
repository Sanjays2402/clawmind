import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { NotificationKind } from './notifications.js';

// Per-user notification preferences. Companion to services/notifications.ts.
//
// One JSON object per user under <dataDir>/notification-prefs/<userId>.json.
// Tiny on purpose: a map from NotificationKind to a boolean (enabled?). A
// missing kind is treated as enabled, so existing users keep getting every
// notification until they opt out. This matches user intuition: the first
// time you visit the page everything is on, you switch off what you do not
// want, and only the things you switched off go silent.
//
// The shouldDeliver() helper is the single gate used by services/notifications
// create() to drop muted kinds before they ever hit the inbox.

export interface PreferencesRecord {
  userId: string;
  prefs: Partial<Record<NotificationKind, boolean>>;
  updatedAt: number;
}

export const KNOWN_KINDS: readonly NotificationKind[] = Object.freeze([
  'share.viewed',
  'webhook.disabled',
  'webhook.failed',
  'sub-processor.changed',
  'ropa.changed',
  'system',
] as const);

function file(dataDir: string, userId: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(userId)) {
    throw new Error('invalid userId for notification preferences store');
  }
  return join(dataDir, 'notification-prefs', `${userId}.json`);
}

export function defaultPrefs(): Partial<Record<NotificationKind, boolean>> {
  const out: Partial<Record<NotificationKind, boolean>> = {};
  for (const k of KNOWN_KINDS) out[k] = true;
  return out;
}

export async function getPreferences(
  dataDir: string,
  userId: string,
): Promise<PreferencesRecord> {
  try {
    const raw = await readFile(file(dataDir, userId), 'utf8');
    const parsed = JSON.parse(raw) as PreferencesRecord;
    const merged: Partial<Record<NotificationKind, boolean>> = {};
    for (const k of KNOWN_KINDS) {
      merged[k] = parsed.prefs?.[k] !== false;
    }
    return { userId, prefs: merged, updatedAt: parsed.updatedAt ?? 0 };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { userId, prefs: defaultPrefs(), updatedAt: 0 };
    }
    throw err;
  }
}

export interface UpdateInput {
  prefs: Partial<Record<NotificationKind, boolean>>;
}

export async function setPreferences(
  dataDir: string,
  userId: string,
  input: UpdateInput,
  now: number = Date.now(),
): Promise<PreferencesRecord> {
  const current = await getPreferences(dataDir, userId);
  const next: Partial<Record<NotificationKind, boolean>> = { ...current.prefs };
  for (const k of KNOWN_KINDS) {
    if (Object.prototype.hasOwnProperty.call(input.prefs, k)) {
      next[k] = !!input.prefs[k];
    }
  }
  const rec: PreferencesRecord = { userId, prefs: next, updatedAt: now };
  const path = file(dataDir, userId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(rec, null, 2), 'utf8');
  return rec;
}

/**
 * Returns true if a notification of `kind` should be delivered to `userId`.
 * Missing pref files (the common case for everyone who hasn't visited the
 * preferences page yet) resolve to true so we never silently drop traffic.
 * Failures fall open for the same reason: a corrupt pref file should not
 * cause the user to miss a webhook-failed alert.
 */
export async function shouldDeliver(
  dataDir: string,
  userId: string,
  kind: NotificationKind,
): Promise<boolean> {
  try {
    const rec = await getPreferences(dataDir, userId);
    return rec.prefs[kind] !== false;
  } catch {
    return true;
  }
}
