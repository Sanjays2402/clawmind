import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

// Record of Processing Activities (GDPR Article 30).
//
// Every controller and processor that handles personal data of EU
// residents must maintain a written register listing each processing
// activity, its purpose, the categories of data subjects and personal
// data, recipients, retention period, and (where applicable) cross-
// border transfers. During an enterprise procurement review the buyer's
// DPO will ask one of two questions: "show us your Art. 30 register"
// or "point us at your Art. 30 URL so we can drop it into our own
// register". Without an answer the DPA stalls.
//
// This module is the source of truth for that register. Like the
// sub-processor list it is exposed at a stable unauthenticated URL so
// customers can cite it from their own RoPA. Mutations are owner-only,
// MFA-gated, audited, and broadcast to every workspace member as an
// in-app notification.
//
// Storage: a single JSON file on disk, hand-auditable, no migration.
// Entries are append-mostly: status flips between 'active' and
// 'retired' instead of hard-delete so the register remains a complete
// history of processing.

export type RopaStatus = 'active' | 'retired';

export interface RopaActivity {
  id: string;
  // Short human name of the processing activity ("customer support",
  // "billing", "product analytics"). Required.
  name: string;
  // Plain-language purpose of the processing. Required, shown verbatim
  // on the public register.
  purpose: string;
  // Legal basis under GDPR Art. 6(1). One of the six options spelled
  // out by the regulation, so a customer's DPO can reconcile it
  // against their own analysis.
  legalBasis: RopaLegalBasis;
  // Free-form, comma-separated list of personal-data categories
  // processed for this activity ("contact details, account
  // identifiers"). Required.
  dataCategories: string;
  // Free-form list of data-subject categories ("customers, end-users
  // of customer's product, employees"). Required.
  dataSubjects: string;
  // Where the data sits geographically. ISO-3166 alpha-2 preferred
  // but free-form to handle "EU / EEA" or "us-east-1".
  storageRegion: string;
  // Recipients / categories of recipients beyond the workspace itself
  // ("Stripe for billing, OpenAI for inference"). Optional; if blank
  // the public page shows "internal only".
  recipients: string | null;
  // Retention period in plain language ("24 months after account
  // closure"). Required.
  retention: string;
  // Cross-border transfer safeguard if data leaves the EEA ("SCCs
  // 2021/914 module 2"), otherwise null.
  transferMechanism: string | null;
  // 'active' is in current use; 'retired' is historical disclosure.
  status: RopaStatus;
  // First disclosed at this workspace install. Set once, never
  // updated; the change broadcast keys off this.
  disclosedAt: number;
  // Most recent mutation timestamp.
  updatedAt: number;
  // Operator-only note (system identifiers, ticket links). Stripped
  // from the public projection.
  notes: string | null;
}

export type RopaLegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interests';

export const ROPA_LEGAL_BASIS_VALUES: readonly RopaLegalBasis[] = Object.freeze([
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
]);

export interface RopaRegistry {
  // Owner-facing intro shown on the public page; safe to embed in the
  // customer's own RoPA. Owners can leave this empty.
  intro: string;
  // Controller / DPO contact mailbox surfaced on the public page so
  // customers always have a routable address for Art. 30 questions.
  controllerContact: string | null;
  // Optional name of the appointed DPO (or "not appointed" / empty).
  dpoName: string | null;
  entries: RopaActivity[];
  updatedAt: number;
  updatedBy: string | null;
}

export class RopaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RopaValidationError';
  }
}

const FIELD_LIMITS = Object.freeze({
  name: 200,
  purpose: 1000,
  dataCategories: 500,
  dataSubjects: 500,
  storageRegion: 80,
  recipients: 500,
  retention: 300,
  transferMechanism: 300,
  notes: 1000,
  intro: 2000,
  controllerContact: 320,
  dpoName: 200,
});

function file(dataDir: string): string {
  return join(dataDir, 'ropa.json');
}

function defaults(): RopaRegistry {
  return {
    intro: '',
    controllerContact: null,
    dpoName: null,
    entries: [],
    updatedAt: 0,
    updatedBy: null,
  };
}

function coerceStatus(v: unknown): RopaStatus {
  return v === 'retired' ? 'retired' : 'active';
}

function coerceBasis(v: unknown): RopaLegalBasis {
  if (typeof v === 'string' && (ROPA_LEGAL_BASIS_VALUES as readonly string[]).includes(v)) {
    return v as RopaLegalBasis;
  }
  return 'legitimate_interests';
}

function coerceEntry(raw: unknown): RopaActivity | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  return {
    id: r.id,
    name: r.name,
    purpose: typeof r.purpose === 'string' ? r.purpose : '',
    legalBasis: coerceBasis(r.legalBasis),
    dataCategories: typeof r.dataCategories === 'string' ? r.dataCategories : '',
    dataSubjects: typeof r.dataSubjects === 'string' ? r.dataSubjects : '',
    storageRegion: typeof r.storageRegion === 'string' ? r.storageRegion : '',
    recipients: typeof r.recipients === 'string' && r.recipients.length ? r.recipients : null,
    retention: typeof r.retention === 'string' ? r.retention : '',
    transferMechanism:
      typeof r.transferMechanism === 'string' && r.transferMechanism.length
        ? r.transferMechanism
        : null,
    status: coerceStatus(r.status),
    disclosedAt: typeof r.disclosedAt === 'number' ? r.disclosedAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    notes: typeof r.notes === 'string' && r.notes.length ? r.notes : null,
  };
}

export async function getRegistry(dataDir: string): Promise<RopaRegistry> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RopaRegistry>;
    const entries = Array.isArray(parsed.entries)
      ? (parsed.entries.map(coerceEntry).filter(Boolean) as RopaActivity[])
      : [];
    return {
      intro: typeof parsed.intro === 'string' ? parsed.intro : '',
      controllerContact:
        typeof parsed.controllerContact === 'string' && parsed.controllerContact.length
          ? parsed.controllerContact
          : null,
      dpoName:
        typeof parsed.dpoName === 'string' && parsed.dpoName.length ? parsed.dpoName : null,
      entries,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw err;
  }
}

async function save(dataDir: string, reg: RopaRegistry): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(reg, null, 2) + '\n');
}

function validateString(name: string, value: unknown, max: number, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new RopaValidationError(`${name} is required`);
    return '';
  }
  if (typeof value !== 'string') {
    throw new RopaValidationError(`${name} must be a string`);
  }
  const v = value.trim();
  if (required && v.length === 0) {
    throw new RopaValidationError(`${name} is required`);
  }
  if (v.length > max) {
    throw new RopaValidationError(`${name} exceeds ${max} characters`);
  }
  return v;
}

function validateOptionalString(name: string, value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  const v = validateString(name, value, max, false);
  return v.length === 0 ? null : v;
}

function validateEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new RopaValidationError('controllerContact must be a string or null');
  }
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > FIELD_LIMITS.controllerContact || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new RopaValidationError('controllerContact must be a valid email address');
  }
  return v;
}

function validateBasis(value: unknown): RopaLegalBasis {
  if (typeof value !== 'string') {
    throw new RopaValidationError('legalBasis is required');
  }
  if (!(ROPA_LEGAL_BASIS_VALUES as readonly string[]).includes(value)) {
    throw new RopaValidationError(
      `legalBasis must be one of: ${ROPA_LEGAL_BASIS_VALUES.join(', ')}`,
    );
  }
  return value as RopaLegalBasis;
}

export interface CreateInput {
  name: string;
  purpose: string;
  legalBasis: RopaLegalBasis;
  dataCategories: string;
  dataSubjects: string;
  storageRegion: string;
  retention: string;
  recipients?: string | null;
  transferMechanism?: string | null;
  notes?: string | null;
}

export interface UpdateInput {
  name?: string;
  purpose?: string;
  legalBasis?: RopaLegalBasis;
  dataCategories?: string;
  dataSubjects?: string;
  storageRegion?: string;
  retention?: string;
  recipients?: string | null;
  transferMechanism?: string | null;
  notes?: string | null;
  status?: RopaStatus;
}

export interface SettingsInput {
  intro?: string;
  controllerContact?: string | null;
  dpoName?: string | null;
}

export type ChangeKind = 'added' | 'updated' | 'retired' | 'restored';

export interface ChangeEvent {
  kind: ChangeKind;
  entry: RopaActivity;
  previous?: RopaActivity;
}

export interface ValidatedCreate {
  name: string;
  purpose: string;
  legalBasis: RopaLegalBasis;
  dataCategories: string;
  dataSubjects: string;
  storageRegion: string;
  retention: string;
  recipients: string | null;
  transferMechanism: string | null;
  notes: string | null;
}

/**
 * Validate-only helper used by the dry-run path so the route can echo
 * the same 400 the real create would have produced without touching
 * disk.
 */
export function validateCreate(input: CreateInput): ValidatedCreate {
  return {
    name: validateString('name', input.name, FIELD_LIMITS.name, true),
    purpose: validateString('purpose', input.purpose, FIELD_LIMITS.purpose, true),
    legalBasis: validateBasis(input.legalBasis),
    dataCategories: validateString(
      'dataCategories',
      input.dataCategories,
      FIELD_LIMITS.dataCategories,
      true,
    ),
    dataSubjects: validateString(
      'dataSubjects',
      input.dataSubjects,
      FIELD_LIMITS.dataSubjects,
      true,
    ),
    storageRegion: validateString(
      'storageRegion',
      input.storageRegion,
      FIELD_LIMITS.storageRegion,
      true,
    ),
    retention: validateString('retention', input.retention, FIELD_LIMITS.retention, true),
    recipients: validateOptionalString('recipients', input.recipients, FIELD_LIMITS.recipients),
    transferMechanism: validateOptionalString(
      'transferMechanism',
      input.transferMechanism,
      FIELD_LIMITS.transferMechanism,
    ),
    notes: validateOptionalString('notes', input.notes, FIELD_LIMITS.notes),
  };
}

export async function addEntry(
  dataDir: string,
  actorUserId: string,
  input: CreateInput,
  now: number = Date.now(),
): Promise<{ registry: RopaRegistry; change: ChangeEvent }> {
  const v = validateCreate(input);
  const reg = await getRegistry(dataDir);
  // Reject duplicates by case-insensitive name match within currently
  // active entries. Retired same-name entries are allowed so an
  // operator can re-introduce a previously-retired activity and the
  // audit chain shows both events.
  const conflict = reg.entries.find(
    (e) => e.status === 'active' && e.name.toLowerCase() === v.name.toLowerCase(),
  );
  if (conflict) {
    throw new RopaValidationError(
      `an active processing activity named "${v.name}" already exists`,
    );
  }
  const entry: RopaActivity = {
    id: `ropa_${nanoid(12)}`,
    name: v.name,
    purpose: v.purpose,
    legalBasis: v.legalBasis,
    dataCategories: v.dataCategories,
    dataSubjects: v.dataSubjects,
    storageRegion: v.storageRegion,
    recipients: v.recipients,
    retention: v.retention,
    transferMechanism: v.transferMechanism,
    notes: v.notes,
    status: 'active',
    disclosedAt: now,
    updatedAt: now,
  };
  const next: RopaRegistry = {
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
): Promise<{ registry: RopaRegistry; change: ChangeEvent }> {
  const reg = await getRegistry(dataDir);
  const idx = reg.entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    throw new RopaValidationError(`no processing activity with id ${id}`);
  }
  const prev = reg.entries[idx]!;
  const merged: RopaActivity = {
    ...prev,
    name:
      input.name === undefined
        ? prev.name
        : validateString('name', input.name, FIELD_LIMITS.name, true),
    purpose:
      input.purpose === undefined
        ? prev.purpose
        : validateString('purpose', input.purpose, FIELD_LIMITS.purpose, true),
    legalBasis: input.legalBasis === undefined ? prev.legalBasis : validateBasis(input.legalBasis),
    dataCategories:
      input.dataCategories === undefined
        ? prev.dataCategories
        : validateString(
            'dataCategories',
            input.dataCategories,
            FIELD_LIMITS.dataCategories,
            true,
          ),
    dataSubjects:
      input.dataSubjects === undefined
        ? prev.dataSubjects
        : validateString('dataSubjects', input.dataSubjects, FIELD_LIMITS.dataSubjects, true),
    storageRegion:
      input.storageRegion === undefined
        ? prev.storageRegion
        : validateString('storageRegion', input.storageRegion, FIELD_LIMITS.storageRegion, true),
    retention:
      input.retention === undefined
        ? prev.retention
        : validateString('retention', input.retention, FIELD_LIMITS.retention, true),
    recipients:
      input.recipients === undefined
        ? prev.recipients
        : validateOptionalString('recipients', input.recipients, FIELD_LIMITS.recipients),
    transferMechanism:
      input.transferMechanism === undefined
        ? prev.transferMechanism
        : validateOptionalString(
            'transferMechanism',
            input.transferMechanism,
            FIELD_LIMITS.transferMechanism,
          ),
    notes:
      input.notes === undefined
        ? prev.notes
        : validateOptionalString('notes', input.notes, FIELD_LIMITS.notes),
    status: input.status === undefined ? prev.status : coerceStatus(input.status),
    updatedAt: now,
  };
  const entries = reg.entries.slice();
  entries[idx] = merged;
  const next: RopaRegistry = {
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
): Promise<{ registry: RopaRegistry; change: ChangeEvent }> {
  return updateEntry(dataDir, actorUserId, id, { status: 'retired' }, now);
}

export async function updateSettings(
  dataDir: string,
  actorUserId: string,
  input: SettingsInput,
  now: number = Date.now(),
): Promise<RopaRegistry> {
  const reg = await getRegistry(dataDir);
  const intro =
    input.intro === undefined
      ? reg.intro
      : validateString('intro', input.intro, FIELD_LIMITS.intro, false);
  const controllerContact =
    input.controllerContact === undefined
      ? reg.controllerContact
      : validateEmail(input.controllerContact);
  const dpoName =
    input.dpoName === undefined
      ? reg.dpoName
      : validateOptionalString('dpoName', input.dpoName, FIELD_LIMITS.dpoName);
  const next: RopaRegistry = {
    ...reg,
    intro,
    controllerContact,
    dpoName,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  await save(dataDir, next);
  return next;
}

/**
 * Public projection used by the unauthenticated GET. Strips operator-
 * only fields (notes, updatedBy). Customers' DPAs cite this shape so
 * we keep it deliberately narrow.
 */
export function publicView(reg: RopaRegistry): {
  intro: string;
  controllerContact: string | null;
  dpoName: string | null;
  updatedAt: number;
  entries: Array<Omit<RopaActivity, 'notes'>>;
} {
  return {
    intro: reg.intro,
    controllerContact: reg.controllerContact,
    dpoName: reg.dpoName,
    updatedAt: reg.updatedAt,
    entries: reg.entries.map(({ notes: _n, ...rest }) => rest),
  };
}

export const ROPA_LIMITS = FIELD_LIMITS;

/**
 * Case-insensitive substring filter over the visible columns of a RoPA
 * entry (name, purpose, data categories, data subjects, storage
 * region, recipients, retention, transfer mechanism). Mirrors
 * `filterEntries` on `/sub-processors`, `/recovery-contacts`, etc. so
 * the same curation search box on the public Art. 30 register works
 * the way a DPO expects when they paste "stripe" or "us-east-1" into
 * the box. Operator-only `notes` are intentionally excluded so the
 * admin view doesn't return rows the public view would hide.
 */
export function filterEntries<
  T extends Pick<
    RopaActivity,
    | 'name'
    | 'purpose'
    | 'dataCategories'
    | 'dataSubjects'
    | 'storageRegion'
    | 'recipients'
    | 'retention'
    | 'transferMechanism'
  >,
>(entries: T[], q: string | undefined): T[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((e) => {
    const hay = [
      e.name,
      e.purpose,
      e.dataCategories,
      e.dataSubjects,
      e.storageRegion,
      e.recipients ?? '',
      e.retention,
      e.transferMechanism ?? '',
    ]
      .join('\n')
      .toLowerCase();
    return hay.includes(needle);
  });
}
