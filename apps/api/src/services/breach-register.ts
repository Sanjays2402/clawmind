import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { nanoid } from 'nanoid';

// Personal Data Breach Notification Register (GDPR Art. 33 / Art. 34).
//
// Article 33 obliges every controller to notify the competent supervisory
// authority of a personal data breach "without undue delay and, where
// feasible, not later than 72 hours" after becoming aware of it. Article 34
// adds a parallel obligation to notify affected data subjects when the
// breach is likely to result in a high risk to their rights and freedoms.
//
// The general Security Incident Disclosure Log (services/incidents.ts) is
// the marketing-grade public timeline a buyer crawls during procurement.
// It is intentionally light on regulatory metadata. The Breach Register
// captured here is the regulatory-grade artefact a DPA / DPO actually
// signs off on: per-breach notification deadlines, supervisory authority
// notification status, data-subject notification status, the categories
// and approximate count of records and subjects involved, and (where
// notification was delayed past 72h) the written justification the
// regulator will ask for.
//
// This is a procurement gate for EU customers: enterprise DPAs in 2024+
// explicitly require either "you have never had a notifiable breach" or
// "show us your breach register". Without one, the security questionnaire
// stalls.
//
// Storage: a single JSON document on disk, hand-auditable, no migration.
// All entries are append-only soft-state: closing a breach flips status,
// it does not remove the row. Hard delete is owner+MFA and audited so
// the register remains a defensible regulatory record.

// 72 hours expressed in milliseconds. Cached so the deadline calculator
// is allocation-free.
export const ART33_WINDOW_MS = 72 * 60 * 60 * 1000;

export type BreachSeverity = 'low' | 'medium' | 'high' | 'critical';
export type BreachStatus = 'open' | 'contained' | 'closed';
export type AuthorityNotificationStatus =
  | 'not_required'
  | 'pending'
  | 'notified'
  | 'delayed';
export type SubjectNotificationStatus =
  | 'not_required'
  | 'pending'
  | 'notified'
  | 'public_communication';

export interface BreachEntry {
  id: string;
  reference: string; // human-readable case id, e.g. "BR-2024-001"
  title: string;
  summary: string;
  severity: BreachSeverity;
  status: BreachStatus;
  // Moment the controller became aware of the breach. Article 33's 72h
  // clock starts from this timestamp, not from when the breach occurred.
  discoveredAt: number;
  occurredAt: number | null;
  containedAt: number | null;
  closedAt: number | null;
  // Categories of personal data implicated, e.g. "contact details,
  // hashed credentials". Stored verbatim from the operator.
  dataCategories: string;
  // Categories of data subjects, e.g. "customers in EU, employees".
  dataSubjects: string;
  // Approximate counts the regulator will ask for. Null when unknown.
  approxRecords: number | null;
  approxSubjects: number | null;
  // Likely consequences ("credential stuffing risk", "no material impact").
  likelyConsequences: string;
  // Mitigations applied or proposed ("forced password reset, revoked
  // session tokens"). Required by Art. 33(3)(d).
  mitigations: string;
  authorityNotification: AuthorityNotificationStatus;
  // ISO country code or "EU lead authority" etc. Free-form because
  // multi-state coordination is messy in practice.
  authorityName: string | null;
  authorityNotifiedAt: number | null;
  // Required if authority notification is later than 72h after
  // discoveredAt. Validation enforces this.
  delayJustification: string | null;
  subjectNotification: SubjectNotificationStatus;
  subjectNotifiedAt: number | null;
  // DPO or controller contact published for follow-up.
  contact: string | null;
  // Operator-only field. Stripped from the public projection.
  internalNotes: string | null;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

export interface BreachRegister {
  entries: BreachEntry[];
  updatedAt: number;
  updatedBy: string | null;
}

export class BreachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreachValidationError';
  }
}

export const BREACH_LIMITS = Object.freeze({
  reference: 64,
  title: 200,
  summary: 2000,
  dataCategories: 500,
  dataSubjects: 500,
  likelyConsequences: 1000,
  mitigations: 1000,
  authorityName: 200,
  delayJustification: 2000,
  contact: 320,
  internalNotes: 4000,
  maxEntries: 5000,
});

const SEVERITIES: readonly BreachSeverity[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: readonly BreachStatus[] = ['open', 'contained', 'closed'];
const AUTH_STATUSES: readonly AuthorityNotificationStatus[] = [
  'not_required',
  'pending',
  'notified',
  'delayed',
];
const SUBJ_STATUSES: readonly SubjectNotificationStatus[] = [
  'not_required',
  'pending',
  'notified',
  'public_communication',
];

function file(dataDir: string): string {
  return join(dataDir, 'breach-register.json');
}

function defaults(): BreachRegister {
  return { entries: [], updatedAt: 0, updatedBy: null };
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function so(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function coerceEntry(raw: unknown): BreachEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.reference !== 'string') return null;
  const severity = SEVERITIES.includes(r.severity as BreachSeverity)
    ? (r.severity as BreachSeverity)
    : 'medium';
  const status = STATUSES.includes(r.status as BreachStatus)
    ? (r.status as BreachStatus)
    : 'open';
  const authorityNotification = AUTH_STATUSES.includes(
    r.authorityNotification as AuthorityNotificationStatus,
  )
    ? (r.authorityNotification as AuthorityNotificationStatus)
    : 'pending';
  const subjectNotification = SUBJ_STATUSES.includes(
    r.subjectNotification as SubjectNotificationStatus,
  )
    ? (r.subjectNotification as SubjectNotificationStatus)
    : 'pending';
  return {
    id: r.id,
    reference: r.reference,
    title: s(r.title),
    summary: s(r.summary),
    severity,
    status,
    discoveredAt: typeof r.discoveredAt === 'number' ? r.discoveredAt : 0,
    occurredAt: n(r.occurredAt),
    containedAt: n(r.containedAt),
    closedAt: n(r.closedAt),
    dataCategories: s(r.dataCategories),
    dataSubjects: s(r.dataSubjects),
    approxRecords: n(r.approxRecords),
    approxSubjects: n(r.approxSubjects),
    likelyConsequences: s(r.likelyConsequences),
    mitigations: s(r.mitigations),
    authorityNotification,
    authorityName: so(r.authorityName),
    authorityNotifiedAt: n(r.authorityNotifiedAt),
    delayJustification: so(r.delayJustification),
    subjectNotification,
    subjectNotifiedAt: n(r.subjectNotifiedAt),
    contact: so(r.contact),
    internalNotes: so(r.internalNotes),
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : '',
  };
}

export async function getRegister(dataDir: string): Promise<BreachRegister> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<BreachRegister>;
    const entries = Array.isArray(parsed.entries)
      ? (parsed.entries.map(coerceEntry).filter(Boolean) as BreachEntry[])
      : [];
    return {
      entries,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      updatedBy: typeof parsed.updatedBy === 'string' ? parsed.updatedBy : null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaults();
    throw err;
  }
}

async function save(dataDir: string, reg: BreachRegister): Promise<void> {
  const f = file(dataDir);
  await mkdir(dirname(f), { recursive: true });
  await writeFile(f, JSON.stringify(reg, null, 2) + '\n');
}

function reqStr(name: string, value: unknown, max: number): string {
  if (typeof value !== 'string') throw new BreachValidationError(`${name} is required`);
  const v = value.trim();
  if (!v) throw new BreachValidationError(`${name} is required`);
  if (v.length > max) throw new BreachValidationError(`${name} exceeds ${max} characters`);
  return v;
}
function optStr(name: string, value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BreachValidationError(`${name} must be a string`);
  const v = value.trim();
  if (!v) return null;
  if (v.length > max) throw new BreachValidationError(`${name} exceeds ${max} characters`);
  return v;
}
function optNum(name: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new BreachValidationError(`${name} must be a non-negative number`);
  }
  return Math.floor(value);
}
function reqTs(name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BreachValidationError(`${name} must be a positive epoch ms`);
  }
  return Math.floor(value);
}
function optTs(name: string, value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BreachValidationError(`${name} must be a positive epoch ms or null`);
  }
  return Math.floor(value);
}
function enumVal<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BreachValidationError(`${name} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export interface CreateBreachInput {
  reference: string;
  title: string;
  summary: string;
  severity: BreachSeverity;
  status: BreachStatus;
  discoveredAt: number;
  occurredAt?: number | null;
  containedAt?: number | null;
  closedAt?: number | null;
  dataCategories: string;
  dataSubjects: string;
  approxRecords?: number | null;
  approxSubjects?: number | null;
  likelyConsequences: string;
  mitigations: string;
  authorityNotification: AuthorityNotificationStatus;
  authorityName?: string | null;
  authorityNotifiedAt?: number | null;
  delayJustification?: string | null;
  subjectNotification: SubjectNotificationStatus;
  subjectNotifiedAt?: number | null;
  contact?: string | null;
  internalNotes?: string | null;
}

export interface ValidatedBreach extends Omit<BreachEntry, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> {}

/**
 * Validate a create payload and return the normalised values. Cross-field
 * rules enforced here:
 *   - delayJustification is mandatory whenever the controller notified the
 *     supervisory authority more than 72h after discoveredAt, OR when
 *     authorityNotification is the explicit 'delayed' status. Article 33(1)
 *     requires the reasons for the delay be documented.
 *   - authorityNotifiedAt is mandatory when authorityNotification = 'notified'
 *     or 'delayed'.
 *   - subjectNotifiedAt is mandatory when subjectNotification = 'notified' or
 *     'public_communication'.
 *   - containedAt/closedAt cannot precede discoveredAt.
 */
export function validateCreate(input: CreateBreachInput): ValidatedBreach {
  const reference = reqStr('reference', input.reference, BREACH_LIMITS.reference);
  const title = reqStr('title', input.title, BREACH_LIMITS.title);
  const summary = reqStr('summary', input.summary, BREACH_LIMITS.summary);
  const severity = enumVal('severity', input.severity, SEVERITIES);
  const status = enumVal('status', input.status, STATUSES);
  const discoveredAt = reqTs('discoveredAt', input.discoveredAt);
  const occurredAt = optTs('occurredAt', input.occurredAt);
  const containedAt = optTs('containedAt', input.containedAt);
  const closedAt = optTs('closedAt', input.closedAt);
  if (containedAt !== null && containedAt < discoveredAt) {
    throw new BreachValidationError('containedAt cannot precede discoveredAt');
  }
  if (closedAt !== null && closedAt < discoveredAt) {
    throw new BreachValidationError('closedAt cannot precede discoveredAt');
  }
  if (status === 'closed' && closedAt === null) {
    throw new BreachValidationError('closedAt is required when status is closed');
  }
  const dataCategories = reqStr('dataCategories', input.dataCategories, BREACH_LIMITS.dataCategories);
  const dataSubjects = reqStr('dataSubjects', input.dataSubjects, BREACH_LIMITS.dataSubjects);
  const approxRecords = optNum('approxRecords', input.approxRecords);
  const approxSubjects = optNum('approxSubjects', input.approxSubjects);
  const likelyConsequences = reqStr('likelyConsequences', input.likelyConsequences, BREACH_LIMITS.likelyConsequences);
  const mitigations = reqStr('mitigations', input.mitigations, BREACH_LIMITS.mitigations);
  const authorityNotification = enumVal('authorityNotification', input.authorityNotification, AUTH_STATUSES);
  const authorityName = optStr('authorityName', input.authorityName, BREACH_LIMITS.authorityName);
  const authorityNotifiedAt = optTs('authorityNotifiedAt', input.authorityNotifiedAt);
  const delayJustification = optStr('delayJustification', input.delayJustification, BREACH_LIMITS.delayJustification);
  const subjectNotification = enumVal('subjectNotification', input.subjectNotification, SUBJ_STATUSES);
  const subjectNotifiedAt = optTs('subjectNotifiedAt', input.subjectNotifiedAt);

  if ((authorityNotification === 'notified' || authorityNotification === 'delayed') && authorityNotifiedAt === null) {
    throw new BreachValidationError('authorityNotifiedAt is required when authorityNotification is notified or delayed');
  }
  if (authorityNotification === 'notified' && authorityNotifiedAt !== null) {
    if (authorityNotifiedAt - discoveredAt > ART33_WINDOW_MS && !delayJustification) {
      throw new BreachValidationError(
        'delayJustification is required when authority notification is later than 72 hours after discovery (GDPR Art. 33(1))',
      );
    }
  }
  if (authorityNotification === 'delayed' && !delayJustification) {
    throw new BreachValidationError('delayJustification is required when authorityNotification is delayed');
  }
  if ((subjectNotification === 'notified' || subjectNotification === 'public_communication') && subjectNotifiedAt === null) {
    throw new BreachValidationError('subjectNotifiedAt is required when data subjects have been notified');
  }

  return {
    reference,
    title,
    summary,
    severity,
    status,
    discoveredAt,
    occurredAt,
    containedAt,
    closedAt,
    dataCategories,
    dataSubjects,
    approxRecords,
    approxSubjects,
    likelyConsequences,
    mitigations,
    authorityNotification,
    authorityName,
    authorityNotifiedAt,
    delayJustification,
    subjectNotification,
    subjectNotifiedAt,
    contact: optStr('contact', input.contact, BREACH_LIMITS.contact),
    internalNotes: optStr('internalNotes', input.internalNotes, BREACH_LIMITS.internalNotes),
  };
}

export async function createBreach(
  dataDir: string,
  userId: string,
  input: CreateBreachInput,
  now: number = Date.now(),
): Promise<BreachEntry> {
  const v = validateCreate(input);
  const reg = await getRegister(dataDir);
  if (reg.entries.length >= BREACH_LIMITS.maxEntries) {
    throw new BreachValidationError(`register full (max ${BREACH_LIMITS.maxEntries})`);
  }
  if (reg.entries.some((e) => e.reference === v.reference)) {
    throw new BreachValidationError(`reference ${v.reference} already exists`);
  }
  const entry: BreachEntry = {
    id: nanoid(),
    ...v,
    createdAt: now,
    updatedAt: now,
    updatedBy: userId,
  };
  reg.entries.push(entry);
  reg.updatedAt = now;
  reg.updatedBy = userId;
  await save(dataDir, reg);
  return entry;
}

export async function updateBreach(
  dataDir: string,
  userId: string,
  id: string,
  input: CreateBreachInput,
  now: number = Date.now(),
): Promise<BreachEntry> {
  const v = validateCreate(input);
  const reg = await getRegister(dataDir);
  const idx = reg.entries.findIndex((e) => e.id === id);
  if (idx < 0) throw new BreachValidationError('breach not found');
  if (reg.entries.some((e, i) => i !== idx && e.reference === v.reference)) {
    throw new BreachValidationError(`reference ${v.reference} already exists`);
  }
  const prev = reg.entries[idx]!;
  const entry: BreachEntry = {
    ...prev,
    ...v,
    id,
    createdAt: prev.createdAt,
    updatedAt: now,
    updatedBy: userId,
  };
  reg.entries[idx] = entry;
  reg.updatedAt = now;
  reg.updatedBy = userId;
  await save(dataDir, reg);
  return entry;
}

export async function deleteBreach(
  dataDir: string,
  userId: string,
  id: string,
  now: number = Date.now(),
): Promise<boolean> {
  const reg = await getRegister(dataDir);
  const idx = reg.entries.findIndex((e) => e.id === id);
  if (idx < 0) return false;
  reg.entries.splice(idx, 1);
  reg.updatedAt = now;
  reg.updatedBy = userId;
  await save(dataDir, reg);
  return true;
}

export interface BreachPublic {
  id: string;
  reference: string;
  title: string;
  summary: string;
  severity: BreachSeverity;
  status: BreachStatus;
  discoveredAt: number;
  occurredAt: number | null;
  containedAt: number | null;
  closedAt: number | null;
  dataCategories: string;
  dataSubjects: string;
  approxRecords: number | null;
  approxSubjects: number | null;
  likelyConsequences: string;
  mitigations: string;
  authorityNotification: AuthorityNotificationStatus;
  authorityName: string | null;
  authorityNotifiedAt: number | null;
  delayJustification: string | null;
  subjectNotification: SubjectNotificationStatus;
  subjectNotifiedAt: number | null;
  contact: string | null;
  withinArt33Window: boolean | null;
}

/**
 * Strip operator-only fields (internalNotes, updatedBy) and project
 * Art. 33 compliance status as a derived boolean for the public page.
 */
export function publicView(entry: BreachEntry): BreachPublic {
  let within: boolean | null = null;
  if (entry.authorityNotification === 'not_required') within = null;
  else if (entry.authorityNotifiedAt !== null) {
    within = entry.authorityNotifiedAt - entry.discoveredAt <= ART33_WINDOW_MS;
  } else within = false;
  return {
    id: entry.id,
    reference: entry.reference,
    title: entry.title,
    summary: entry.summary,
    severity: entry.severity,
    status: entry.status,
    discoveredAt: entry.discoveredAt,
    occurredAt: entry.occurredAt,
    containedAt: entry.containedAt,
    closedAt: entry.closedAt,
    dataCategories: entry.dataCategories,
    dataSubjects: entry.dataSubjects,
    approxRecords: entry.approxRecords,
    approxSubjects: entry.approxSubjects,
    likelyConsequences: entry.likelyConsequences,
    mitigations: entry.mitigations,
    authorityNotification: entry.authorityNotification,
    authorityName: entry.authorityName,
    authorityNotifiedAt: entry.authorityNotifiedAt,
    delayJustification: entry.delayJustification,
    subjectNotification: entry.subjectNotification,
    subjectNotifiedAt: entry.subjectNotifiedAt,
    contact: entry.contact,
    withinArt33Window: within,
  };
}

export interface PublicRegister {
  entries: BreachPublic[];
  updatedAt: number;
  totalCount: number;
  openCount: number;
  overdueCount: number;
}

/**
 * Public projection of the whole register. Includes summary counters
 * the buyer's procurement tooling reads first: total entries, how many
 * are still open, and how many missed the 72h Art. 33 window. These
 * three numbers usually decide whether the questionnaire continues.
 */
export function publicList(reg: BreachRegister): PublicRegister {
  const entries = reg.entries.map(publicView);
  // Most recent first so the on-page render is reverse-chronological.
  entries.sort((a, b) => b.discoveredAt - a.discoveredAt);
  return {
    entries,
    updatedAt: reg.updatedAt,
    totalCount: entries.length,
    openCount: entries.filter((e) => e.status !== 'closed').length,
    overdueCount: entries.filter((e) => e.withinArt33Window === false).length,
  };
}

/**
 * CSV export for the regulator. Mirrors the operator view exactly so the
 * downloaded file is what a DPO would paste into their own register.
 * No internal notes; this is a customer-facing export.
 */
export function toCsv(reg: BreachRegister): string {
  const cols = [
    'reference', 'title', 'summary', 'severity', 'status',
    'discoveredAt', 'occurredAt', 'containedAt', 'closedAt',
    'dataCategories', 'dataSubjects', 'approxRecords', 'approxSubjects',
    'likelyConsequences', 'mitigations',
    'authorityNotification', 'authorityName', 'authorityNotifiedAt',
    'subjectNotification', 'subjectNotifiedAt',
    'delayJustification', 'contact',
  ];
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? new Date(v).toISOString() : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const numericCols = new Set(['discoveredAt', 'occurredAt', 'containedAt', 'closedAt', 'authorityNotifiedAt', 'subjectNotifiedAt']);
  const rawNumericCols = new Set(['approxRecords', 'approxSubjects']);
  const lines = [cols.join(',')];
  const entries = [...reg.entries].sort((a, b) => b.discoveredAt - a.discoveredAt);
  for (const e of entries) {
    const row = cols.map((c) => {
      const v = (e as unknown as Record<string, unknown>)[c];
      if (rawNumericCols.has(c)) return v === null || v === undefined ? '' : String(v);
      if (numericCols.has(c)) return esc(v);
      return esc(v);
    });
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}
