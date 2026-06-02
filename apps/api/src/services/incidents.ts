import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Security Incident Disclosure Log.
//
// Enterprise procurement teams (and SOC 2 CC7.4 / ISO 27001 A.5.24 reviewers)
// expect a published log of past security incidents with severity, scope,
// resolution, and customer impact. Today most vendors satisfy this with a
// hand-rolled status-page or a paragraph in an MSA addendum; neither is
// machine-readable and neither is auditable. This service is the single
// owner-edited source of truth that backs three surfaces:
//
//   - GET /v1/incidents              public JSON timeline for vendor reviews
//   - /incidents on the web app      public HTML page that DPAs can cite
//   - admin CRUD under /v1/incidents/admin for the workspace owner
//
// Storage is a single JSON document under the workspace data dir. Tiny,
// hand-auditable, no migration. Every mutation funnels through this
// service so the audit chain entry and the file write stay coupled.
//
// The public projection strips operator-only metadata (internal notes,
// last-edited-by user id) so an internet-exposed instance does not leak
// internal context to drive-by scrapers.

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus =
  | 'investigating'
  | 'identified'
  | 'monitoring'
  | 'resolved';

export interface IncidentUpdate {
  // ISO timestamp of the update. Stored as ms-since-epoch but accepted as
  // either; the validator normalises.
  at: number;
  // Free-form, plain-text message. No markdown rendered on the public
  // page so this is not an XSS surface.
  message: string;
  status: IncidentStatus;
}

export interface Incident {
  id: string;
  title: string;
  // Plain-text summary shown above the update timeline. Bounded.
  summary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  // ISO ms when the incident was first observed by the operator.
  startedAt: number;
  // ISO ms when the incident was declared resolved; null while open.
  resolvedAt: number | null;
  // Which customer-visible surfaces were affected, e.g. ["api", "web"].
  // Bounded; the public page renders them as chips.
  affectedComponents: string[];
  // Whether any customer data was exposed, modified, or destroyed.
  // Surfaced prominently on the public page because this is the single
  // most-asked-about field in any vendor questionnaire.
  customerDataImpacted: boolean;
  // Chronological list of updates. The most recent is shown first.
  updates: IncidentUpdate[];
  // Operator-only notes; never surfaced on the public projection.
  privateNotes: string;
  createdAt: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface IncidentUpdateInput {
  at?: number | string;
  message: string;
  status: IncidentStatus;
}

export interface IncidentInput {
  title: string;
  summary?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number | string;
  resolvedAt?: number | string | null;
  affectedComponents?: string[];
  customerDataImpacted?: boolean;
  updates?: IncidentUpdateInput[];
  privateNotes?: string;
}

export class IncidentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentValidationError';
  }
}

export const INCIDENT_LIMITS = Object.freeze({
  title: 200,
  summary: 4000,
  privateNotes: 4000,
  component: 60,
  maxComponents: 16,
  updateMessage: 2000,
  maxUpdates: 200,
  maxIncidents: 500,
});

const VALID_SEVERITIES = new Set<IncidentSeverity>(['low', 'medium', 'high', 'critical']);
const VALID_STATUSES = new Set<IncidentStatus>([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);

function fail(msg: string): never {
  throw new IncidentValidationError(msg);
}

function asTimestamp(field: string, value: number | string): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) fail(`${field} must be a positive timestamp`);
    return Math.floor(value);
  }
  if (typeof value !== 'string') fail(`${field} must be a timestamp`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) fail(`${field} must be ISO date or epoch ms`);
  return ms;
}

function asNullableTimestamp(field: string, value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  return asTimestamp(field, value);
}

function normaliseComponents(input: string[] | undefined): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) fail('affectedComponents must be an array');
  if (input.length > INCIDENT_LIMITS.maxComponents) fail('too many affectedComponents');
  return input.map((c, i) => {
    if (typeof c !== 'string') fail(`affectedComponents[${i}] must be a string`);
    const t = c.trim();
    if (!t) fail(`affectedComponents[${i}] must not be empty`);
    if (t.length > INCIDENT_LIMITS.component) fail(`affectedComponents[${i}] too long`);
    return t;
  });
}

function normaliseUpdates(input: IncidentUpdateInput[] | undefined): IncidentUpdate[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) fail('updates must be an array');
  if (input.length > INCIDENT_LIMITS.maxUpdates) fail('too many updates');
  return input.map((u, i) => {
    if (!u || typeof u !== 'object') fail(`updates[${i}] invalid`);
    if (!u.message || typeof u.message !== 'string') fail(`updates[${i}].message required`);
    if (u.message.length > INCIDENT_LIMITS.updateMessage) fail(`updates[${i}].message too long`);
    if (!VALID_STATUSES.has(u.status)) fail(`updates[${i}].status invalid`);
    const at = u.at == null ? Date.now() : asTimestamp(`updates[${i}].at`, u.at);
    return { at, message: u.message.trim(), status: u.status };
  });
}

function file(dataDir: string): string {
  return join(dataDir, 'incidents.json');
}

interface IncidentStore {
  incidents: Incident[];
}

async function readStore(dataDir: string): Promise<IncidentStore> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<IncidentStore>;
    return {
      incidents: Array.isArray(parsed.incidents) ? (parsed.incidents as Incident[]) : [],
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { incidents: [] };
    throw err;
  }
}

async function writeStore(dataDir: string, store: IncidentStore): Promise<void> {
  const target = file(dataDir);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

export function validateInput(input: IncidentInput): {
  title: string;
  summary: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: number;
  resolvedAt: number | null;
  affectedComponents: string[];
  customerDataImpacted: boolean;
  updates: IncidentUpdate[];
  privateNotes: string;
} {
  if (!input || typeof input !== 'object') fail('body must be an object');
  if (!input.title || typeof input.title !== 'string') fail('title required');
  const title = input.title.trim();
  if (!title) fail('title required');
  if (title.length > INCIDENT_LIMITS.title) fail('title too long');

  const summary = input.summary ?? '';
  if (typeof summary !== 'string') fail('summary must be a string');
  if (summary.length > INCIDENT_LIMITS.summary) fail('summary too long');

  if (!VALID_SEVERITIES.has(input.severity)) fail('severity invalid');
  if (!VALID_STATUSES.has(input.status)) fail('status invalid');

  const startedAt = asTimestamp('startedAt', input.startedAt);
  const resolvedAt = asNullableTimestamp('resolvedAt', input.resolvedAt);
  if (resolvedAt != null && resolvedAt < startedAt) fail('resolvedAt must be >= startedAt');
  if (input.status === 'resolved' && resolvedAt == null) {
    fail('resolvedAt required when status is resolved');
  }
  if (input.status !== 'resolved' && resolvedAt != null) {
    fail('resolvedAt must be null unless status is resolved');
  }

  const privateNotes = input.privateNotes ?? '';
  if (typeof privateNotes !== 'string') fail('privateNotes must be a string');
  if (privateNotes.length > INCIDENT_LIMITS.privateNotes) fail('privateNotes too long');

  return {
    title,
    summary,
    severity: input.severity,
    status: input.status,
    startedAt,
    resolvedAt,
    affectedComponents: normaliseComponents(input.affectedComponents),
    customerDataImpacted: Boolean(input.customerDataImpacted),
    updates: normaliseUpdates(input.updates),
    privateNotes,
  };
}

export async function listIncidents(dataDir: string): Promise<Incident[]> {
  const store = await readStore(dataDir);
  // Newest first by startedAt so the public timeline reads top-down.
  return [...store.incidents].sort((a, b) => b.startedAt - a.startedAt);
}

export async function getIncident(dataDir: string, id: string): Promise<Incident | null> {
  const store = await readStore(dataDir);
  return store.incidents.find((i) => i.id === id) ?? null;
}

export async function createIncident(
  dataDir: string,
  actor: string,
  input: IncidentInput,
): Promise<Incident> {
  const store = await readStore(dataDir);
  if (store.incidents.length >= INCIDENT_LIMITS.maxIncidents) {
    fail('incident limit reached; archive older entries first');
  }
  const v = validateInput(input);
  const now = Date.now();
  const incident: Incident = {
    id: `inc_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    ...v,
    createdAt: now,
    updatedAt: now,
    updatedBy: actor,
  };
  store.incidents.push(incident);
  await writeStore(dataDir, store);
  return incident;
}

export async function updateIncident(
  dataDir: string,
  actor: string,
  id: string,
  input: IncidentInput,
): Promise<Incident> {
  const store = await readStore(dataDir);
  const idx = store.incidents.findIndex((i) => i.id === id);
  if (idx < 0) fail('incident not found');
  const v = validateInput(input);
  const existing = store.incidents[idx]!;
  const next: Incident = {
    ...existing,
    ...v,
    updatedAt: Date.now(),
    updatedBy: actor,
  };
  store.incidents[idx] = next;
  await writeStore(dataDir, store);
  return next;
}

export async function deleteIncident(dataDir: string, id: string): Promise<boolean> {
  const store = await readStore(dataDir);
  const before = store.incidents.length;
  store.incidents = store.incidents.filter((i) => i.id !== id);
  if (store.incidents.length === before) return false;
  await writeStore(dataDir, store);
  return true;
}

// Public projection: strips operator-only fields (privateNotes, updatedBy)
// that should never leak from an internet-exposed instance.
export function publicView(incident: Incident): Record<string, unknown> {
  return {
    id: incident.id,
    title: incident.title,
    summary: incident.summary,
    severity: incident.severity,
    status: incident.status,
    startedAt: incident.startedAt,
    resolvedAt: incident.resolvedAt,
    affectedComponents: incident.affectedComponents,
    customerDataImpacted: incident.customerDataImpacted,
    updates: incident.updates.slice().sort((a, b) => b.at - a.at),
  };
}

export function publicList(incidents: Incident[]): Record<string, unknown> {
  return {
    incidents: incidents.map(publicView),
    generatedAt: Date.now(),
  };
}

// Case-insensitive substring filter over title, summary, and any
// affectedComponents entry. Lets a procurement reviewer pull, e.g.,
// every public incident touching the 'api' component with a single URL.
export function filterIncidents(incidents: Incident[], q: string | undefined): Incident[] {
  const needle = q?.trim().toLowerCase();
  if (!needle) return incidents;
  return incidents.filter((i) => {
    const hay = `${i.title}\n${i.summary ?? ''}\n${i.affectedComponents.join('\n')}`.toLowerCase();
    return hay.includes(needle);
  });
}
