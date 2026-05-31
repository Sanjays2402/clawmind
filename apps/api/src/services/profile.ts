import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// User profile: the small bag of human-friendly settings every account has.
//
// Lives at <dataDir>/profiles.json keyed by userId. Kept tiny on purpose:
// the things a returning customer actually wants to set once and forget.
//   displayName   what we call them in the UI (defaults to userId)
//   timezone      IANA tz used by the digest scheduler and timestamps
//   defaultModel  preselected model in /chat and /ask; null means "server default"
//
// File layout mirrors api-keys / webhooks / notifications: a single JSON
// array, atomic rewrite on every mutation, no lock because the API is the
// only writer. createdAt is set lazily the first time we hand back a profile.

export interface ProfileRecord {
  userId: string;
  displayName: string;
  timezone: string;
  defaultModel: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProfilePatch {
  displayName?: string;
  timezone?: string;
  defaultModel?: string | null;
}

const FILE_NAME = 'profiles.json';
const MAX_NAME = 80;
const MAX_TZ = 64;
const MAX_MODEL = 80;

function file(dataDir: string): string {
  return join(dataDir, FILE_NAME);
}

async function loadAll(dataDir: string): Promise<ProfileRecord[]> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as ProfileRecord[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function saveAll(dataDir: string, records: ProfileRecord[]): Promise<void> {
  const path = file(dataDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(records, null, 2), 'utf8');
}

function defaultProfile(userId: string, now: number): ProfileRecord {
  return {
    userId,
    displayName: userId,
    timezone: 'UTC',
    defaultModel: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Return the profile for a user. If none exists yet we synthesise one with
 * sensible defaults so the caller never has to special-case "first visit".
 * The synthesised record is not persisted: a write only happens on patch.
 */
export async function getProfile(dataDir: string, userId: string): Promise<ProfileRecord> {
  const all = await loadAll(dataDir);
  const found = all.find((p) => p.userId === userId);
  if (found) return found;
  return defaultProfile(userId, Date.now());
}

/**
 * Validate a profile patch. Returns the trimmed/normalised values when valid
 * or a structured error describing the offending field. Validation rules are
 * intentionally lenient: anyone can type their own name, any IANA-shaped tz
 * up to 64 chars is allowed (we do not enumerate every zone), and the model
 * id is bounded only by length so users can paste new model names as we ship
 * them without waiting for a server release.
 */
export function validatePatch(patch: ProfilePatch): { ok: true; value: ProfilePatch } | { ok: false; field: string; message: string } {
  const out: ProfilePatch = {};
  if (patch.displayName !== undefined) {
    const trimmed = patch.displayName.trim();
    if (trimmed.length === 0) return { ok: false, field: 'displayName', message: 'displayName cannot be empty' };
    if (trimmed.length > MAX_NAME) return { ok: false, field: 'displayName', message: `displayName must be <= ${MAX_NAME} chars` };
    out.displayName = trimmed;
  }
  if (patch.timezone !== undefined) {
    const trimmed = patch.timezone.trim();
    if (trimmed.length === 0) return { ok: false, field: 'timezone', message: 'timezone cannot be empty' };
    if (trimmed.length > MAX_TZ) return { ok: false, field: 'timezone', message: `timezone must be <= ${MAX_TZ} chars` };
    if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(trimmed)) {
      return { ok: false, field: 'timezone', message: 'timezone must look like an IANA zone (e.g. America/Los_Angeles)' };
    }
    out.timezone = trimmed;
  }
  if (patch.defaultModel !== undefined) {
    if (patch.defaultModel === null) {
      out.defaultModel = null;
    } else {
      const trimmed = String(patch.defaultModel).trim();
      if (trimmed.length === 0) {
        out.defaultModel = null;
      } else {
        if (trimmed.length > MAX_MODEL) return { ok: false, field: 'defaultModel', message: `defaultModel must be <= ${MAX_MODEL} chars` };
        out.defaultModel = trimmed;
      }
    }
  }
  return { ok: true, value: out };
}

/**
 * Apply a patch to a user's profile, creating the record if this is the
 * first write. Returns the new record. The caller is expected to have run
 * validatePatch first; this function will still apply defensive trimming.
 */
export async function updateProfile(
  dataDir: string,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileRecord> {
  const validation = validatePatch(patch);
  if (!validation.ok) {
    throw new Error(`invalid profile patch: ${validation.field}: ${validation.message}`);
  }
  const clean = validation.value;
  const all = await loadAll(dataDir);
  const now = Date.now();
  const idx = all.findIndex((p) => p.userId === userId);
  let record: ProfileRecord;
  if (idx === -1) {
    record = { ...defaultProfile(userId, now), ...clean, updatedAt: now };
    all.push(record);
  } else {
    const existing = all[idx]!;
    record = { ...existing, ...clean, updatedAt: now };
    all[idx] = record;
  }
  await saveAll(dataDir, all);
  return record;
}

// Test seam: export the constants so tests can assert the same bounds the
// server enforces without duplicating magic numbers.
export const PROFILE_LIMITS = { MAX_NAME, MAX_TZ, MAX_MODEL } as const;
