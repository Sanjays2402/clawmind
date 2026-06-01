import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

// Warrant canary.
//
// A warrant canary is a recurring public attestation that the workspace
// operator has NOT received a secret legal process (national security
// letter, gag order, undisclosed subpoena) since the previous
// attestation. The presence of a fresh, signed canary is meaningful;
// its absence or staleness is the signal that something has changed.
//
// Procurement reviewers at regulated buyers (healthcare, finance,
// government) routinely look for this artefact during vendor security
// review. Shipping one is cheap, and the absence of one is a real
// signature on a security questionnaire.
//
// Design notes for reviewers:
//   - Storage is a single JSON document with an append-only `history`
//     array. The current attestation is `history[history.length-1]`.
//     A withdrawn or expired canary never disappears from history;
//     procurement audits explicitly look for tampered timelines.
//   - Each attestation includes the operator-supplied statement text,
//     the actor user id, the timestamp, the cadence-days at the time
//     of attestation, and a SHA-256 fingerprint over the canonical
//     content. The fingerprint is what a buyer pins in their own
//     vendor-review record so a silent edit is detectable.
//   - The public projection at GET /v1/warrant-canary is the URL a
//     buyer's vendor-review tool will crawl; it MUST stay
//     unauthenticated. It strips operator-only metadata (the user
//     id of the attester).
//   - Status derivation is deterministic from `expiresAt` so the
//     public surface always agrees with the admin view.

export type CanaryStatus = 'unconfigured' | 'active' | 'stale' | 'withdrawn';

export interface CanaryAttestation {
  id: string;
  statement: string;
  attestedBy: string;
  attestedAt: number;
  cadenceDays: number;
  expiresAt: number;
  fingerprint: string;
  withdrawnAt: number | null;
  withdrawnBy: string | null;
  withdrawnReason: string | null;
}

export interface CanaryDocument {
  enabled: boolean;
  defaultCadenceDays: number;
  preamble: string;
  history: CanaryAttestation[];
  updatedAt: number;
  updatedBy: string | null;
}

export interface CanarySettingsInput {
  enabled?: boolean;
  defaultCadenceDays?: number;
  preamble?: string;
}

export interface CanaryAttestInput {
  statement: string;
  cadenceDays?: number;
}

export interface CanaryWithdrawInput {
  reason: string;
}

export class CanaryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanaryValidationError';
  }
}

export const CANARY_LIMITS = Object.freeze({
  statement: 8000,
  preamble: 4000,
  reason: 1000,
  minCadenceDays: 1,
  maxCadenceDays: 365,
  maxHistory: 500,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(msg: string): never {
  throw new CanaryValidationError(msg);
}

function emptyDoc(now: number): CanaryDocument {
  return {
    enabled: false,
    defaultCadenceDays: 30,
    preamble: '',
    history: [],
    updatedAt: now,
    updatedBy: null,
  };
}

function file(dataDir: string): string {
  return join(dataDir, 'warrant-canary.json');
}

async function readDoc(dataDir: string): Promise<CanaryDocument> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CanaryDocument>;
    const base = emptyDoc(Date.now());
    return {
      ...base,
      ...parsed,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    } as CanaryDocument;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyDoc(Date.now());
    }
    throw err;
  }
}

async function writeDoc(dataDir: string, doc: CanaryDocument): Promise<void> {
  const target = file(dataDir);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

function fingerprint(statement: string, attestedAt: number, cadenceDays: number): string {
  return createHash('sha256')
    .update(`${statement}|${attestedAt}|${cadenceDays}`)
    .digest('hex');
}

function checkCadence(value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  if (!Number.isFinite(n) || !Number.isInteger(n)) fail('cadenceDays must be an integer');
  if (n < CANARY_LIMITS.minCadenceDays) fail(`cadenceDays must be >= ${CANARY_LIMITS.minCadenceDays}`);
  if (n > CANARY_LIMITS.maxCadenceDays) fail(`cadenceDays must be <= ${CANARY_LIMITS.maxCadenceDays}`);
  return n;
}

export function deriveStatus(doc: CanaryDocument, now: number): CanaryStatus {
  if (!doc.enabled || doc.history.length === 0) return 'unconfigured';
  const latest = doc.history[doc.history.length - 1]!;
  if (latest.withdrawnAt != null) return 'withdrawn';
  if (latest.expiresAt < now) return 'stale';
  return 'active';
}

export async function getDocument(dataDir: string): Promise<CanaryDocument> {
  return readDoc(dataDir);
}

export async function updateSettings(
  dataDir: string,
  actor: string,
  input: CanarySettingsInput,
): Promise<CanaryDocument> {
  const doc = await readDoc(dataDir);
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') fail('enabled must be a boolean');
    doc.enabled = input.enabled;
  }
  if (input.defaultCadenceDays !== undefined) {
    doc.defaultCadenceDays = checkCadence(input.defaultCadenceDays, doc.defaultCadenceDays);
  }
  if (input.preamble !== undefined) {
    if (typeof input.preamble !== 'string') fail('preamble must be a string');
    if (input.preamble.length > CANARY_LIMITS.preamble) fail('preamble too long');
    doc.preamble = input.preamble;
  }
  doc.updatedAt = Date.now();
  doc.updatedBy = actor;
  await writeDoc(dataDir, doc);
  return doc;
}

export async function signAttestation(
  dataDir: string,
  actor: string,
  input: CanaryAttestInput,
): Promise<{ doc: CanaryDocument; record: CanaryAttestation }> {
  const doc = await readDoc(dataDir);
  if (!doc.enabled) fail('warrant canary is not enabled');
  if (typeof input.statement !== 'string') fail('statement is required');
  const trimmed = input.statement.trim();
  if (!trimmed) fail('statement must not be empty');
  if (trimmed.length > CANARY_LIMITS.statement) fail('statement too long');
  if (doc.history.length >= CANARY_LIMITS.maxHistory) fail('attestation history is full');

  const cadenceDays = checkCadence(input.cadenceDays, doc.defaultCadenceDays);
  const now = Date.now();
  const seq = doc.history.length + 1;
  const record: CanaryAttestation = {
    id: `wc_${seq.toString().padStart(6, '0')}`,
    statement: trimmed,
    attestedBy: actor,
    attestedAt: now,
    cadenceDays,
    expiresAt: now + cadenceDays * DAY_MS,
    fingerprint: fingerprint(trimmed, now, cadenceDays),
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawnReason: null,
  };
  doc.history.push(record);
  doc.updatedAt = now;
  doc.updatedBy = actor;
  await writeDoc(dataDir, doc);
  return { doc, record };
}

export async function withdrawCurrent(
  dataDir: string,
  actor: string,
  input: CanaryWithdrawInput,
): Promise<{ doc: CanaryDocument; record: CanaryAttestation }> {
  const doc = await readDoc(dataDir);
  if (doc.history.length === 0) fail('no attestation to withdraw');
  const latest = doc.history[doc.history.length - 1]!;
  if (latest.withdrawnAt != null) fail('current attestation is already withdrawn');
  if (typeof input.reason !== 'string') fail('reason is required');
  const trimmed = input.reason.trim();
  if (!trimmed) fail('reason must not be empty');
  if (trimmed.length > CANARY_LIMITS.reason) fail('reason too long');
  const now = Date.now();
  latest.withdrawnAt = now;
  latest.withdrawnBy = actor;
  latest.withdrawnReason = trimmed;
  doc.updatedAt = now;
  doc.updatedBy = actor;
  await writeDoc(dataDir, doc);
  return { doc, record: latest };
}

export function publicView(doc: CanaryDocument, now: number = Date.now()): Record<string, unknown> {
  const status = deriveStatus(doc, now);
  const sanitisedHistory = doc.history.map((r) => ({
    id: r.id,
    statement: r.statement,
    attestedAt: r.attestedAt,
    cadenceDays: r.cadenceDays,
    expiresAt: r.expiresAt,
    fingerprint: r.fingerprint,
    withdrawnAt: r.withdrawnAt,
    withdrawnReason: r.withdrawnReason,
  }));
  const latest = sanitisedHistory.length > 0 ? sanitisedHistory[sanitisedHistory.length - 1] : null;
  return {
    enabled: doc.enabled,
    status,
    preamble: doc.preamble,
    defaultCadenceDays: doc.defaultCadenceDays,
    current: latest,
    history: sanitisedHistory,
    generatedAt: now,
  };
}
