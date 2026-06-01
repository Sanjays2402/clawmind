import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

// Recovery contacts registry (SOC2 CC7.4 / ISO 22301 BCP control).
//
// Procurement reviewers and BCP auditors ask one specific question
// during vendor onboarding: "if the workspace owner is unreachable
// — bus, breach, custody dispute, dead laptop — who do we call?"
// Without a named escalation list the buyer's incident-response
// runbook has a dangling reference and most enterprise contracts
// require this list be published or attached as an exhibit.
//
// The registry is the source of truth for two surfaces:
//
//   - the public projection at GET /v1/recovery-contacts, which
//     exposes only entries the owner has explicitly marked
//     `publicListed: true`. A buyer's IR runbook cites this URL.
//   - the operator view at GET /v1/recovery-contacts/admin, which
//     adds private notes and updatedBy for audit-evidence pulls.
//
// Storage is a single JSON file under the data dir, append-mostly:
// status flips between 'active' and 'retired' rather than hard
// delete so the audit trail can prove that a given contact was on
// record at a given date (regulators sometimes ask).
//
// Mutations are owner-only with MFA step-up at the route because
// changing an emergency contact silently can break a buyer's
// incident-response runbook the next time they need it.

export type RecoveryContactStatus = 'active' | 'retired';

export interface RecoveryContact {
  id: string;
  // Human name as it appears on an org chart. Required.
  name: string;
  // Function this contact covers, e.g. "DPO", "Security Lead",
  // "On-call SRE", "Legal". Free-form to avoid forcing a taxonomy
  // that does not match every workspace.
  role: string;
  // Routable email. Required: a phone line alone is not enough for
  // an incident-response runbook because most playbooks open with
  // a written notification.
  email: string;
  // Optional phone in free-form. We do not parse or validate the
  // format because international conventions vary and a stricter
  // regex would just push operators to leave the field blank.
  phone: string | null;
  // Lower number = called first. We do not enforce uniqueness
  // because two contacts can legitimately share a tier (e.g. two
  // on-call SREs at priority 1).
  priority: number;
  // If true, the entry appears in the unauthenticated public
  // projection. Owners frequently want a named DPO and a named
  // security mailbox public, but internal escalation steps kept
  // private. Default false so a fresh import never accidentally
  // discloses a personal phone.
  publicListed: boolean;
  // 'active' is current; 'retired' is historical disclosure.
  status: RecoveryContactStatus;
  // First disclosed at this workspace install. Set on create and
  // never updated.
  disclosedAt: number;
  // Most recent mutation (any field).
  updatedAt: number;
  // Operator-only note, e.g. "use Signal after 21:00 UTC".
  notes: string | null;
}

export interface RecoveryContactRegistry {
  // Owner-facing intro shown on the public page. Safe to embed in
  // the buyer's incident-response runbook.
  intro: string;
  // Public mailbox of last resort. The public page surfaces this
  // so a buyer always has at least one routable address even if
  // every individual contact is retired.
  fallbackEmail: string | null;
  entries: RecoveryContact[];
  updatedAt: number;
  updatedBy: string | null;
}

export class RecoveryContactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryContactValidationError';
  }
}

const FIELD_LIMITS = Object.freeze({
  name: 200,
  role: 120,
  email: 320,
  phone: 60,
  notes: 1000,
  intro: 2000,
  fallbackEmail: 320,
});

const MAX_ENTRIES = 100;

function file(dataDir: string): string {
  return join(dataDir, 'recovery-contacts.json');
}

function defaults(): RecoveryContactRegistry {
  return {
    intro: '',
    fallbackEmail: null,
    entries: [],
    updatedAt: 0,
    updatedBy: null,
  };
}

function coerceStatus(v: unknown): RecoveryContactStatus {
  return v === 'retired' ? 'retired' : 'active';
}

function coerceEntry(raw: unknown): RecoveryContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  return {
    id: r.id,
    name: r.name,
    role: typeof r.role === 'string' ? r.role : '',
    email: typeof r.email === 'string' ? r.email : '',
    phone: typeof r.phone === 'string' && r.phone.length ? r.phone : null,
    priority: typeof r.priority === 'number' && Number.isFinite(r.priority) ? r.priority : 100,
    publicListed: r.publicListed === true,
    status: coerceStatus(r.status),
    disclosedAt: typeof r.disclosedAt === 'number' ? r.disclosedAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    notes: typeof r.notes === 'string' && r.notes.length ? r.notes : null,
  };
}

export async function getRegistry(dataDir: string): Promise<RecoveryContactRegistry> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<RecoveryContactRegistry>;
    const entries = Array.isArray(parsed.entries)
      ? (parsed.entries.map(coerceEntry).filter(Boolean) as RecoveryContact[])
      : [];
    return {
      intro: typeof parsed.intro === 'string' ? parsed.intro : '',
      fallbackEmail:
        typeof parsed.fallbackEmail === 'string' && parsed.fallbackEmail.length
          ? parsed.fallbackEmail
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

async function save(dataDir: string, reg: RecoveryContactRegistry): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(reg, null, 2) + '\n');
}

function validateString(name: string, value: unknown, max: number, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    if (required) throw new RecoveryContactValidationError(`${name} is required`);
    return '';
  }
  if (typeof value !== 'string') {
    throw new RecoveryContactValidationError(`${name} must be a string`);
  }
  const v = value.trim();
  if (required && v.length === 0) {
    throw new RecoveryContactValidationError(`${name} is required`);
  }
  if (v.length > max) {
    throw new RecoveryContactValidationError(`${name} exceeds ${max} characters`);
  }
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(name: string, value: unknown, max: number, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new RecoveryContactValidationError(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') {
    throw new RecoveryContactValidationError(`${name} must be a string or null`);
  }
  const v = value.trim();
  if (v.length === 0) {
    if (required) throw new RecoveryContactValidationError(`${name} is required`);
    return null;
  }
  if (v.length > max || !EMAIL_RE.test(v)) {
    throw new RecoveryContactValidationError(`${name} must be a valid email address`);
  }
  return v;
}

function validateOptionalString(name: string, value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new RecoveryContactValidationError(`${name} must be a string or null`);
  }
  const v = value.trim();
  if (v.length === 0) return null;
  if (v.length > max) {
    throw new RecoveryContactValidationError(`${name} exceeds ${max} characters`);
  }
  return v;
}

function validatePriority(value: unknown): number {
  if (value === undefined || value === null) return 100;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RecoveryContactValidationError('priority must be a number');
  }
  const n = Math.trunc(value);
  if (n < 1 || n > 999) {
    throw new RecoveryContactValidationError('priority must be between 1 and 999');
  }
  return n;
}

export interface CreateInput {
  name: string;
  role: string;
  email: string;
  phone?: string | null;
  priority?: number;
  publicListed?: boolean;
  notes?: string | null;
}

export interface UpdateInput {
  name?: string;
  role?: string;
  email?: string;
  phone?: string | null;
  priority?: number;
  publicListed?: boolean;
  notes?: string | null;
  status?: RecoveryContactStatus;
}

export interface SettingsInput {
  intro?: string;
  fallbackEmail?: string | null;
}

export type ChangeKind = 'added' | 'updated' | 'retired' | 'restored';

export interface ChangeEvent {
  kind: ChangeKind;
  entry: RecoveryContact;
  previous?: RecoveryContact;
}

/**
 * Validate-only helper. Used by the dry-run preview so the route can
 * return the same 400 the real create would have produced without
 * touching disk.
 */
export function validateCreate(input: CreateInput): {
  name: string;
  role: string;
  email: string;
  phone: string | null;
  priority: number;
  publicListed: boolean;
  notes: string | null;
} {
  return {
    name: validateString('name', input.name, FIELD_LIMITS.name, true),
    role: validateString('role', input.role, FIELD_LIMITS.role, true),
    email: validateEmail('email', input.email, FIELD_LIMITS.email, true)!,
    phone: validateOptionalString('phone', input.phone, FIELD_LIMITS.phone),
    priority: validatePriority(input.priority),
    publicListed: input.publicListed === true,
    notes:
      input.notes === undefined || input.notes === null
        ? null
        : validateOptionalString('notes', input.notes, FIELD_LIMITS.notes),
  };
}

export async function addEntry(
  dataDir: string,
  actorUserId: string,
  input: CreateInput,
  now: number = Date.now(),
): Promise<{ registry: RecoveryContactRegistry; change: ChangeEvent }> {
  const v = validateCreate(input);
  const reg = await getRegistry(dataDir);
  if (reg.entries.length >= MAX_ENTRIES) {
    throw new RecoveryContactValidationError(
      `recovery-contacts registry is full (max ${MAX_ENTRIES} entries; retire one first)`,
    );
  }
  // Reject duplicate active entries by email so a buyer's runbook
  // never resolves to two distinct people behind the same address.
  const conflict = reg.entries.find(
    (e) => e.status === 'active' && e.email.toLowerCase() === v.email.toLowerCase(),
  );
  if (conflict) {
    throw new RecoveryContactValidationError(
      `an active recovery contact for "${v.email}" already exists`,
    );
  }
  const entry: RecoveryContact = {
    id: `rc_${nanoid(12)}`,
    name: v.name,
    role: v.role,
    email: v.email,
    phone: v.phone,
    priority: v.priority,
    publicListed: v.publicListed,
    notes: v.notes,
    status: 'active',
    disclosedAt: now,
    updatedAt: now,
  };
  const next: RecoveryContactRegistry = {
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
): Promise<{ registry: RecoveryContactRegistry; change: ChangeEvent }> {
  const reg = await getRegistry(dataDir);
  const idx = reg.entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    throw new RecoveryContactValidationError(`no recovery contact with id ${id}`);
  }
  const prev = reg.entries[idx]!;
  const merged: RecoveryContact = {
    ...prev,
    name:
      input.name === undefined
        ? prev.name
        : validateString('name', input.name, FIELD_LIMITS.name, true),
    role:
      input.role === undefined
        ? prev.role
        : validateString('role', input.role, FIELD_LIMITS.role, true),
    email:
      input.email === undefined
        ? prev.email
        : validateEmail('email', input.email, FIELD_LIMITS.email, true)!,
    phone:
      input.phone === undefined
        ? prev.phone
        : validateOptionalString('phone', input.phone, FIELD_LIMITS.phone),
    priority: input.priority === undefined ? prev.priority : validatePriority(input.priority),
    publicListed: input.publicListed === undefined ? prev.publicListed : input.publicListed === true,
    notes:
      input.notes === undefined
        ? prev.notes
        : input.notes === null
          ? null
          : validateOptionalString('notes', input.notes, FIELD_LIMITS.notes),
    status: input.status === undefined ? prev.status : coerceStatus(input.status),
    updatedAt: now,
  };
  // Email-conflict check: if email changed and it now collides with
  // a different active entry, reject. We allow no-op rewrites of the
  // same email on the same row.
  if (merged.email.toLowerCase() !== prev.email.toLowerCase() && merged.status === 'active') {
    const conflict = reg.entries.find(
      (e, i) =>
        i !== idx &&
        e.status === 'active' &&
        e.email.toLowerCase() === merged.email.toLowerCase(),
    );
    if (conflict) {
      throw new RecoveryContactValidationError(
        `an active recovery contact for "${merged.email}" already exists`,
      );
    }
  }
  const entries = reg.entries.slice();
  entries[idx] = merged;
  const next: RecoveryContactRegistry = {
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
): Promise<{ registry: RecoveryContactRegistry; change: ChangeEvent }> {
  return updateEntry(dataDir, actorUserId, id, { status: 'retired' }, now);
}

export async function updateSettings(
  dataDir: string,
  actorUserId: string,
  input: SettingsInput,
  now: number = Date.now(),
): Promise<RecoveryContactRegistry> {
  const reg = await getRegistry(dataDir);
  const intro =
    input.intro === undefined
      ? reg.intro
      : validateString('intro', input.intro, FIELD_LIMITS.intro, false);
  const fallbackEmail =
    input.fallbackEmail === undefined
      ? reg.fallbackEmail
      : validateEmail('fallbackEmail', input.fallbackEmail, FIELD_LIMITS.fallbackEmail, false);
  const next: RecoveryContactRegistry = {
    ...reg,
    intro,
    fallbackEmail,
    updatedAt: now,
    updatedBy: actorUserId,
  };
  await save(dataDir, next);
  return next;
}

/**
 * Public projection used by the unauthenticated GET. Only entries
 * marked publicListed=true and currently active are surfaced, and
 * even then private fields (notes, disclosedAt provenance) are
 * stripped. Sorted by priority ascending so a buyer's runbook
 * always escalates in the configured order.
 */
export function publicView(reg: RecoveryContactRegistry): {
  intro: string;
  fallbackEmail: string | null;
  updatedAt: number;
  entries: Array<{
    name: string;
    role: string;
    email: string;
    phone: string | null;
    priority: number;
  }>;
} {
  const entries = reg.entries
    .filter((e) => e.publicListed && e.status === 'active')
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name,
      role: e.role,
      email: e.email,
      phone: e.phone,
      priority: e.priority,
    }));
  return {
    intro: reg.intro,
    fallbackEmail: reg.fallbackEmail,
    updatedAt: reg.updatedAt,
    entries,
  };
}

export const RECOVERY_CONTACT_LIMITS = FIELD_LIMITS;
export const RECOVERY_CONTACT_MAX_ENTRIES = MAX_ENTRIES;
