import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

// Sub-processor registry (GDPR Article 28 / standard DPA requirement).
//
// Enterprise procurement reviewers and DPOs need a single authoritative
// answer to "who else touches our data?". Without it, a customer's own
// records-of-processing-activities (RoPA) is incomplete and their DPA
// with us is unsignable. The registry is the source of truth for:
//
//   - the public sub-processor list page that DPAs reference by URL,
//   - per-user change subscriptions so customers get advance notice of
//     additions (required by most master agreements),
//   - audit evidence that a given sub-processor was disclosed on a given
//     date (needed if a customer asks "when did you start using X?").
//
// Storage: a single JSON file under the data dir. Tiny, hand-auditable,
// no migration. Mutations are routed through this service so the audit
// chain entry, the change broadcast, and the file write are coupled.
//
// Records are append-mostly: status flips between 'active' and 'retired'
// instead of hard-deleting, so the GET endpoint can render history and
// procurement can prove a date range of use.

export type SubProcessorStatus = 'active' | 'retired';

export interface SubProcessor {
  id: string;
  // Legal entity name as it appears on the DPA. Required.
  name: string;
  // What they actually do for us. Shown verbatim in the public list.
  purpose: string;
  // Country / region where the sub-processor stores or processes data.
  // ISO-3166 alpha-2 preferred but free-form to handle "EU / EEA".
  region: string;
  // Public link to the sub-processor's own DPA or trust page. Optional
  // but strongly recommended; some customers reject sub-processors that
  // cannot produce one.
  website: string | null;
  // 'active' is in current use; 'retired' is historical disclosure.
  status: SubProcessorStatus;
  // First disclosed at this workspace install. Set automatically on
  // create and never updated; the change broadcast is keyed off this.
  disclosedAt: number;
  // Most recent mutation (name/purpose/region/website/status).
  updatedAt: number;
  // Free-form note, e.g. "data residency: us-east-1 only".
  notes: string | null;
}

export interface SubProcessorRegistry {
  // Owner-facing intro shown on the public page; safe to embed in the
  // customer's own DPA. Owners can leave this empty.
  intro: string;
  // Contact mailbox for DPA / sub-processor questions. The public page
  // surfaces this so customers always have a routable address.
  contactEmail: string | null;
  // The list. Order is insertion order, which we render reversed in the
  // public page so the most-recent disclosure appears first.
  entries: SubProcessor[];
  updatedAt: number;
  updatedBy: string | null;
}

export class SubProcessorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubProcessorValidationError';
  }
}

const FIELD_LIMITS = Object.freeze({
  name: 200,
  purpose: 500,
  region: 80,
  website: 500,
  notes: 1000,
  intro: 2000,
  contactEmail: 320,
});

function file(dataDir: string): string {
  return join(dataDir, 'sub-processors.json');
}

function defaults(): SubProcessorRegistry {
  return {
    intro: '',
    contactEmail: null,
    entries: [],
    updatedAt: 0,
    updatedBy: null,
  };
}

function coerceStatus(v: unknown): SubProcessorStatus {
  return v === 'retired' ? 'retired' : 'active';
}

function coerceEntry(raw: unknown): SubProcessor | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  return {
    id: r.id,
    name: r.name,
    purpose: typeof r.purpose === 'string' ? r.purpose : '',
    region: typeof r.region === 'string' ? r.region : '',
    website: typeof r.website === 'string' ? r.website : null,
    status: coerceStatus(r.status),
    disclosedAt: typeof r.disclosedAt === 'number' ? r.disclosedAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    notes: typeof r.notes === 'string' ? r.notes : null,
  };
}

export async function getRegistry(dataDir: string): Promise<SubProcessorRegistry> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SubProcessorRegistry>;
    const entries = Array.isArray(parsed.entries)
      ? (parsed.entries.map(coerceEntry).filter(Boolean) as SubProcessor[])
      : [];
    return {
      intro: typeof parsed.intro === 'string' ? parsed.intro : '',
      contactEmail:
        typeof parsed.contactEmail === 'string' && parsed.contactEmail.length
          ? parsed.contactEmail
          : null,
      entries,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw err;
  }
}

async function save(dataDir: string, reg: SubProcessorRegistry): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(reg, null, 2) + '\n');
}

function validateString(name: string, value: unknown, max: number, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new SubProcessorValidationError(`${name} is required`);
    }
    return '';
  }
  if (typeof value !== 'string') {
    throw new SubProcessorValidationError(`${name} must be a string`);
  }
  const v = value.trim();
  if (required && v.length === 0) {
    throw new SubProcessorValidationError(`${name} is required`);
  }
  if (v.length > max) {
    throw new SubProcessorValidationError(`${name} exceeds ${max} characters`);
  }
  return v;
}

function validateOptionalUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new SubProcessorValidationError('website must be a string or null');
  }
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > FIELD_LIMITS.website) {
    throw new SubProcessorValidationError(
      `website exceeds ${FIELD_LIMITS.website} characters`,
    );
  }
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new SubProcessorValidationError('website must be a valid http(s) URL');
  }
  return v;
}

function validateEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new SubProcessorValidationError('contactEmail must be a string or null');
  }
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > FIELD_LIMITS.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new SubProcessorValidationError('contactEmail must be a valid email address');
  }
  return v;
}

export interface CreateInput {
  name: string;
  purpose: string;
  region: string;
  website?: string | null;
  notes?: string | null;
}

export interface UpdateInput {
  name?: string;
  purpose?: string;
  region?: string;
  website?: string | null;
  notes?: string | null;
  status?: SubProcessorStatus;
}

export interface SettingsInput {
  intro?: string;
  contactEmail?: string | null;
}

export type ChangeKind = 'added' | 'updated' | 'retired' | 'restored';

export interface ChangeEvent {
  kind: ChangeKind;
  entry: SubProcessor;
  // For 'updated' / 'retired' / 'restored', the entry before mutation.
  previous?: SubProcessor;
}

/**
 * Validate-only helper. Used by the dry-run preview path so the route
 * can return the same 400 the real create would have produced without
 * touching disk.
 */
export function validateCreate(input: CreateInput): {
  name: string;
  purpose: string;
  region: string;
  website: string | null;
  notes: string | null;
} {
  return {
    name: validateString('name', input.name, FIELD_LIMITS.name, true),
    purpose: validateString('purpose', input.purpose, FIELD_LIMITS.purpose, true),
    region: validateString('region', input.region, FIELD_LIMITS.region, true),
    website: validateOptionalUrl(input.website),
    notes:
      input.notes === undefined || input.notes === null
        ? null
        : validateString('notes', input.notes, FIELD_LIMITS.notes, false) || null,
  };
}

export async function addEntry(
  dataDir: string,
  actorUserId: string,
  input: CreateInput,
  now: number = Date.now(),
): Promise<{ registry: SubProcessorRegistry; change: ChangeEvent }> {
  const v = validateCreate(input);
  const reg = await getRegistry(dataDir);
  // Reject obvious duplicates by case-insensitive name match within
  // currently-active entries. A retired entry of the same name is
  // allowed because the operator is re-onboarding a previously retired
  // vendor and the audit chain should show both events.
  const conflict = reg.entries.find(
    (e) => e.status === 'active' && e.name.toLowerCase() === v.name.toLowerCase(),
  );
  if (conflict) {
    throw new SubProcessorValidationError(
      `an active sub-processor named "${v.name}" already exists`,
    );
  }
  const entry: SubProcessor = {
    id: `sp_${nanoid(12)}`,
    name: v.name,
    purpose: v.purpose,
    region: v.region,
    website: v.website,
    notes: v.notes,
    status: 'active',
    disclosedAt: now,
    updatedAt: now,
  };
  const next: SubProcessorRegistry = {
    ...reg,
    entries: [...reg.entries, entry],
    updatedAt: now,
    updatedBy: actorUserId,
  };
  await save(dataDir, next);
  return { registry: next, change: { kind: 'added', entry } };
}

export async function updateEntry(
  dataDir: string,
  actorUserId: string,
  id: string,
  input: UpdateInput,
  now: number = Date.now(),
): Promise<{ registry: SubProcessorRegistry; change: ChangeEvent }> {
  const reg = await getRegistry(dataDir);
  const idx = reg.entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    throw new SubProcessorValidationError(`no sub-processor with id ${id}`);
  }
  const prev = reg.entries[idx]!;
  const merged: SubProcessor = {
    ...prev,
    name:
      input.name === undefined
        ? prev.name
        : validateString('name', input.name, FIELD_LIMITS.name, true),
    purpose:
      input.purpose === undefined
        ? prev.purpose
        : validateString('purpose', input.purpose, FIELD_LIMITS.purpose, true),
    region:
      input.region === undefined
        ? prev.region
        : validateString('region', input.region, FIELD_LIMITS.region, true),
    website:
      input.website === undefined ? prev.website : validateOptionalUrl(input.website),
    notes:
      input.notes === undefined
        ? prev.notes
        : input.notes === null
          ? null
          : validateString('notes', input.notes, FIELD_LIMITS.notes, false) || null,
    status: input.status === undefined ? prev.status : coerceStatus(input.status),
    updatedAt: now,
  };
  const entries = reg.entries.slice();
  entries[idx] = merged;
  const next: SubProcessorRegistry = {
    ...reg,
    entries,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  await save(dataDir, next);
  let kind: ChangeKind = 'updated';
  if (prev.status === 'active' && merged.status === 'retired') kind = 'retired';
  else if (prev.status === 'retired' && merged.status === 'active') kind = 'restored';
  return { registry: next, change: { kind, entry: merged, previous: prev } };
}

export async function retireEntry(
  dataDir: string,
  actorUserId: string,
  id: string,
  now: number = Date.now(),
): Promise<{ registry: SubProcessorRegistry; change: ChangeEvent }> {
  // Convenience wrapper used by DELETE; status flip rather than hard
  // delete so the registry remains a complete disclosure history.
  return updateEntry(dataDir, actorUserId, id, { status: 'retired' }, now);
}

export async function updateSettings(
  dataDir: string,
  actorUserId: string,
  input: SettingsInput,
  now: number = Date.now(),
): Promise<SubProcessorRegistry> {
  const reg = await getRegistry(dataDir);
  const intro =
    input.intro === undefined
      ? reg.intro
      : validateString('intro', input.intro, FIELD_LIMITS.intro, false);
  const contactEmail =
    input.contactEmail === undefined ? reg.contactEmail : validateEmail(input.contactEmail);
  const next: SubProcessorRegistry = {
    ...reg,
    intro,
    contactEmail,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  await save(dataDir, next);
  return next;
}

/**
 * Public projection used by the unauthenticated GET. Strips operator-only
 * fields (notes, updatedBy) and only surfaces active + retired entries.
 * Customers' DPAs cite this shape so we keep it deliberately narrow.
 */
export function publicView(reg: SubProcessorRegistry): {
  intro: string;
  contactEmail: string | null;
  updatedAt: number;
  entries: Array<Omit<SubProcessor, 'notes'>>;
} {
  return {
    intro: reg.intro,
    contactEmail: reg.contactEmail,
    updatedAt: reg.updatedAt,
    entries: reg.entries.map(({ notes: _n, ...rest }) => rest),
  };
}

export const SUB_PROCESSOR_LIMITS = FIELD_LIMITS;
