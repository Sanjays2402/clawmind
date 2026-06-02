// Sign-in activity log.
//
// Enterprise procurement reviewers ask for "who signed in, when, from where,
// and which ones failed" as a separate, focused log. The audit chain has
// this information mixed in with every other mutation, which makes it
// useless during an incident: an SRE who suspects a credential leak needs
// a narrow, paginated view filtered to authentication events. This module
// is that view.
//
// Records are written on every login attempt (success or failure), every
// SSO callback, and every explicit logout. Each record carries:
//   - the canonical actor (userId for success, supplied identifier for
//     failure such as "oidc:<email>" or "anonymous"),
//   - the method (github, oidc, etc.),
//   - the outcome (success | failure | logout),
//   - ip + truncated user agent,
//   - optional reason on failure ("not allowed", "oauth failed", ...),
//   - server-side timestamp.
//
// On-disk layout: <dataDir>/sign-in-log.json, atomic rewrite, capped ring
// so the file size stays bounded on a single-node deploy. The cap is
// large enough to cover a quarter of typical traffic; older entries
// drop off the tail.
//
// Two read APIs:
//   listForUser(userId)  scoped to the calling user; cross-tenant safe.
//   listAll(filters)     admin+ surface; supports outcome / method /
//                        actor / ip / since filters and stable pagination.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export const MAX_RECORDS = 5000;
export const MAX_LABEL_LEN = 200;
export const MAX_REASON_LEN = 300;

export type SignInOutcome = 'success' | 'failure' | 'logout';

export interface SignInRecord {
  id: string;
  actor: string;
  method: string;
  outcome: SignInOutcome;
  ip: string;
  userAgent: string;
  reason?: string;
  at: number;
}

interface LogFile {
  version: 1;
  records: SignInRecord[];
}

function logPath(dataDir: string): string {
  return join(dataDir, 'sign-in-log.json');
}

function clip(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

async function readLog(dataDir: string): Promise<LogFile> {
  try {
    const raw = await readFile(logPath(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as LogFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return { version: 1, records: [] };
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, records: [] };
    }
    throw err;
  }
}

async function writeLog(dataDir: string, file: LogFile): Promise<void> {
  const p = logPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, p);
}

export interface RecordArgs {
  actor: string;
  method: string;
  outcome: SignInOutcome;
  ip: string;
  userAgent?: string;
  reason?: string;
}

export async function recordSignIn(dataDir: string, args: RecordArgs): Promise<SignInRecord> {
  const now = Date.now();
  const rec: SignInRecord = {
    id: randomUUID(),
    actor: clip(args.actor || 'anonymous', MAX_LABEL_LEN),
    method: clip(args.method, MAX_LABEL_LEN),
    outcome: args.outcome,
    ip: clip(args.ip, MAX_LABEL_LEN),
    userAgent: clip(args.userAgent, MAX_LABEL_LEN),
    reason: args.reason ? clip(args.reason, MAX_REASON_LEN) : undefined,
    at: now,
  };
  const file = await readLog(dataDir);
  file.records.push(rec);
  // Cap to MAX_RECORDS, drop oldest. The ring is intentionally simple:
  // a 5k bound is ~1-2 MB on disk which is fine for the single-node deploy
  // and easy to ship to an external SIEM on a cron.
  if (file.records.length > MAX_RECORDS) {
    file.records.splice(0, file.records.length - MAX_RECORDS);
  }
  await writeLog(dataDir, file);
  return rec;
}

export interface ListFilters {
  outcome?: SignInOutcome;
  method?: string;
  actor?: string;
  ip?: string;
  sinceMs?: number;
  limit?: number;
  cursor?: string;
}

export interface ListResult {
  records: SignInRecord[];
  nextCursor: string | null;
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function applyFilters(records: SignInRecord[], filters: ListFilters): SignInRecord[] {
  let rows = records;
  if (filters.outcome) rows = rows.filter((r) => r.outcome === filters.outcome);
  if (filters.method) rows = rows.filter((r) => r.method === filters.method);
  if (filters.actor) rows = rows.filter((r) => r.actor === filters.actor);
  if (filters.ip) rows = rows.filter((r) => r.ip === filters.ip);
  if (filters.sinceMs) {
    const since = filters.sinceMs;
    rows = rows.filter((r) => r.at >= since);
  }
  return rows;
}

function paginate(rows: SignInRecord[], cursor: string | undefined, limit: number): ListResult {
  // Newest first; cursor is the timestamp of the last item returned, so
  // the next page is "everything strictly older than the cursor".
  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const cutoff = decodeCursor(cursor);
  const filtered = sorted.filter((r) => r.at < cutoff);
  const page = filtered.slice(0, limit);
  const nextCursor = filtered.length > limit ? String(page[page.length - 1]!.at) : null;
  return { records: page, nextCursor, total: rows.length };
}

export async function listForUser(
  dataDir: string,
  userId: string,
  filters: ListFilters = {},
): Promise<ListResult> {
  const file = await readLog(dataDir);
  // A user only ever sees rows where they are the canonical actor. Failed
  // login attempts that fall back to "anonymous" or to an unmatched
  // identifier are NOT visible to any individual user; only the admin
  // listAll surface exposes those.
  const mine = file.records.filter((r) => r.actor === userId);
  const filtered = applyFilters(mine, { ...filters, actor: undefined });
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  return paginate(filtered, filters.cursor, limit);
}

export async function listAll(
  dataDir: string,
  filters: ListFilters = {},
): Promise<ListResult> {
  const file = await readLog(dataDir);
  const filtered = applyFilters(file.records, filters);
  const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
  return paginate(filtered, filters.cursor, limit);
}

/** Reset on disk. Intended for tests. */
export async function _resetForTests(dataDir: string): Promise<void> {
  await writeLog(dataDir, { version: 1, records: [] });
}
